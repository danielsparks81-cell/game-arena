import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createInitialStateForHost,
  addPlayer,
  startGame,
  projectStateForViewer,
  getActivePlayerId,
  HQ_SIZE,
  CITY_SIZE,
  STARTER_TROOPERS,
  STARTER_AGENTS,
  STARTING_HAND_SIZE,
  getCard,
  type LegendaryState,
  type CardInstance,
} from './index';

function freshSinglePlayerGame(): LegendaryState {
  const host = createInitialStateForHost({ userId: 'alice', username: 'Alice' });
  const started = startGame(host);
  if ('error' in started) throw new Error(started.error);
  return started;
}

describe('legendary: setup', () => {
  it('createInitialStateForHost seats the host at seat 0 in lobby phase', () => {
    const s = createInitialStateForHost({ userId: 'alice', username: 'Alice' });
    expect(s.phase).toBe('lobby');
    expect(s.players).toHaveLength(1);
    expect(s.players[0].seat).toBe(0);
  });

  it('addPlayer appends new players in seat order', () => {
    const a = createInitialStateForHost({ userId: 'alice', username: 'Alice' });
    const ab = addPlayer(a, 'bob', 'Bob', 1);
    expect(ab.players.map(p => p.username)).toEqual(['Alice', 'Bob']);
  });

  it('startGame populates HQ to 5, deals 6 to the active player, builds villain deck', () => {
    const s = freshSinglePlayerGame();
    expect(s.phase).toBe('playing');
    expect(s.hq).toHaveLength(HQ_SIZE);
    expect(s.hq.filter(c => c !== null)).toHaveLength(HQ_SIZE);
    expect(s.city.every(c => c === null)).toBe(true); // city starts empty
    expect(s.players[0].hand).toHaveLength(STARTING_HAND_SIZE);
    expect(s.players[0].deck.length + s.players[0].discard.length + s.players[0].hand.length)
      .toBe(STARTER_TROOPERS + STARTER_AGENTS);
    expect(s.villainDeck.length).toBeGreaterThan(0);
  });
});

describe('legendary: play card', () => {
  it('playing a Trooper bumps Attack by 1', () => {
    const s = freshSinglePlayerGame();
    const trooper = s.players[0].hand.find(c => c.cardId === 'shield_trooper');
    if (!trooper) {
      // 8/12 starter cards are Troopers, so the opening hand of 6 is extremely
      // unlikely to miss them; if it did this run, skip.
      expect(true).toBe(true);
      return;
    }
    const next = applyAction(s, 'alice', { kind: 'play_card', instanceId: trooper.instanceId }) as LegendaryState;
    expect(next.thisTurn.attack).toBe(1);
  });

  it('playing an Agent bumps Recruit by 1', () => {
    const s = freshSinglePlayerGame();
    const agent = s.players[0].hand.find(c => c.cardId === 'shield_agent');
    if (!agent) { expect(true).toBe(true); return; }
    const next = applyAction(s, 'alice', { kind: 'play_card', instanceId: agent.instanceId }) as LegendaryState;
    expect(next.thisTurn.recruit).toBe(1);
  });

  it("rejects play_card when it's not your turn", () => {
    const a = createInitialStateForHost({ userId: 'alice', username: 'Alice' });
    const ab = addPlayer(a, 'bob', 'Bob', 1);
    const started = startGame(ab);
    if ('error' in started) throw new Error(started.error);
    // Alice (seat 0) is the active player. Bob trying to play is rejected.
    const result = applyAction(
      started, 'bob',
      { kind: 'play_card', instanceId: started.players[0].hand[0].instanceId },
    );
    expect('error' in result).toBe(true);
  });
});

