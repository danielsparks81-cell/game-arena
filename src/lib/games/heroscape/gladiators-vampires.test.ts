// Gladiators + Esenwein vampires (2026-07-01) — fidelity regression tests against the
// printed card text (roster.json / the official card scans). Each test encodes a specific
// clause (threshold, target restriction, per-turn limit, once-per-game) so a later edit
// that breaks the rule trips a red test (rules-fidelity §review).
//
// Staging trick (borrowed from big-heroes.test.ts): quick battle → markers on `s0-finn`,
// seat 0 wins initiative, then the card's id is SWAPPED to the card under test (figure
// `s0-finn-1` becomes it). Extra allies are ADDED surgically (the quick army holds only
// finn+tarn for seat 0), so any card combination can be staged.
import { describe, it, expect } from 'vitest';
import {
  initialState,
  addPlayer,
  applyAction,
  attackDiceRequirements,
  effectiveMove,
  effectiveAttackDice,
  effectiveDefenseDice,
  carryPassengers,
  capuanInitiativeBonus,
  summonRechetsSpaces,
  chillingTouchTargets,
  bloodHungryTargets,
} from './engine';
import { MAPS } from './maps';
import { neighborKeys } from './board';
import type { CombatFace, HSResult, HSState, InitiativeAttempt, OrderMarkerValue } from './types';

const F = (spec: string): CombatFace[] => [...spec].map(c => (c === 'k' ? 'skull' : c === 's' ? 'shield' : 'blank'));
const blanks = (n: number): CombatFace[] => Array.from({ length: Math.max(0, n) }, () => 'blank' as CombatFace);
const ATT = (r0: number, r1: number): InitiativeAttempt => [{ seat: 0, roll: r0 }, { seat: 1, roll: r1 }];

function unwrap(r: HSResult): HSState {
  if ('error' in r) throw new Error(`unexpected engine error: ${r.error}`);
  return r;
}
function errOf(r: HSResult): string {
  if (!('error' in r)) throw new Error('expected an engine error, got a state');
  return r.error;
}
const allOn = (uid: string) => (['1', '2', '3', 'X'] as const).map(marker => ({ marker, cardUid: uid }) as { marker: OrderMarkerValue; cardUid: string });

/** Quick battle staged into 'turns' with seat 0 active, markers on `s0-finn`, whose card id
 *  is then swapped to `heroCardId`. Every figure starts OFF the board except the hero and a
 *  far-away seat-1 figure (`park`) that keeps the elimination check quiet. */
function stage(heroCardId: string): { s: HSState; hero: string; park: string } {
  let s = initialState();
  s = addPlayer(s, 'p1', 'Alice', 0, '#10b981');
  s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
  s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'quick' }));
  s = unwrap(applyAction(s, 'p1', { kind: 'place_markers', assignments: allOn('s0-finn') }));
  s = unwrap(applyAction(s, 'p2', { kind: 'place_markers', assignments: allOn('s1-thorgrim') }));
  s = unwrap(applyAction(s, 'p2', { kind: 'roll_initiative', attempts: [ATT(15, 3)] }));
  s = JSON.parse(JSON.stringify(s)) as HSState;
  s.cards.find(c => c.uid === 's0-finn')!.cardId = heroCardId;
  const cells = Object.keys(MAPS[s.mapId].cells);
  const park = 's1-marro_warriors-4';
  for (const f of s.figures) { f.at = null; f.at2 = null; }
  s.figures.find(f => f.id === 's0-finn-1')!.at = cells[0];
  s.figures.find(f => f.id === park)!.at = cells[cells.length - 1];
  return { s, hero: 's0-finn-1', park };
}

const at = (s: HSState, id: string): string | null => s.figures.find(f => f.id === id)?.at ?? null;

/** Surgically add an EXTRA card (+ n figures, off-board or in reserve) — the quick army
 *  holds only finn+tarn for seat 0, so allies like Sonya / the Rechets are added this way. */
