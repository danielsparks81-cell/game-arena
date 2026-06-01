import { describe, it, expect } from 'vitest';
import {
  CARDS,
  CARDS_BY_RARITY,
  HIDDEN_CARD,
  STARTING_HP,
  STARTING_HAND_SIZE,
  STATE_VERSION,
  MAX_COPIES,
  DRAFT_ROUNDS,
  DRAFT_DECK_SIZE,
  DRAFT_DECK_COMMONS,
  DRAFT_DECK_UNCOMMONS,
  DRAFT_DECK_RARES,
  DRAFTED_CARDS,
  STARTER_DECK_SIZE,
  applyMove,
  autoCompleteDraft,
  createInitialStateForHost,
  initialState,
  migrateState,
  projectStateForViewer,
  removePlayer,
  seatJoinerAndStart,
  trimLog,
  LOG_MAX,
  type SDState,
} from './spellduel';

// Spellduel is the foundation for interactive card games — the tests here
// pin down the *interaction rules* (mana payment, draw-from-empty-deck-via-
// reshuffle, prevent-damage triggers, simultaneous-KO tiebreaker, dynamic
// combo) so we don't break them while adding new cards.

function setupDuel(opts?: { firstSeat?: 'A' | 'B' }): SDState {
  // Build a "real" duel through the public API: host → join (opens the draft)
  // → auto-complete the draft (both decks built, duel begins). Then force the
  // first-turn seat if requested so the rest of the test is deterministic.
  const host = createInitialStateForHost({ userId: 'alice-id', username: 'Alice', accent_color: '#10b981' });
  const drafting = seatJoinerAndStart(host, { userId: 'bob-id', username: 'Bob', accent_color: '#f59e0b' });
  const both = autoCompleteDraft(drafting);
  if (opts?.firstSeat && both.currentSeat !== opts.firstSeat) {
    // Swap whose turn it is. The maxMana/mana state was set on whichever seat
    // got picked, so we need to move that to the other seat.
    const next: SDState = JSON.parse(JSON.stringify(both));
    const losing = next.currentSeat;
    const winning = opts.firstSeat;
    next.currentSeat = winning;
    next.players[winning].maxMana = next.players[losing].maxMana;
    next.players[winning].mana    = next.players[losing].mana;
    next.players[losing].maxMana = 0;
    next.players[losing].mana    = 0;
    return next;
  }
  return both;
}

/** Replace the active player's hand with a single card, give them enough mana
 *  to play it, then return the state. Used to drive deterministic card tests
 *  without fighting RNG. */
function primeForCard(state: SDState, cardId: keyof typeof CARDS, mana = 99): SDState {
  const next: SDState = JSON.parse(JSON.stringify(state));
  const me = next.players[next.currentSeat];
  me.hand = [cardId];
  me.mana = mana;
  me.maxMana = Math.max(me.maxMana, mana);
  return next;
}

describe('spellduel: construction', () => {
  it('creates a lobby state when only the host is seated (no deck dealt yet)', () => {
    const s = createInitialStateForHost({ userId: 'alice-id', username: 'Alice' });
    expect(s.phase).toBe('lobby');
    expect(s.seats.A).toBe('alice-id');
    expect(s.seats.B).toBeUndefined();
    expect(s.players.A.hp).toBe(STARTING_HP);
    // Decks/hands are empty in the lobby — they're built during the draft.
    expect(s.players.A.hand.length).toBe(0);
    expect(s.players.A.deck.length).toBe(0);
  });

  it('seatJoinerAndStart fills seat B and opens the draft (not playing yet)', () => {
    const host = createInitialStateForHost({ userId: 'alice-id', username: 'Alice' });
    const drafting = seatJoinerAndStart(host, { userId: 'bob-id', username: 'Bob' });
    expect(drafting.phase).toBe('drafting');
    expect(drafting.seats.B).toBe('bob-id');
    expect(drafting.draft).toBeTruthy();
    expect(drafting.draft!.A.round).toBe(1);
    expect(drafting.draft!.B.round).toBe(1);
  });

  it('autoCompleteDraft builds two legal 36-card decks and starts the duel', () => {
    const host = createInitialStateForHost({ userId: 'alice-id', username: 'Alice' });
    const drafting = seatJoinerAndStart(host, { userId: 'bob-id', username: 'Bob' });
    const both = autoCompleteDraft(drafting);
    expect(both.phase).toBe('playing');
    expect(both.draft).toBeUndefined();
    expect(['A', 'B']).toContain(both.currentSeat);
    expect(both.players[both.currentSeat].maxMana).toBe(1);
    for (const seat of ['A', 'B'] as const) {
      const p = both.players[seat];
      // deck + hand together = the full 36-card deck (24 starter + 12 drafted).
      expect(p.deck.length + p.hand.length).toBe(DRAFT_DECK_SIZE);
      expect(p.hand.length).toBe(STARTING_HAND_SIZE);
    }
  });

  it('removePlayer in lobby clears the seat; ignored once playing', () => {
    const host = createInitialStateForHost({ userId: 'alice-id', username: 'Alice' });
    const cleared = removePlayer(host, 'alice-id');
    expect(cleared.seats.A).toBeUndefined();

    const both = seatJoinerAndStart(host, { userId: 'bob-id', username: 'Bob' });
    const stillBoth = removePlayer(both, 'alice-id');
    expect(stillBoth).toBe(both); // no-op once playing
  });
});