describe('legendary: recruit + fight', () => {
  it('cannot recruit a hero you cannot afford', () => {
    const s = freshSinglePlayerGame();
    const result = applyAction(s, 'alice', { kind: 'recruit_hero', slot: 0 });
    expect('error' in result).toBe(true); // 0 Recruit on a fresh turn
  });

  it('end_turn drains hand into discard, deals new 6, reveals a villain-deck card', () => {
    const s = freshSinglePlayerGame();
    const before = s.players[0].hand.length;
    const beforeVD = s.villainDeck.length;
    const next = applyAction(s, 'alice', { kind: 'end_turn' }) as LegendaryState;
    // Hand reset to 6 (or fewer if deck is small — but starter has 12 so 6 is fine)
    expect(next.players[0].hand).toHaveLength(STARTING_HAND_SIZE);
    // At least one Villain-deck card was revealed. We assert "shrank" rather
    // than "exactly −1" because freshSinglePlayerGame() picks a RANDOM scheme,
    // and some schemes' twists reveal extra Villain-deck cards (e.g. Bank
    // Robbery's onTwist does villain_deck_reveal_top) — so a single end_turn
    // can legitimately drop the deck by more than 1.
    expect(next.villainDeck.length).toBeLessThan(beforeVD);
    // Turn counter advanced
    expect(next.turn).toBe(2);
    void before;
  });
});

describe('legendary: hand privacy projection', () => {
  it("hides another player's hand and deck contents from the viewer", () => {
    const a = createInitialStateForHost({ userId: 'alice', username: 'Alice' });
    const ab = addPlayer(a, 'bob', 'Bob', 1);
    const started = startGame(ab);
    if ('error' in started) throw new Error(started.error);
    const viewForAlice = projectStateForViewer(started, 'alice');
    const alicePlayer = viewForAlice.players.find(p => p.playerId === 'alice')!;
    const bobPlayer = viewForAlice.players.find(p => p.playerId === 'bob')!;
    // Alice sees her own hand contents
    expect(alicePlayer.hand.every(c => c.cardId !== '__hidden__')).toBe(true);
    // Bob's hand and deck are scrubbed
    expect(bobPlayer.hand.every(c => c.cardId === '__hidden__')).toBe(true);
    expect(bobPlayer.deck.every(c => c.cardId === '__hidden__')).toBe(true);
    // Alice's own deck is also scrubbed (deck is private even from owner)
    expect(alicePlayer.deck.every(c => c.cardId === '__hidden__')).toBe(true);
    // Villain deck is opaque to everyone
    expect(viewForAlice.villainDeck.every(c => c.cardId === '__hidden__')).toBe(true);
  });
});

describe('legendary: city + escape', () => {
  it('a revealed villain enters slot 0 of the City', () => {
    let s = freshSinglePlayerGame();
    // Keep ending turns until a Villain/Henchman surfaces into the city, or
    // the Villain Deck is exhausted. A fixed iteration cap was flaky: with a
    // random scheme the deck can be front-loaded with non-city reveals
    // (twists/bystanders — Killbots alone seeds 18 bystanders), so 6 turns
    // weren't always enough. The deck always CONTAINS villain/henchman cards,
    // so looping to exhaustion is deterministic. Hard cap guards infinite
    // loops if the game ends first.
    for (let i = 0; i < 120; i++) {
      if (s.city.some(c => c !== null)) break;
      if (s.villainDeck.length === 0 || s.phase === 'finished' || s.result) break;
      // Solo play sets interactive prompts (solo-twist tuck, master-strike KO,
      // escape KO) that block end_turn. Clear any pending choice first so we
      // can keep ending turns until a city card surfaces.
      if (s.thisTurn.pendingChoice) {
        const skipped = applyAction(s, 'alice', { kind: 'skip_choice' });
        if (!('error' in skipped)) { s = skipped as LegendaryState; continue; }
        // Mandatory (unskippable) choice — resolve it by picking the first
        // legal card in hand, else bail.
        const firstCard = s.players[0].hand[0];
        if (firstCard) {
          const resolved = applyAction(s, 'alice', { kind: 'resolve_choice', instanceId: firstCard.instanceId });
          if (!('error' in resolved)) { s = resolved as LegendaryState; continue; }
        }
        break;
      }
      const next = applyAction(s, 'alice', { kind: 'end_turn' });
      if ('error' in next) break;
      s = next as LegendaryState;
    }
    const anyInCity = s.city.some(c => c !== null);
    // Even with bad luck, by turn 6+ we should have something villain-shaped in the city.
    expect(anyInCity).toBe(true);
  });
});