function addCard(s: HSState, uid: string, cardId: string, seat: number, n: number, opts?: { reserve?: boolean }): void {
  s.cards.push({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
  for (let i = 1; i <= n; i++) {
    s.figures.push({
      id: `${uid}-${i}`,
      cardUid: uid,
      ownerSeat: seat,
      at: null,
      index: i,
      wounds: 0,
      ...(opts?.reserve ? { reserve: true } : {}),
    });
  }
}

const put = (s: HSState, id: string, key: string): HSState => {
  const n = JSON.parse(JSON.stringify(s)) as HSState;
  const f = n.figures.find(x => x.id === id)!;
  f.at = key;
  f.at2 = null;
  return n;
};
/** The engine-computed defense-dice count for target vs attacker (so tests never hardcode it). */
const defDice = (s: HSState, attackerId: string, targetId: string): number =>
  Math.max(0, attackDiceRequirements(s, attackerId, targetId)!.defense);
/** An on-map neighbor key of `key`. */
const adjOf = (s: HSState, key: string, skip: string[] = []): string => {
  const cells = MAPS[s.mapId].cells;
  const n = neighborKeys(key).find(k => cells[k] && !skip.includes(k));
  if (!n) throw new Error('no free neighbor');
  return n;
};

describe('Brunak — Blood Hungry Special Attack + Carry', () => {
  it('is Range 1 Attack 4; a KILL re-arms the chain, a non-kill ends it', () => {
    const { s: base, hero } = stage('brunak');
    let s = base;
    // Two 1-life enemies adjacent to Brunak (Marro Warriors).
    const brunakAt = at(s, hero)!;
    const e1 = 's1-marro_warriors-1', e2 = 's1-marro_warriors-2';
    s = put(s, e1, adjOf(s, brunakAt));
    s = put(s, e2, adjOf(s, brunakAt, [at(s, e1)!]));
    expect(new Set(bloodHungryTargets(s, hero))).toEqual(new Set([e1, e2]));
    // Swing 1: 4 flat attack dice, all skulls → the 1-life Marro dies → chain armed.
    s = unwrap(applyAction(s, 'p1', { kind: 'blood_hungry', attackerId: hero, targetId: e1, attackRoll: F('kkkk'), defenseRoll: blanks(defDice(s, hero, e1)) }));
    expect(at(s, e1)).toBeNull();
    expect(s.bloodHungryChain).toBe(true);
    // Swing 2 (the chain): misses → chain ends…
    s = unwrap(applyAction(s, 'p1', { kind: 'blood_hungry', attackerId: hero, targetId: e2, attackRoll: F('----'), defenseRoll: blanks(defDice(s, hero, e2)) }));
    expect(at(s, e2)).not.toBeNull();
    expect(s.bloodHungryChain).toBe(false);
    // …so a third swing is rejected ("until he does not destroy a figure").
    expect(errOf(applyAction(s, 'p1', { kind: 'blood_hungry', attackerId: hero, targetId: e2, attackRoll: F('kkkk'), defenseRoll: blanks(defDice(s, hero, e2)) })))
      .toMatch(/chain|adjacent/i);
  });

  it('Brunak has Carry (the generic carrier gate — an adjacent unengaged friendly small/medium)', () => {
    const { s: base, hero } = stage('brunak');
    let s = base;
    const friend = 's0-tarn_vikings-1'; // friendly small/medium
    s = put(s, friend, adjOf(s, at(s, hero)!));
    expect(carryPassengers(s, 0)).toContain(friend);
  });
});

describe('Crixus — One Shield Defense', () => {
  // Crixus DEFENDS: seat 0's active attacker swings at a seat-1 Crixus.
  function crixusDefends(attackRoll: CombatFace[], defenseRoll: (n: number) => CombatFace[]): HSState {
    const { s: base, hero } = stage('drake'); // Drake: Attack 6 — plenty of skulls to overrun the cap
    let s = base;
    s.cards.find(c => c.uid === 's1-thorgrim')!.cardId = 'crixus';
    const crixus = 's1-thorgrim-1';
    s = put(s, crixus, adjOf(s, at(s, hero)!));
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    const dd = defDice(s, hero, crixus);
    return unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: crixus, attackRoll, defenseRoll: defenseRoll(dd) }));
  }
  it('with at least one shield, the most wounds Crixus may take for this attack is ONE', () => {
    // 6 skulls vs 1 shield = 5 unblocked — capped at 1 wound.
    const s = crixusDefends(F('kkkkkk'), n => ['shield', ...blanks(n - 1)]);
    expect(s.figures.find(f => f.id === 's1-thorgrim-1')!.wounds).toBe(1);
  });
  it('with NO shield the cap does not apply (full wounds land)', () => {
    const s = crixusDefends(F('kkkkkk'), n => blanks(n));
    // Crixus life 5 — 6 unblocked skulls destroy him outright.
    expect(at(s, 's1-thorgrim-1')).toBeNull();
  });
  it('the cap also applies to SPECIAL attacks ("when rolling defense dice" is unconditional on attack type)', () => {
    // Brunak's Blood Hungry (Attack 4) vs a defending Crixus who rolls one shield: 4 skulls − 1
    // shield = 3 unblocked, capped at 1 — a defender keeps its defensive powers vs specials
    // (the same ruling that keeps Stealth Dodge and height).
    const { s: base, hero } = stage('brunak');
    let s = base;
    s.cards.find(c => c.uid === 's1-thorgrim')!.cardId = 'crixus';
    const crixus = 's1-thorgrim-1';
    s = put(s, crixus, adjOf(s, at(s, hero)!));
    const dd = defDice(s, hero, crixus);
    s = unwrap(applyAction(s, 'p1', { kind: 'blood_hungry', attackerId: hero, targetId: crixus, attackRoll: F('kkkk'), defenseRoll: ['shield', ...blanks(dd - 1)] }));
    expect(s.figures.find(f => f.id === crixus)!.wounds).toBe(1);
  });
});

