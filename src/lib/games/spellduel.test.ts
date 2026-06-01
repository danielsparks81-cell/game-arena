import { describe, it, expect } from 'vitest';
import {
  CARDS,
  HIDDEN_CARD,
  STARTING_HP,
  STARTING_HAND_SIZE,
  STATE_VERSION,
  applyMove,
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
  // Build a "real" duel through the public API, then force first-turn seat if
  // requested so the rest of the test can be deterministic about whose move it is.
  const host = createInitialStateForHost({ userId: 'alice-id', username: 'Alice', accent_color: '#10b981' });
  const both = seatJoinerAndStart(host, { userId: 'bob-id', username: 'Bob', accent_color: '#f59e0b' });
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
  it('creates a lobby state when only the host is seated', () => {
    const s = createInitialStateForHost({ userId: 'alice-id', username: 'Alice' });
    expect(s.phase).toBe('lobby');
    expect(s.seats.A).toBe('alice-id');
    expect(s.seats.B).toBeUndefined();
    expect(s.players.A.hp).toBe(STARTING_HP);
    expect(s.players.A.hand.length).toBe(STARTING_HAND_SIZE);
    // Both decks are pre-shuffled in advance so the joiner doesn't get to
    // observe a known order.
    expect(s.players.B.hand.length).toBe(STARTING_HAND_SIZE);
    expect(s.players.B.deck.length).toBeGreaterThan(0);
  });

  it('seatJoinerAndStart fills seat B, flips to playing, gives starter 1 mana', () => {
    const host = createInitialStateForHost({ userId: 'alice-id', username: 'Alice' });
    const both = seatJoinerAndStart(host, { userId: 'bob-id', username: 'Bob' });
    expect(both.phase).toBe('playing');
    expect(both.seats.B).toBe('bob-id');
    expect(['A', 'B']).toContain(both.currentSeat);
    expect(both.players[both.currentSeat].maxMana).toBe(1);
    expect(both.players[both.currentSeat].mana).toBe(1);
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
  it('has 20 commons, 8 uncommons, 10 rares (reactions add 2 uncommons later)', () => {
    const byR = { common: 0, uncommon: 0, rare: 0 };
    for (const c of Object.values(CARDS)) byR[c.rarity]++;
    expect(byR.common).toBe(20);
    expect(byR.uncommon).toBe(8);
    expect(byR.rare).toBe(10);
  });
});