describe('spellduel: turn flow', () => {
  it('end_turn flips currentSeat, increments maxMana, refills, draws 1', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const me = s.players.A;
    const them = s.players.B;
    expect(me.maxMana).toBe(1);
    expect(them.maxMana).toBe(0);
    const handCountB = them.hand.length;
    const next = applyMove(s, { kind: 'end_turn' }, 'alice-id') as SDState;
    expect(next.currentSeat).toBe('B');
    expect(next.players.B.maxMana).toBe(1);
    expect(next.players.B.mana).toBe(1);
    expect(next.players.B.hand.length).toBe(handCountB + 1);
  });

  it('rejects moves from the off-turn player', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const result = applyMove(s, { kind: 'end_turn' }, 'bob-id');
    expect('error' in result).toBe(true);
  });
});

describe('spellduel: cards', () => {
  it('Strike deals 2 damage and gets discarded', () => {
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'strike');
    const next = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(next.players.B.hp).toBe(STARTING_HP - 2);
    expect(next.players.A.hand.length).toBe(0);
    expect(next.players.A.discard).toContain('strike');
  });

  it('Mend heals but caps at STARTING_HP', () => {
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'mend');
    s.players.A.hp = STARTING_HP - 1; // can only heal 1 even though card heals 3
    const next = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(next.players.A.hp).toBe(STARTING_HP);
  });

  it('Insight draws 2', () => {
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'insight');
    const before = s.players.A.hand.length;
    const next = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    // before-1 (insight consumed) + 2 (drawn) = before+1
    expect(next.players.A.hand.length).toBe(before + 1);
  });

  it('Counter prevents the next damage taken', () => {
    // A plays Counter, end_turn → B plays Strike → A still at full HP, trigger consumed.
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'counter');
    const armed = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(armed.players.A.pendingTriggers.length).toBe(1);

    const ended = applyMove(armed, { kind: 'end_turn' }, 'alice-id') as SDState;
    const prepped = primeForCard(ended, 'strike');
    const struck = applyMove(prepped, { kind: 'play', cardIdx: 0 }, 'bob-id') as SDState;

    expect(struck.players.A.hp).toBe(STARTING_HP);          // no damage taken
    expect(struck.players.A.pendingTriggers.length).toBe(0); // trigger consumed
  });

  it('Combo: deals 1 normally, 5 if cardsPlayedThisTurn >= 3', () => {
    // Bare combo on an empty turn → 1 damage. (No other cards have been played
    // yet, so cardsPlayedThisTurn becomes 1 BEFORE resolution.)
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'combo');
    const solo = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(solo.players.B.hp).toBe(STARTING_HP - 1);

    // Now stack: play 2 free Sacrifices first (cost 0), then Combo.
    const stacked: SDState = JSON.parse(JSON.stringify(setupDuel({ firstSeat: 'A' })));
    stacked.players.A.hand = ['sacrifice', 'sacrifice', 'combo'];
    stacked.players.A.mana = 5;
    stacked.players.A.maxMana = 5;
    stacked.players.A.hp = 10; // give Sacrifice room to drain HP
    const afterS1 = applyMove(stacked, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    const afterS2 = applyMove(afterS1, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    const afterCombo = applyMove(afterS2, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    // Combo is the 3rd card played this turn, so it deals 5.
    expect(afterCombo.players.B.hp).toBe(STARTING_HP - 5);
  });

  it('Sacrifice: pays 1 HP, grants 2 bonus mana this turn', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const armed: SDState = JSON.parse(JSON.stringify(s));
    armed.players.A.hand = ['sacrifice'];
    armed.players.A.mana = 0;
    armed.players.A.maxMana = 0;
    const before = armed.players.A.hp;
    const next = applyMove(armed, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(next.players.A.hp).toBe(before - 1);
    expect(next.players.A.manaBonusThisTurn).toBe(2);
  });

  it('mana bonus from sacrifice clears on end_turn', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const armed: SDState = JSON.parse(JSON.stringify(s));
    armed.players.A.hand = ['sacrifice'];
    const sacrificed = applyMove(armed, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(sacrificed.players.A.manaBonusThisTurn).toBe(2);
    const ended = applyMove(sacrificed, { kind: 'end_turn' }, 'alice-id') as SDState;
    expect(ended.players.A.manaBonusThisTurn).toBe(0);
  });

  it('rejects play if not enough mana', () => {
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'fireball', 0);
    s.players.A.maxMana = 0;
    const result = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id');
    expect('error' in result).toBe(true);
  });
});