describe('Retiarius — Net Trip 14', () => {
  it('14+ caps a small/medium defender at 1 die for HIS attacks this turn; once per turn', () => {
    const { s: base, hero } = stage('retiarius');
    let s = base;
    const enemy = 's1-thorgrim-1'; // Medium hero — dice > 1 without the net
    s = put(s, enemy, adjOf(s, at(s, hero)!));
    const before = defDice(s, hero, enemy);
    expect(before).toBeGreaterThan(1);
    s = unwrap(applyAction(s, 'p1', { kind: 'net_trip', d20: 14 }));
    expect(s.netTripActive).toBe(true);
    expect(defDice(s, hero, enemy)).toBe(1);
    // One roll per turn.
    expect(errOf(applyAction(s, 'p1', { kind: 'net_trip', d20: 20 }))).toMatch(/once per turn/i);
  });
  it('a 13 fails (needs 14) and the defense is unchanged', () => {
    const { s: base, hero } = stage('retiarius');
    let s = base;
    const enemy = 's1-thorgrim-1';
    s = put(s, enemy, adjOf(s, at(s, hero)!));
    const before = defDice(s, hero, enemy);
    s = unwrap(applyAction(s, 'p1', { kind: 'net_trip', d20: 13 }));
    expect(s.netTripActive).toBeFalsy();
    expect(defDice(s, hero, enemy)).toBe(before);
  });
});

describe('Rechets of Bogdan — Lethal Sting', () => {
  it('all skulls vs a small/medium figure destroys it outright (no defense)', () => {
    const { s: base, hero } = stage('rechets_of_bogdan');
    let s = base;
    const enemy = 's1-thorgrim-1'; // Medium 4, life 5 — normally survives 3 skulls easily
    s = put(s, enemy, adjOf(s, at(s, hero)!));
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    const dd = defDice(s, hero, enemy);
    const atkDice = attackDiceRequirements(s, hero, enemy)!.attack;
    // Every attack die a skull + ALL shields rolled — the defense is ignored and Thorgrim dies.
    s = unwrap(applyAction(s, 'p1', {
      kind: 'attack', attackerId: hero, targetId: enemy,
      attackRoll: Array.from({ length: atkDice }, () => 'skull' as CombatFace),
      defenseRoll: Array.from({ length: dd }, () => 'shield' as CombatFace),
    }));
    expect(at(s, enemy)).toBeNull();
  });
  it("One Shield Defense can't save Crixus from the sting — 'cannot roll ANY defense dice' voids his shields", () => {
    const { s: base, hero } = stage('rechets_of_bogdan');
    let s = base;
    s.cards.find(c => c.uid === 's1-thorgrim')!.cardId = 'crixus'; // Medium — sting-eligible
    const crixus = 's1-thorgrim-1';
    s = put(s, crixus, adjOf(s, at(s, hero)!));
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    const dd = defDice(s, hero, crixus);
    const atkDice = attackDiceRequirements(s, hero, crixus)!.attack;
    // All skulls + ALL shields: the (void) defense roll must not trigger the One-Shield cap.
    s = unwrap(applyAction(s, 'p1', {
      kind: 'attack', attackerId: hero, targetId: crixus,
      attackRoll: Array.from({ length: atkDice }, () => 'skull' as CombatFace),
      defenseRoll: Array.from({ length: dd }, () => 'shield' as CombatFace),
    }));
    expect(at(s, crixus)).toBeNull(); // destroyed outright
  });
});