describe('legendary: defeat mastermind → win', () => {
  it('landing the final hit arms the win; End Turn commits it', () => {
    let s = freshSinglePlayerGame();
    const mmDef = getCard(s.mastermindId);
    if (mmDef.kind !== 'mastermind') throw new Error('Bad mastermind id');
    // Cheat the Attack pool up so we can land all hits in one turn (the
    // engine doesn't care WHERE the attack came from — only that the
    // current player has enough).
    s.thisTurn.attack = mmDef.attack * mmDef.hits;
    for (let i = 0; i < mmDef.hits; i++) {
      const next = applyAction(s, 'alice', { kind: 'fight_mastermind' });
      if ('error' in next) throw new Error(String(next.error));
      s = next as LegendaryState;
      // A tactic's Fight effect may set an interactive pending choice (e.g.
      // Red Skull Tactic 1 reveals 3 cards). Clear it before the next hit:
      // skip if allowed, else resolve by picking the first revealed card.
      let guard = 0;
      while (s.thisTurn.pendingChoice && guard++ < 10) {
        const skipped = applyAction(s, 'alice', { kind: 'skip_choice' });
        if (!('error' in skipped)) { s = skipped as LegendaryState; continue; }
        const ch = s.thisTurn.pendingChoice as { cards?: { instanceId: string }[] };
        const pick = ch.cards?.[0]?.instanceId;
        if (!pick) break;
        const resolved = applyAction(s, 'alice', { kind: 'resolve_choice', instanceId: pick });
        if ('error' in resolved) break;
        s = resolved as LegendaryState;
      }
    }
    // Per the official rules the player FINISHES their turn after the killing
    // blow (collecting any last VP). So the win is only ARMED here — the
    // engine sets pendingResult='win' but keeps phase='playing'.
    expect(s.pendingResult).toBe('win');
    expect(s.phase).toBe('playing');

    // Pressing End Turn commits the win.
    const after = applyAction(s, 'alice', { kind: 'end_turn' });
    if ('error' in after) throw new Error(String(after.error));
    s = after as LegendaryState;
    expect(s.phase).toBe('finished');
    expect(s.result).toBe('win');
  });
});

describe('legendary: HQ slot count + Player VP', () => {
  it('HQ stays at HQ_SIZE slots after a buy + refill', () => {
    const s = freshSinglePlayerGame();
    // Manually crank Recruit so we can buy.
    s.thisTurn.recruit = 99;
    // Find the cheapest hero in HQ and buy it.
    const slot = s.hq.findIndex(c => {
      const d = c ? getCard(c.cardId) : null;
      return d?.kind === 'hero';
    });
    expect(slot).toBeGreaterThanOrEqual(0);
    const next = applyAction(s, 'alice', { kind: 'recruit_hero', slot }) as LegendaryState;
    expect(next.hq.filter(c => c !== null)).toHaveLength(HQ_SIZE);
    expect(next.players[0].discard.length).toBe(1);
  });
});