describe('spellduel: targeting (Hex / any_player)', () => {
  it('Hex deals 3 damage to a chosen opponent', () => {
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'hex');
    const next = applyMove(
      s,
      { kind: 'play', cardIdx: 0, targets: [{ kind: 'player', seat: 'B' }] },
      'alice-id',
    ) as SDState;
    expect(next.players.B.hp).toBe(STARTING_HP - 3);
    expect(next.players.A.hp).toBe(STARTING_HP);
  });

  it('Hex can be aimed at yourself (player chooses)', () => {
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'hex');
    const next = applyMove(
      s,
      { kind: 'play', cardIdx: 0, targets: [{ kind: 'player', seat: 'A' }] },
      'alice-id',
    ) as SDState;
    expect(next.players.A.hp).toBe(STARTING_HP - 3);
    expect(next.players.B.hp).toBe(STARTING_HP);
  });

  it("rejects Hex with no targets provided", () => {
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'hex');
    const result = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id');
    expect('error' in result).toBe(true);
  });

  it('rejects Hex with too many targets', () => {
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'hex');
    const result = applyMove(
      s,
      {
        kind: 'play', cardIdx: 0,
        targets: [{ kind: 'player', seat: 'A' }, { kind: 'player', seat: 'B' }],
      },
      'alice-id',
    );
    expect('error' in result).toBe(true);
  });

  it("rejects targets supplied for cards that don't expect any", () => {
    // Strike has no targets[] — a client that sends some is buggy / cheating.
    // Reject loudly instead of silently dropping them.
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'strike');
    const next = applyMove(
      s,
      { kind: 'play', cardIdx: 0, targets: [{ kind: 'player', seat: 'A' }] },
      'alice-id',
    );
    expect('error' in next).toBe(true);
  });

  it('Counter still prevents a self-targeted Hex (prevent_damage is target-agnostic)', () => {
    // Arm Counter on A, then have A play Hex on themselves; the trigger fires.
    const s = primeForCard(setupDuel({ firstSeat: 'A' }), 'counter');
    const armed = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(armed.players.A.pendingTriggers.length).toBe(1);

    const prepped = primeForCard(armed, 'hex');
    const next = applyMove(
      prepped,
      { kind: 'play', cardIdx: 0, targets: [{ kind: 'player', seat: 'A' }] },
      'alice-id',
    ) as SDState;
    // Counter prevents 99 damage, so Hex's 3 is fully absorbed.
    expect(next.players.A.hp).toBe(STARTING_HP);
    expect(next.players.A.pendingTriggers.length).toBe(0);
  });
});