describe('Esenwein vampires — Life Drain + Eternal Heartbreak', () => {
  it('a kill removes a wound marker from the vampire card', () => {
    const { s: base, hero } = stage('cyprien_esenwein');
    let s = base;
    s.figures.find(f => f.id === hero)!.wounds = 2; // pre-wounded vampire
    const prey = 's1-marro_warriors-1'; // 1-life squaddie
    s = put(s, prey, adjOf(s, at(s, hero)!));
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: prey, attackRoll: F('kkk'), defenseRoll: blanks(defDice(s, hero, prey)) }));
    expect(at(s, prey)).toBeNull();
    expect(s.figures.find(f => f.id === hero)!.wounds).toBe(1); // fed
  });

  it('Eternal Heartbreak: when the owner’s Cyprien is destroyed, Sonya immediately receives 2 wounds', () => {
    // Seat 0's active Drake kills SEAT 1's Cyprien while seat 1's Sonya is on the board.
    const { s: base, hero } = stage('drake');
    let s = base;
    s.cards.find(c => c.uid === 's1-thorgrim')!.cardId = 'cyprien_esenwein';
    addCard(s, 's1-sonya', 'sonya_esenwein', 1, 1);
    const cyprien = 's1-thorgrim-1', sonya = 's1-sonya-1';
    s = put(s, cyprien, adjOf(s, at(s, hero)!));
    s = put(s, sonya, adjOf(s, at(s, hero)!, [at(s, cyprien)!]));
    s.figures.find(f => f.id === cyprien)!.wounds = 5; // one skull finishes him (life 6)
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: cyprien, attackRoll: F('kkkkkk'), defenseRoll: blanks(defDice(s, hero, cyprien)) }));
    expect(at(s, cyprien)).toBeNull();
    expect(s.figures.find(f => f.id === sonya)!.wounds).toBe(2);
  });
});

describe('Cyprien — Chilling Touch (+ Sonya’s Eternal Strength)', () => {
  it('wound bands: 13→1, 20→6; Soulborgs are immune; once per turn', () => {
    const { s: base, hero } = stage('cyprien_esenwein');
    let s = base;
    const enemy = 's1-thorgrim-1'; // life 5
    s = put(s, enemy, adjOf(s, at(s, hero)!));
    expect(chillingTouchTargets(s, hero)).toContain(enemy);
    const s13 = unwrap(applyAction(s, 'p1', { kind: 'chilling_touch', targetId: enemy, d20: 13 }));
    expect(s13.figures.find(f => f.id === enemy)!.wounds).toBe(1);
    // once per turn
    expect(errOf(applyAction(s13, 'p1', { kind: 'chilling_touch', targetId: enemy, d20: 20 }))).toMatch(/once per turn/i);
    // a natural 20 = 6 wounds (life 5 → destroyed)
    const s20 = unwrap(applyAction(s, 'p1', { kind: 'chilling_touch', targetId: enemy, d20: 20 }));
    expect(at(s20, enemy)).toBeNull();
    // Soulborgs are immune — a Zettian Guard never appears in the target list.
    const sb = JSON.parse(JSON.stringify(s)) as HSState;
    sb.cards.find(c => c.uid === 's1-thorgrim')!.cardId = 'zettian_guards';
    expect(chillingTouchTargets(sb, hero)).not.toContain(enemy);
  });

  it('Eternal Strength: a living friendly Sonya adds +2 (an 18 reaches the 20-band = 6 wounds)', () => {
    const { s: base, hero } = stage('cyprien_esenwein');
    let s = base;
    addCard(s, 's0-sonya', 'sonya_esenwein', 0, 1);
    const enemy = 's1-thorgrim-1', sonya = 's0-sonya-1';
    s = put(s, enemy, adjOf(s, at(s, hero)!));
    s = put(s, sonya, adjOf(s, at(s, hero)!, [at(s, enemy)!]));
    // 18 + 2 (Eternal Strength) = 20 → the 6-wound band; life 5 → destroyed.
    const s18 = unwrap(applyAction(s, 'p1', { kind: 'chilling_touch', targetId: enemy, d20: 18 }));
    expect(at(s18, enemy)).toBeNull();
  });
});