describe('legendary: Skrull Invasion scheme', () => {
  function skrullGame(): LegendaryState {
    const host = createInitialStateForHost({ userId: 'alice', username: 'Alice' });
    host.schemeId = 'scheme_skrull_invasion';
    const started = startGame(host);
    if ('error' in started) throw new Error(started.error);
    return started;
  }

  it('seeds 12 Hero-Skrulls into the Villain Deck and forces the Skrulls group', () => {
    const s = skrullGame();
    expect(s.skrullHeroes?.length).toBe(12);
    expect(s.villainGroupIds).toContain('skrulls');
    const tagged = new Set(s.skrullHeroes);
    const heroesInVD = s.villainDeck.filter(c => tagged.has(c.instanceId));
    expect(heroesInVD).toHaveLength(12);
    expect(heroesInVD.every(c => getCard(c.cardId).kind === 'hero')).toBe(true);
  });

  it('a Hero-Skrull is fightable at [cost]+2 and is GAINED (to discard) on defeat', () => {
    const s = skrullGame();
    // Move a tagged Hero out of the deck into city slot 0.
    const tagged = new Set(s.skrullHeroes);
    const idx = s.villainDeck.findIndex(c => tagged.has(c.instanceId));
    const heroCard = s.villainDeck.splice(idx, 1)[0];
    s.city[0] = heroCard;
    const def = getCard(heroCard.cardId);
    const cost = def.kind === 'hero' ? def.cost : 0;

    // Not enough attack (cost+1) → fight rejected.
    s.thisTurn.attack = cost + 1;
    const tooWeak = applyAction(s, 'alice', { kind: 'fight_city', slot: 0 });
    expect('error' in tooWeak).toBe(true);

    // Exactly cost+2 → defeat. Hero goes to discard (gained), not VP, and is
    // no longer a Skrull; no VP awarded.
    s.thisTurn.attack = cost + 2;
    const beforeDiscard = s.players[0].discard.length;
    const beforeVp = s.players[0].victoryPile.length;
    const next = applyAction(s, 'alice', { kind: 'fight_city', slot: 0 });
    if ('error' in next) throw new Error(String(next.error));
    const ns = next as LegendaryState;
    expect(ns.players[0].discard.some(c => c.instanceId === heroCard.instanceId)).toBe(true);
    expect(ns.players[0].discard.length).toBe(beforeDiscard + 1);
    expect(ns.players[0].victoryPile.length).toBe(beforeVp);
    expect(ns.skrullHeroes?.includes(heroCard.instanceId)).toBe(false);
    expect(ns.city[0]).toBeNull();
  });
});