describe('spellduel: win conditions', () => {
  it('reduces opp to <=0 HP → opp seat loses, match flips finished', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const armed: SDState = JSON.parse(JSON.stringify(s));
    armed.players.A.hand = ['fireball'];
    armed.players.A.mana = 3;
    armed.players.A.maxMana = 3;
    armed.players.B.hp = 1;
    const next = applyMove(armed, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(next.winner).toBe('A');
    expect(next.phase).toBe('finished');
  });

  it('simultaneous KO: the caster wins (their finishing blow landed)', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const armed: SDState = JSON.parse(JSON.stringify(s));
    armed.players.A.hand = ['strike'];
    armed.players.A.mana = 1;
    armed.players.A.maxMana = 1;
    armed.players.A.hp = 0; // already at 0
    armed.players.B.hp = 1; // Strike kills B
    const next = applyMove(armed, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(next.winner).toBe('A');
  });

  it('refuses moves once finished', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const dead: SDState = JSON.parse(JSON.stringify(s));
    dead.phase = 'finished';
    dead.winner = 'A';
    const result = applyMove(dead, { kind: 'end_turn' }, 'alice-id');
    expect('error' in result).toBe(true);
  });
});

describe('spellduel: log management', () => {
  it('trimLog caps log size to LOG_MAX', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const noisy: SDState = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < LOG_MAX * 3; i++) {
      noisy.log.push({ kind: 'system', text: `entry ${i}` });
    }
    const trimmed = trimLog(noisy);
    expect(trimmed.log.length).toBe(LOG_MAX);
    // We keep the tail; the last entry should be the most-recently-pushed system message.
    const last = trimmed.log[trimmed.log.length - 1];
    expect(last.kind === 'system' && last.text === `entry ${LOG_MAX * 3 - 1}`).toBe(true);
  });
});

describe('spellduel: migration', () => {
  it('upgrades a v1 state (old string-log shape) to v2 (structured events)', () => {
    const v1State = {
      version: 1,
      phase: 'playing',
      seats: { A: 'alice', B: 'bob' },
      players: { A: {}, B: {} },
      currentSeat: 'A',
      turn: 1,
      // Old shape: { seat, text } — should become { kind: 'system', text }
      log: [{ seat: 'A', text: 'Alice played Strike.' }, { seat: 'system', text: 'turn 2' }],
      winner: null,
    };
    const migrated = migrateState(v1State);
    expect(migrated.version).toBe(STATE_VERSION);
    expect(migrated.log).toHaveLength(2);
    expect(migrated.log[0]).toEqual({ kind: 'system', text: 'Alice played Strike.' });
    expect(migrated.log[1]).toEqual({ kind: 'system', text: 'turn 2' });
  });

  it('is idempotent on already-current states', () => {
    const fresh = initialState();
    expect(migrateState(fresh)).toEqual(fresh);
  });
});