describe('Marcu — Eternal Hatred', () => {
  /** Stage with the SWAP BEFORE markers so revealing the marker triggers the reveal hook. */
  function stageMarcu(): HSState {
    let s = initialState();
    s = addPlayer(s, 'p1', 'Alice', 0, '#10b981');
    s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
    s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'quick' }));
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.cards.find(c => c.uid === 's0-finn')!.cardId = 'marcu_esenwein';
    s = unwrap(applyAction(s, 'p1', { kind: 'place_markers', assignments: allOn('s0-finn') }));
    s = unwrap(applyAction(s, 'p2', { kind: 'place_markers', assignments: allOn('s1-thorgrim') }));
    return unwrap(applyAction(s, 'p2', { kind: 'roll_initiative', attempts: [ATT(15, 3)] }));
  }
  it('revealing his marker forces the d20; <17 → Marcu obeys, 17+ → the opponent controls him this turn', () => {
    const s0 = stageMarcu();
    expect(s0.pendingChoice?.kind).toBe('eternal_hatred'); // the roll is MANDATORY, gated before anything else
    // Miss: 16 — the choice clears and the owner keeps the turn.
    const obey = unwrap(applyAction(s0, 'p1', { kind: 'resolve_choice', choice: { kind: 'eternal_hatred', d20: 16 } }));
    expect(obey.pendingChoice).toBeUndefined();
    expect(obey.marcuControlSeat).toBeUndefined();
    // Hit: 17 with ONE living opponent → control auto-assigns to seat 1.
    const hate = unwrap(applyAction(s0, 'p1', { kind: 'resolve_choice', choice: { kind: 'eternal_hatred', d20: 17 } }));
    expect(hate.marcuControlSeat).toBe(1);
    // The OWNER is locked out of the turn; the CONTROLLER may act (ends the turn here).
    expect(errOf(applyAction(hate, 'p1', { kind: 'end_turn' }))).toMatch(/not your turn/i);
    const ended = unwrap(applyAction(hate, 'p2', { kind: 'end_turn' }));
    expect(ended.marcuControlSeat).toBeUndefined(); // control returns at the end of the turn
  });
});