describe('legendary: Magneto sequential Master Strike', () => {
  // Build a 3-player game and stage a Magneto Master Strike that has just been
  // revealed: revealer = Alice (seat 0), next active player = Bob (seat 1),
  // and the engine is mid-sequence with Alice's discard prompt up. The strike
  // must resolve for EVERY player in turn order (Alice → Bob → Carol) before
  // control returns to the new active player (Bob).
  function makeMagnetoStrikeInProgress(): LegendaryState {
    let s = createInitialStateForHost({ userId: 'alice', username: 'Alice' });
    s = addPlayer(s, 'bob', 'Bob', 1);
    s = addPlayer(s, 'carol', 'Carol', 2);
    const started = startGame(s);
    if ('error' in started) throw new Error(started.error);
    const g = started;

    // Force Magneto as the Mastermind.
    g.mastermindId = 'mm_magneto';
    g.mastermind.cardId = 'mm_magneto';

    const trooper = (n: string): CardInstance => ({ instanceId: n, cardId: 'shield_trooper' });
    // Alice (revealer) + Bob each hold 6 non-X-Men cards → must discard down to
    // 4. Carol holds only 4 → no discard needed (auto-resolves with no prompt).
    g.players[0].hand = [0, 1, 2, 3, 4, 5].map(i => trooper(`a${i}`));
    g.players[1].hand = [0, 1, 2, 3, 4, 5].map(i => trooper(`b${i}`));
    g.players[2].hand = [0, 1, 2, 3].map(i => trooper(`c${i}`));

    // New active player after the reveal/advance is Bob (seat 1).
    g.currentPlayerIdx = 1;

    // Stage the in-progress sequential strike: Alice (seat 0) is head of queue.
    g.pendingStrike = { kind: 'magneto', revealerSeat: 0 };
    g.strikeQueue = [0, 1, 2];
    g.thisTurn.choiceOwnerSeat = 0;
    g.thisTurn.pendingChoice = {
      kind: 'discard_from_hand', bonus: [], mandatory: true, sources: ['hand'], remaining: 1,
    };
    return g;
  }

  function resolveOwnerDiscards(s: LegendaryState, playerId: string, count: number): LegendaryState {
    for (let i = 0; i < count; i++) {
      const owner = s.players.find(p => p.seat === s.thisTurn.choiceOwnerSeat)!;
      const cardId = owner.hand[0].instanceId;
      const r = applyAction(s, playerId, { kind: 'resolve_choice', instanceId: cardId });
      if ('error' in r) throw new Error(String(r.error));
      s = r;
    }
    return s;
  }

  it('routes control to the head-of-queue owner, not the active player', () => {
    const s = makeMagnetoStrikeInProgress();
    expect(getActivePlayerId(s)).toBe('alice'); // owner, despite currentPlayerIdx = Bob
  });

  it('rejects choice resolution from a player who is not the current owner', () => {
    const s = makeMagnetoStrikeInProgress();
    const r = applyAction(s, 'bob', { kind: 'resolve_choice', instanceId: 'a0' });
    expect('error' in r).toBe(true);
  });

  it('resolves each player in turn order, then hands control to the active player', () => {
    let s = makeMagnetoStrikeInProgress();

    // Alice discards down to 4 (2 cards). After her chain clears, the queue
    // advances to Bob (seat 1).
    s = resolveOwnerDiscards(s, 'alice', 2);
    expect(s.players[0].hand).toHaveLength(4);
    expect(s.thisTurn.choiceOwnerSeat).toBe(1);
    expect(getActivePlayerId(s)).toBe('bob');

    // Alice can no longer act — it's Bob's turn in the queue.
    const aliceBlocked = applyAction(s, 'alice', { kind: 'resolve_choice', instanceId: s.players[1].hand[0].instanceId });
    expect('error' in aliceBlocked).toBe(true);

    // Bob discards down to 4 (2 cards). Carol (4 cards) auto-resolves with no
    // prompt, so the queue drains and the strike finishes.
    s = resolveOwnerDiscards(s, 'bob', 2);
    expect(s.players[1].hand).toHaveLength(4);
    expect(s.players[2].hand).toHaveLength(4); // untouched — no discard needed

    // Strike fully resolved: bookkeeping cleared, control back to Bob.
    expect(s.pendingStrike).toBeUndefined();
    expect(s.strikeQueue).toBeUndefined();
    expect(s.thisTurn.choiceOwnerSeat).toBeUndefined();
    expect(getActivePlayerId(s)).toBe('bob');
  });
});

describe('legendary: Scheme Twist fires once (not per-player)', () => {
  it('Super Hero Civil War KOs the HQ exactly once on a single twist (multiplayer)', () => {
    let s = createInitialStateForHost({ userId: 'alice', username: 'Alice' });
    s = addPlayer(s, 'bob', 'Bob', 1);
    s.schemeId = 'scheme_super_hero_civil_war';
    const started = startGame(s);
    if ('error' in started) throw new Error(started.error);
    const g = started;

    // Force the next Villain Deck reveal to be a Scheme Twist.
    g.villainDeck.unshift({ instanceId: 'twist-1', cardId: 'scheme_twist' });
    const twistsBefore = g.schemeTwistsRevealed;

    const r = applyAction(g, 'alice', { kind: 'end_turn' });
    if ('error' in r) throw new Error(String(r.error));
    const ns = r as LegendaryState;

    // Exactly one twist was revealed...
    expect(ns.schemeTwistsRevealed).toBe(twistsBefore + 1);
    // ...and the HQ-KO effect logged exactly once (the bug fired it per-player).
    const koLines = ns.log.filter(
      e => e.kind === 'system' && /Heroes? KO'd from the HQ/.test(e.text),
    );
    expect(koLines).toHaveLength(1);
  });
});

void CITY_SIZE;