describe('spellduel: projectStateForViewer (hand privacy)', () => {
  // The whole point: a player should never receive their opponent's hand
  // contents in the JSON they get from the server. Catches the network-layer
  // info leak that's the foundational fix for richer card games.

  it("hides opponent's hand contents from seated players", () => {
    const s = setupDuel({ firstSeat: 'A' });
    const aliceView = projectStateForViewer(s, 'alice-id');
    // Alice sees her own hand contents...
    expect(aliceView.players.A.hand.every(c => CARDS[c])).toBe(true);
    // ...but Bob's hand is all sentinels (length preserved for the card-back row).
    expect(aliceView.players.B.hand.length).toBe(s.players.B.hand.length);
    expect(aliceView.players.B.hand.every(c => (c as string) === HIDDEN_CARD)).toBe(true);
  });

  it("hides both hands from spectators (viewer not seated)", () => {
    const s = setupDuel({ firstSeat: 'A' });
    const spectatorView = projectStateForViewer(s, 'somebody-else');
    expect(spectatorView.players.A.hand.every(c => (c as string) === HIDDEN_CARD)).toBe(true);
    expect(spectatorView.players.B.hand.every(c => (c as string) === HIDDEN_CARD)).toBe(true);
  });

  it("hides both decks from everyone (deck order is always private)", () => {
    const s = setupDuel({ firstSeat: 'A' });
    const aliceView = projectStateForViewer(s, 'alice-id');
    expect(aliceView.players.A.deck.every(c => (c as string) === HIDDEN_CARD)).toBe(true);
    expect(aliceView.players.B.deck.every(c => (c as string) === HIDDEN_CARD)).toBe(true);
  });

  it("preserves public state (HP, mana, discard, log) so the board still renders correctly", () => {
    const s = setupDuel({ firstSeat: 'A' });
    const view = projectStateForViewer(s, 'alice-id');
    expect(view.players.A.hp).toBe(s.players.A.hp);
    expect(view.players.B.hp).toBe(s.players.B.hp);
    expect(view.players.A.mana).toBe(s.players.A.mana);
    expect(view.currentSeat).toBe(s.currentSeat);
    expect(view.turn).toBe(s.turn);
    expect(view.phase).toBe(s.phase);
  });

  it("does not mutate the source state", () => {
    const s = setupDuel({ firstSeat: 'A' });
    const snapshot = JSON.stringify(s);
    projectStateForViewer(s, 'alice-id');
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('spellduel: state integrity', () => {
  it('initialState stamps current STATE_VERSION', () => {
    expect(initialState().version).toBe(STATE_VERSION);
  });
  it('addPlayer-style flow does not mutate the input state', () => {
    const host = createInitialStateForHost({ userId: 'alice-id', username: 'Alice' });
    const snapshot = JSON.stringify(host);
    seatJoinerAndStart(host, { userId: 'bob-id', username: 'Bob' });
    expect(JSON.stringify(host)).toBe(snapshot);
  });
});

// ── New mechanics (expansion) ────────────────────────────────────────────────

/** Helper: play the active player's only card (index 0) with optional targets. */
function playOnly(state: SDState, targets?: { kind: 'player'; seat: 'A' | 'B' }[]): SDState {
  const me = state.seats[state.currentSeat]!;
  const r = applyMove(state, { kind: 'play', cardIdx: 0, targets }, me);
  if ('error' in r) throw new Error(r.error);
  return r;
}
function endTurn(state: SDState): SDState {
  const me = state.seats[state.currentSeat]!;
  const r = applyMove(state, { kind: 'end_turn' }, me);
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('spellduel: shield trigger (absorb N total)', () => {
  it('Ward absorbs 8 damage across multiple instances, then breaks', () => {
    let s = setupDuel({ firstSeat: 'A' });
    s = primeForCard(s, 'ward');                 // A plays Ward (shield 8)
    s = playOnly(s);
    s = endTurn(s);                              // B's turn
    // B hits A with two 6-damage Overloads (12 total). Shield absorbs 8; 4 lands.
    s = primeForCard(s, 'overload', 99);
    s.players.B.hand = ['overload', 'overload'];
    let r = applyMove(s, { kind: 'play', cardIdx: 0 }, 'bob-id'); if ('error' in r) throw new Error(r.error); s = r;
    r = applyMove(s, { kind: 'play', cardIdx: 0 }, 'bob-id'); if ('error' in r) throw new Error(r.error); s = r;
    expect(s.players.A.hp).toBe(STARTING_HP - 4); // 12 dmg − 8 shield = 4
    expect(s.players.A.pendingTriggers.length).toBe(0); // shield depleted
  });
});

describe('spellduel: burn (damage over time)', () => {
  it('Curse ticks 2 damage at the start of each of the target\'s next 2 turns', () => {
    let s = setupDuel({ firstSeat: 'A' });
    s = primeForCard(s, 'curse');                // A curses B (2 dmg × 2 turns)
    s = playOnly(s);
    expect(s.players.B.burns.length).toBe(1);
    const bStart = s.players.B.hp;
    s = endTurn(s);                              // B's turn begins → tick 1
    expect(s.players.B.hp).toBe(bStart - 2);
    s = endTurn(s);                              // back to A, no tick on A
    s = endTurn(s);                              // B's turn begins → tick 2
    expect(s.players.B.hp).toBe(bStart - 4);
    expect(s.players.B.burns.length).toBe(0);    // burn expired
  });
});

describe('spellduel: silence', () => {
  it('Frostbite stops the opponent casting damage spells next turn', () => {
    let s = setupDuel({ firstSeat: 'A' });
    s = primeForCard(s, 'frostbite');            // A: 3 dmg + silence-damage on B
    s = playOnly(s);
    s = endTurn(s);                              // B's turn, silenced (damage)
    expect(s.players.B.silencedDamage).toBe(true);
    s.players.B.hand = ['strike', 'mend'];
    s.players.B.mana = 9;
    const blocked = applyMove(s, { kind: 'play', cardIdx: 0 }, 'bob-id'); // Strike = damage
    expect('error' in blocked).toBe(true);
    const ok = applyMove(s, { kind: 'play', cardIdx: 1 }, 'bob-id');      // Mend = utility
    expect('error' in ok).toBe(false);
  });
});

describe('spellduel: steal', () => {
  it('Pilfer moves a card from the opponent\'s hand to yours', () => {
    let s = setupDuel({ firstSeat: 'A' });
    s.players.B.hand = ['strike'];
    s = primeForCard(s, 'pilfer');
    const aHandBefore = s.players.A.hand.length; // 1 (just Pilfer)
    s = playOnly(s);
    expect(s.players.B.hand.length).toBe(0);
    expect(s.players.A.hand).toContain('strike');
    expect(s.players.A.hand.length).toBe(aHandBefore - 1 + 1); // -Pilfer +Strike
  });
});

describe('spellduel: extra turn (Time Warp)', () => {
  it('the same player takes another turn instead of passing', () => {
    let s = setupDuel({ firstSeat: 'A' });
    s = primeForCard(s, 'time_warp', 99);
    s = playOnly(s);
    expect(s.players.A.extraTurn).toBe(true);
    s = endTurn(s);
    expect(s.currentSeat).toBe('A');            // still A's turn
    expect(s.players.A.extraTurn).toBeFalsy();  // consumed
  });
});

describe('spellduel: dynamic rares', () => {
  it('Last Gasp deals damage equal to missing HP', () => {
    let s = setupDuel({ firstSeat: 'A' });
    s.players.A.hp = 5;                          // missing 15
    s = primeForCard(s, 'last_gasp', 0);
    s = playOnly(s);
    expect(s.players.B.hp).toBe(STARTING_HP - 15);
  });
  it('Blood Ritual loses half HP and grants that much mana', () => {
    let s = setupDuel({ firstSeat: 'A' });
    s.players.A.hp = 10;
    s = primeForCard(s, 'blood_ritual', 0);
    s = playOnly(s);
    expect(s.players.A.hp).toBe(5);             // lost 5
    expect(s.players.A.manaBonusThisTurn).toBe(5);
  });
});

describe('spellduel: copy (Mirror)', () => {
  it('Mirror re-casts the opponent\'s last spell', () => {
    let s = setupDuel({ firstSeat: 'A' });
    s = primeForCard(s, 'fireball', 99);         // A casts Fireball (4 dmg) → recorded
    s = playOnly(s);
    expect(s.lastSpell?.A).toBe('fireball');
    s = endTurn(s);                              // B's turn
    const aHp = s.players.A.hp;
    s = primeForCard(s, 'mirror', 99);           // B mirrors A's Fireball → 4 dmg to A
    s = playOnly(s);
    expect(s.players.A.hp).toBe(aHp - 4);
  });
});

describe('spellduel: card pool integrity', () => {
  it('has 20 commons, 10 uncommons, 10 rares', () => {
    const byR = { common: 0, uncommon: 0, rare: 0 };
    for (const c of Object.values(CARDS)) byR[c.rarity]++;
    expect(byR.common).toBe(20);
    expect(byR.uncommon).toBe(10);
    expect(byR.rare).toBe(10);
  });
});

describe('spellduel: draft', () => {
  function startDraft(): SDState {
    const host = createInitialStateForHost({ userId: 'alice-id', username: 'Alice' });
    return seatJoinerAndStart(host, { userId: 'bob-id', username: 'Bob' });
  }

  it('round 1 offers 5 commons + 4 uncommons + 3 rares', () => {
    const s = startDraft();
    const a = s.draft!.A;
    expect(a.offer.common.length).toBe(5);
    expect(a.offer.uncommon.length).toBe(4);
    expect(a.offer.rare.length).toBe(3);
    expect(a.need).toEqual({ common: 2, uncommon: 1, rare: 1 });
  });

  it('advances to round 2 only after all four required picks are made', () => {
    let s = startDraft();
    s = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.common[0] }, 'alice-id') as SDState;
    expect(s.draft!.A.round).toBe(1);              // still need 1 common + 1 uncommon + 1 rare
    s = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.common[0] }, 'alice-id') as SDState;
    s = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.uncommon[0] }, 'alice-id') as SDState;
    expect(s.draft!.A.round).toBe(1);              // still need the rare
    s = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.rare[0] }, 'alice-id') as SDState;
    expect(s.draft!.A.round).toBe(2);              // round complete
    expect(s.draft!.A.offer.rare.length).toBe(3);  // rares every round
    expect(s.draft!.A.need.rare).toBe(1);
  });

  it('rejects a pick that is not on offer', () => {
    const s = startDraft();
    const notOffered = CARDS_BY_RARITY.common.find(id => !s.draft!.A.offer.common.includes(id))!;
    const res = applyMove(s, { kind: 'draft_pick', cardId: notOffered }, 'alice-id');
    expect('error' in res).toBe(true);
  });

  it('rejects a third common pick in the same round (need exhausted)', () => {
    let s = startDraft();
    s = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.common[0] }, 'alice-id') as SDState;
    s = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.common[0] }, 'alice-id') as SDState;
    // need.common is now 0; a third common from the remaining offer must fail.
    const res = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.common[0] }, 'alice-id');
    expect('error' in res).toBe(true);
  });

  it('both seats draft in parallel — A picking does not block B', () => {
    let s = startDraft();
    s = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.common[0] }, 'alice-id') as SDState;
    const bPick = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.B.offer.common[0] }, 'bob-id');
    expect('error' in bPick).toBe(false);
  });

  it('final decks respect MAX_COPIES and the 22/11/3 split', () => {
    const both = autoCompleteDraft(startDraft());
    for (const seat of ['A', 'B'] as const) {
      const deck = [...both.players[seat].deck, ...both.players[seat].hand];
      expect(deck.length).toBe(DRAFT_DECK_SIZE);
      const byR = { common: 0, uncommon: 0, rare: 0 };
      const copies: Record<string, number> = {};
      for (const id of deck) {
        byR[CARDS[id].rarity]++;
        copies[id] = (copies[id] ?? 0) + 1;
        expect(copies[id]).toBeLessThanOrEqual(MAX_COPIES[CARDS[id].rarity]);
      }
      expect(byR.common).toBe(DRAFT_DECK_COMMONS);
      expect(byR.uncommon).toBe(DRAFT_DECK_UNCOMMONS);
      expect(byR.rare).toBe(DRAFT_DECK_RARES);
    }
  });

  it('drafts exactly 12 cards on top of the 24-card starter', () => {
    const both = autoCompleteDraft(startDraft());
    // 2 commons + 1 uncommon + 1 rare per round × 3 rounds = 12 drafted.
    expect(DRAFTED_CARDS).toBe(DRAFT_ROUNDS * 4);
    expect(DRAFT_DECK_SIZE).toBe(STARTER_DECK_SIZE + DRAFTED_CARDS);
    expect(both.phase).toBe('playing');
  });

  it('hides the opponent draft offers + picks in projection', () => {
    let s = startDraft();
    s = applyMove(s, { kind: 'draft_pick', cardId: s.draft!.A.offer.common[0] }, 'alice-id') as SDState;
    // Bob's view: his own draft is visible, Alice's offers/picks are hidden.
    const bobView = projectStateForViewer(s, 'bob-id');
    expect(bobView.draft!.B.offer.common.length).toBe(5);   // own offers intact
    expect(bobView.draft!.A.offer.common.length).toBe(0);   // opponent hidden
    expect(bobView.draft!.A.picked.length).toBe(0);         // opponent picks hidden
    expect(bobView.draft!.A.round).toBe(1);                 // progress still public
  });

  it('rejects draft_pick once playing', () => {
    const both = autoCompleteDraft(startDraft());
    const res = applyMove(both, { kind: 'draft_pick', cardId: CARDS_BY_RARITY.common[0] }, 'alice-id');
    expect('error' in res).toBe(true);
  });
});