describe('Iskra — Summon the Rechets of Bogdan', () => {
  function stageIskra(): { s: HSState; hero: string; rechetsUid: string } {
    const { s: base, hero } = stage('iskra_esenwein');
    const s = base;
    const rechetsUid = 's0-rechets';
    addCard(s, rechetsUid, 'rechets_of_bogdan', 0, 3, { reserve: true });
    return { s, hero, rechetsUid };
  }
  it('offers the summon AFTER her turn; 14+ places the bats within 6 clear sight; once per game after success', () => {
    const { s: base, rechetsUid } = stageIskra();
    // End Iskra's turn → the offer opens (slot advance deferred).
    let s = unwrap(applyAction(base, 'p1', { kind: 'end_turn' }));
    expect(s.pendingChoice?.kind).toBe('summon_rechets');
    // Attempt with a 20 → the placement step.
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'summon_rechets', d20: 20 } }));
    const spaces = summonRechetsSpaces(s);
    expect(spaces.length).toBeGreaterThanOrEqual(3);
    const picks = spaces.slice(0, 3);
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'summon_rechets', placements: picks, takeTurn: false } }));
    const bats = s.figures.filter(f => f.cardUid === rechetsUid);
    expect(bats.filter(b => b.at != null)).toHaveLength(3); // all 3 landed
    expect(bats.every(b => !b.reserve)).toBe(true);
    expect(s.rechetsSummoned).toContain(rechetsUid);
    expect(s.pendingChoice).toBeUndefined(); // and the slot advanced
  });
  it('a failed roll (13) keeps them in reserve and the attempt can repeat next turn', () => {
    const { s: base, rechetsUid } = stageIskra();
    let s = unwrap(applyAction(base, 'p1', { kind: 'end_turn' }));
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'summon_rechets', d20: 13 } }));
    expect(s.figures.filter(f => f.cardUid === rechetsUid).every(f => f.reserve)).toBe(true);
    expect(s.rechetsSummoned ?? []).not.toContain(rechetsUid);
  });

  it('a bat landing on a choice-glyph DEFERS the slot advance until the glyph choice chain closes', () => {
    // Regression: advance() used to run with the glyph choice still open — beginTurnOrSkip could
    // then stack Eternal Hatred (or a bond offer) ON TOP of it, vaporizing the glyph's effect.
    const { s: base } = stageIskra();
    let s = unwrap(applyAction(base, 'p1', { kind: 'end_turn' }));
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'summon_rechets', d20: 20 } }));
    const picks = summonRechetsSpaces(s).slice(0, 3);
    s.glyphs = [{ id: 'oreld', at: picks[0], faceUp: false }]; // face-down under the first landing space
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'summon_rechets', placements: picks, takeTurn: false } }));
    // The Oreld choice opened; the slot advance is OWED, not run — the turn has not moved on.
    expect(s.pendingChoice?.kind).toBe('glyph_oreld');
    expect(s.advanceAfterChoice).toBe(true);
    expect(s.turnNumber).toBe(1);
    // Step 1 (the d20) leaves Oreld's step 2 open — the advance keeps waiting through the chain.
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', d20: 20 } }));
    expect(s.pendingChoice?.kind).toBe('glyph_oreld');
    expect(s.advanceAfterChoice).toBe(true);
    // Step 2 (name the victim) closes the chain → the owed advance finally runs.
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', victimSeat: 1 } }));
    expect(s.pendingChoice).toBeUndefined();
    expect(s.advanceAfterChoice).toBeUndefined();
    expect(s.turnNumber).toBe(2); // Iskra's marker-2 turn began (seat 1's stripped/wiped slots skipped)
  });

  it('TWO bats on TWO choice-glyphs: the second stop QUEUES and fires after the first resolves', () => {
    // Regression: the deferred choice-glyph used to be revealed with a "waits for the open
    // choice" log — and then never fired (its effect was silently lost).
    const { s: base } = stageIskra();
    let s = unwrap(applyAction(base, 'p1', { kind: 'end_turn' }));
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'summon_rechets', d20: 20 } }));
    const picks = summonRechetsSpaces(s).slice(0, 3);
    s.glyphs = [
      { id: 'oreld', at: picks[0], faceUp: false },
      { id: 'oreld', at: picks[1], faceUp: false },
    ];
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'summon_rechets', placements: picks, takeTurn: false } }));
    // First bat's Oreld is open; the second bat's stop is queued (revealed, effect pending).
    expect(s.pendingChoice?.kind).toBe('glyph_oreld');
    expect(s.pendingChoice && 'at' in s.pendingChoice ? s.pendingChoice.at : null).toBe(picks[0]);
    expect(s.pendingGlyphStops).toHaveLength(1);
    // Resolving the first (a 1 = backfire, single-step) immediately opens the SECOND Oreld.
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', d20: 1 } }));
    expect(s.pendingChoice?.kind).toBe('glyph_oreld');
    expect(s.pendingChoice && 'at' in s.pendingChoice ? s.pendingChoice.at : null).toBe(picks[1]);
    expect(s.pendingGlyphStops).toBeUndefined(); // queue drained
    expect(s.advanceAfterChoice).toBe(true); // and the advance is STILL owed
    // Closing the second finally releases the advance.
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', d20: 1 } }));
    expect(s.pendingChoice).toBeUndefined();
    expect(s.advanceAfterChoice).toBeUndefined();
  });
});