describe('spellduel: reactions (Counterspell / Reflect)', () => {
  // Put a reaction card (+ mana) into the OFF-turn player's hand so they can
  // respond when the active player casts. Returns state with Alice (seat A) on
  // turn holding a single damage spell, and Bob (seat B) holding the reaction.
  function primeReactionDuel(reactionId: 'counterspell' | 'reflect', casterCard: keyof typeof CARDS = 'fireball'): SDState {
    const s = setupDuel({ firstSeat: 'A' });
    const next: SDState = JSON.parse(JSON.stringify(s));
    next.players.A.hand = [casterCard];
    next.players.A.mana = 99; next.players.A.maxMana = 99;
    next.players.B.hand = [reactionId];
    next.players.B.mana = 99; next.players.B.maxMana = 99;
    return next;
  }

  it('opens a reaction window when the opponent holds an affordable counter', () => {
    const s = primeReactionDuel('counterspell');
    const before = s.players.B.hp;
    const next = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(next.pendingReaction).toBeTruthy();
    expect(next.pendingReaction!.reactorSeat).toBe('B');
    expect(next.pendingReaction!.casterSeat).toBe('A');
    // Spell paused — damage hasn't landed yet.
    expect(next.players.B.hp).toBe(before);
  });

  it('only the reactor may act while a reaction is pending', () => {
    const s = primeReactionDuel('counterspell');
    const paused = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    // Alice (the caster) cannot act now.
    const blocked = applyMove(paused, { kind: 'end_turn' }, 'alice-id');
    expect('error' in blocked).toBe(true);
    // Bob can pass.
    const ok = applyMove(paused, { kind: 'pass_reaction' }, 'bob-id');
    expect('error' in ok).toBe(false);
  });

  it('Counterspell fizzles the pending spell (no damage, card spent)', () => {
    const s = primeReactionDuel('counterspell');
    const before = s.players.B.hp;
    const paused = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    const done = applyMove(paused, { kind: 'play_reaction', cardIdx: 0 }, 'bob-id') as SDState;
    expect(done.pendingReaction).toBeFalsy();
    expect(done.players.B.hp).toBe(before);               // no damage landed
    expect(done.players.B.hand).not.toContain('counterspell'); // reaction spent
    expect(done.players.B.discard).toContain('counterspell');
  });

  it('pass_reaction lets the spell resolve normally', () => {
    const s = primeReactionDuel('counterspell');
    const fireball = CARDS.fireball.effects.find(e => e.kind === 'damage')!.amount;
    const before = s.players.B.hp;
    const paused = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    const done = applyMove(paused, { kind: 'pass_reaction' }, 'bob-id') as SDState;
    expect(done.players.B.hp).toBe(before - fireball);
  });

  it('Reflect sends a damage spell back at its caster', () => {
    const s = primeReactionDuel('reflect');
    const fireball = CARDS.fireball.effects.find(e => e.kind === 'damage')!.amount;
    const casterBefore = s.players.A.hp;
    const targetBefore = s.players.B.hp;
    const paused = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    const done = applyMove(paused, { kind: 'play_reaction', cardIdx: 0 }, 'bob-id') as SDState;
    expect(done.players.A.hp).toBe(casterBefore - fireball); // caster eats it
    expect(done.players.B.hp).toBe(targetBefore);            // reactor untouched
  });

  it('does NOT open a reflect-only window for a non-damage spell', () => {
    // Bob holds only Reflect; Alice casts a pure utility spell (Insight = draw).
    const s = primeReactionDuel('reflect', 'insight');
    const next = applyMove(s, { kind: 'play', cardIdx: 0 }, 'alice-id') as SDState;
    expect(next.pendingReaction).toBeFalsy();
  });

  it('rejects playing a reaction card on your own turn', () => {
    const s = setupDuel({ firstSeat: 'A' });
    const primed = primeForCard(s, 'counterspell');
    const result = applyMove(primed, { kind: 'play', cardIdx: 0 }, 'alice-id');
    expect('error' in result).toBe(true);
  });
});