describe('Spartacus + Capuan Gladiators — Inspiration + Initiative Advantage + Bonding', () => {
  /** Seat 0 fields Spartacus + Crixus + the Capuan Gladiators. Markers: `spartacusFirst`
   *  puts 1 on Spartacus / 2 on Crixus / 3+X on the Capuans; otherwise 1 on the CAPUANS
   *  (so their marker-turn opens the bond offer). */
  function stageGladiators(spartacusFirst = true): HSState {
    let s = initialState();
    s = addPlayer(s, 'p1', 'Alice', 0, '#10b981');
    s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
    s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'quick' }));
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.cards.find(c => c.uid === 's0-finn')!.cardId = 'spartacus';
    s.cards.find(c => c.uid === 's0-tarn_vikings')!.cardId = 'crixus';
    addCard(s, 's0-capuan', 'capuan_gladiators', 0, 3);
    // The Capuans need a living figure on the board for their marker/turn.
    const cells = Object.keys(MAPS[s.mapId].cells);
    const free = cells.filter(k => !s.figures.some(f => f.at === k || f.at2 === k));
    s.figures.find(f => f.id === 's0-capuan-1')!.at = free[0];
    s = unwrap(applyAction(s, 'p1', {
      kind: 'place_markers',
      assignments: spartacusFirst
        ? [
            { marker: '1', cardUid: 's0-finn' },
            { marker: '2', cardUid: 's0-tarn_vikings' },
            { marker: '3', cardUid: 's0-capuan' },
            { marker: 'X', cardUid: 's0-capuan' },
          ]
        : [
            { marker: '1', cardUid: 's0-capuan' },
            { marker: '2', cardUid: 's0-finn' },
            { marker: '3', cardUid: 's0-capuan' },
            { marker: 'X', cardUid: 's0-capuan' },
          ],
    }));
    s = unwrap(applyAction(s, 'p2', { kind: 'place_markers', assignments: allOn('s1-thorgrim') }));
    return s;
  }
  it('Initiative Advantage: +1 per marker on the Capuan card (2 here), only while ALL markers are on Gladiators', () => {
    const s = stageGladiators();
    expect(capuanInitiativeBonus(s, 0)).toBe(2); // markers 3 + X sit on the Capuans
    expect(capuanInitiativeBonus(s, 1)).toBe(0); // Thorgrim is no Gladiator
  });
  it('Gladiator Inspiration: all markers on Gladiators + one on Spartacus → the OTHERS gain +1 move/attack/defense', () => {
    let s = stageGladiators();
    // Carry seat 0's Capuan initiative bonus so the engine accepts the roll.
    s = unwrap(applyAction(s, 'p2', {
      kind: 'roll_initiative',
      attempts: [[{ seat: 0, raw: 15, bonus: 2, roll: 17 }, { seat: 1, roll: 3 }]],
    }));
    const inspired = s.inspiredCardUids ?? [];
    expect(inspired).toContain('s0-tarn_vikings'); // Crixus
    expect(inspired).toContain('s0-capuan'); // Capuans
    expect(inspired).not.toContain('s0-finn'); // "except Spartacus"
    // The folds: an inspired Crixus is +1 move, +1 attack die, +1 defense die over printed.
    const crixus = s.figures.find(f => f.cardUid === 's0-tarn_vikings')!;
    const enemy = s.figures.find(f => f.cardUid === 's1-thorgrim')!;
    expect(effectiveMove(s, crixus).breakdown).toContain('+1 Inspired');
    expect(effectiveAttackDice(s, crixus, enemy, true).breakdown).toContain('+1 Inspired');
    expect(effectiveDefenseDice(s, crixus, enemy).breakdown).toContain('+1 Inspired');
    // Spartacus himself gets none of it.
    const spartacus = s.figures.find(f => f.cardUid === 's0-finn')!;
    expect(effectiveMove(s, spartacus).breakdown).not.toContain('+1 Inspired');
  });
  it('Human Gladiator Hero Bonding: the Capuans’ marker-turn offers a bonus turn with a Gladiator HERO', () => {
    let s = stageGladiators(false); // marker 1 on the CAPUANS → their turn opens the bond offer
    s = unwrap(applyAction(s, 'p2', {
      kind: 'roll_initiative',
      attempts: [[{ seat: 0, raw: 15, bonus: 3, roll: 18 }, { seat: 1, roll: 3 }]],
    }));
    expect(s.pendingChoice?.kind).toBe('bond');
    if (s.pendingChoice?.kind === 'bond') {
      // Both Gladiator HEROES (Spartacus + Crixus) are eligible partners; never the squad itself.
      expect(new Set(s.pendingChoice.partnerCardUids)).toEqual(new Set(['s0-finn', 's0-tarn_vikings']));
    }
  });
});
