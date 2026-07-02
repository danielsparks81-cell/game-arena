// Big Heroes special powers (slice 8b) — fidelity regression tests against the
// printed card text in docs/heroscape/big-heroes-powers.md. Each test encodes a
// specific clause (range, threshold, target restriction, per-turn limit) so a
// later edit that breaks the rule trips a red test (rules-fidelity §review).
//
// Scenario trick: a Big Hero is a 1-figure Hero, so we stage the fixed quick
// army (markers on `s0-finn`, p1 wins initiative → seat 0 active) and SWAP that
// card's id to the Big Hero — figure `s0-finn-1` becomes it. Then we teleport
// figures to exact range/adjacency and feed the engine FIXED server dice. The
// `def()` helper rolls the EXACT number of (blank) defense dice the engine wants
// for a defender, so a test never hard-codes a defender's die count.
import { describe, it, expect } from 'vitest';
import {
  initialState,
  addPlayer,
  applyAction,
  effectiveDefenseDice,
  effectiveAttackDice,
  effectiveMove,
  carryPassengers,
  aiNextAction,
  aiPendingSeat,
  iceShardTargets,
  mindShackleTargets,
  queglixDiceLeft,
  queglixTargets,
  throwLandingHexes,
  canTheDrop,
  livingSeats,
  theDropHexes,
  legalTargets,
  legalDestinations,
  activatableFigureIds,
  carryLandingHexes,
  carryDestFootprint,
} from './engine';
import { rangeDistance, neighborKeys } from './board';
import { HS_CARDS } from './content';
import { MAPS } from './maps';
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

/** Quick battle staged into 'turns' with seat 0 active, markers on `s0-finn`,
 *  whose card id is then swapped to `heroCardId` (figure `s0-finn-1` becomes it).
 *  Every figure is wiped off the board; a far-away seat-1 figure (`park`) stays
 *  alive so the elimination check never fires mid-scenario. */
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

/** Teleport figure `id` onto hex `key`; returns a fresh state. */
function put(s: HSState, id: string, key: string | null): HSState {
  const c = JSON.parse(JSON.stringify(s)) as HSState;
  const f = c.figures.find(x => x.id === id)!;
  f.at = key;
  f.at2 = null;
  return c;
}
/** Stage prior-round damage on a figure. */
function wound(s: HSState, id: string, n: number): HSState {
  const c = JSON.parse(JSON.stringify(s)) as HSState;
  c.figures.find(x => x.id === id)!.wounds = n;
  return c;
}
/** The exact blank defense roll the engine expects for `targetId` defending vs
 *  `attackerId` — so a test never has to hard-code a defender's die count. */
const def = (s: HSState, targetId: string, attackerId: string): CombatFace[] =>
  blanks(effectiveDefenseDice(s, s.figures.find(f => f.id === targetId)!, s.figures.find(f => f.id === attackerId)!).dice);

/** A clear-LOS cell exactly `dist` away from `fromKey`, excluding occupied hexes
 *  and `used`. Flat Training Field → same-distance cells have line of sight. */
function cellAtDist(s: HSState, fromKey: string, dist: number, used: string[] = []): string {
  const cells = MAPS[s.mapId].cells;
  const occ = new Set(s.figures.filter(f => f.at != null).flatMap(f => [f.at, f.at2].filter(Boolean) as string[]));
  for (const k of Object.keys(cells)) {
    if (used.includes(k) || k === fromKey || occ.has(k)) continue;
    if (rangeDistance(cells, fromKey, k) === dist) return k;
  }
  throw new Error(`no cell at distance ${dist} from ${fromKey}`);
}
/** Two distinct empty neighbours of `key` (different directions → neither blocks
 *  the other's line of sight back to `key`). */
function twoNeighbors(s: HSState, key: string): [string, string] {
  const cells = MAPS[s.mapId].cells;
  const occ = new Set(s.figures.filter(f => f.at != null).flatMap(f => [f.at, f.at2].filter(Boolean) as string[]));
  const ns = neighborKeys(key).filter(k => cells[k] && !occ.has(k));
  if (ns.length < 2) throw new Error(`fewer than 2 free neighbours of ${key}`);
  return [ns[0], ns[1]];
}

// ===========================================================================
// Pooled common — per-marker ACTIVATION CAP (owner 2026-06-28): drafting N copies
// of a common pools their figures onto ONE card, but a revealed marker still
// activates only the printed squad size (any 3 Arrow Gruts), not the whole pool.
// ===========================================================================
describe('Pooled common — activation cap', () => {
  it('a revealed marker activates only the printed squad size; the rest of the pool is locked', () => {
    // Stage seat 0 active with the marker on s0-finn, then swap that card to Arrow Gruts (squad size 3).
    let { s } = stage('arrow_gruts');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    const card = 's0-finn'; // the (swapped) Arrow Gruts card uid
    // Pool 5 Gruts onto the card (as if 2 copies were drafted): stage gave us s0-finn-1; add 4 more on
    // distinct empty cells. The cap is the PRINTED size (3), not the figure count (5).
    const occ = new Set(s.figures.filter(f => f.at != null).map(f => f.at));
    const free = Object.keys(MAPS[s.mapId].cells).filter(k => !occ.has(k));
    for (let i = 2; i <= 5; i++) {
      s.figures.push({ id: `${card}-${i}`, cardUid: card, ownerSeat: 0, at: free[i - 2], index: i, wounds: 0 });
    }
    const gruts = s.figures.filter(f => f.cardUid === card).map(f => f.id);
    expect(gruts).toHaveLength(5);
    // Nothing activated yet → ANY of the 5 may start (the cap only bites once 3 have been chosen).
    expect(activatableFigureIds(s).sort()).toEqual([...gruts].sort());
    // Activate 3 distinct Gruts (moved this turn).
    s.movedFigureIds = [gruts[0], gruts[1], gruts[2]];
    // Cap (squad size 3) is now full → only those 3 stay activatable; the 4th & 5th are locked.
    expect(activatableFigureIds(s).sort()).toEqual([gruts[0], gruts[1], gruts[2]].sort());
    // The 4th Grut — though it never moved — can no longer act: no legal destinations, and the engine
    // rejects a direct move of it.
    expect(legalDestinations(s, gruts[3]).size).toBe(0);
    const dest = cellAtDist(s, at(s, gruts[3])!, 1);
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: gruts[3], to: dest }))).toMatch(/may act this turn|already activated/i);
  });
});

// ===========================================================================
// Nilfheim — ICE SHARD BREATH: Range 5, Attack 4, up to 3 attacks, no repeats
// ===========================================================================
describe('Nilfheim — Ice Shard Breath', () => {
  it('attacks up to 3 DIFFERENT figures (R5 A4); a 4th shot is rejected', () => {
    let { s, hero } = stage('nilfheim');
    // Move Nilfheim to an interior hex so it has ≥4 free neighbours, then put
    // four enemies in different directions (all Range 5, clear sight — they
    // can't block each other). Range is covered by the boundary test below.
    const interior = Object.keys(MAPS[s.mapId].cells).find(k => neighborKeys(k).filter(n => MAPS[s.mapId].cells[n]).length >= 4)!;
    s = put(s, hero, interior);
    const ring = neighborKeys(at(s, hero)!).filter(k => MAPS[s.mapId].cells[k]);
    s = put(s, 's1-thorgrim-1', ring[0]);
    s = put(s, 's1-marro_warriors-1', ring[1]);
    s = put(s, 's1-marro_warriors-2', ring[2]);
    s = put(s, 's1-marro_warriors-3', ring[3]);
    s = unwrap(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('kbbb'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    // 3D VFX: the shard records a board effect from Nilfheim to the target's hex.
    expect(s.lastEffect?.kind).toBe('ice_shard');
    expect(s.lastEffect?.to).toEqual([ring[0]]);
    s = unwrap(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-marro_warriors-1', attackRoll: F('kbbb'), defenseRoll: def(s, 's1-marro_warriors-1', hero) }));
    s = unwrap(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-marro_warriors-2', attackRoll: F('kbbb'), defenseRoll: def(s, 's1-marro_warriors-2', hero) }));
    expect(at(s, 's1-thorgrim-1')).toBe(ring[0]); // 1 wound, survives
    expect(at(s, 's1-marro_warriors-1')).toBeNull(); // destroyed
    expect(at(s, 's1-marro_warriors-2')).toBeNull(); // destroyed
    // A 4th Ice Shard is over the cap of 3.
    expect(errOf(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-marro_warriors-3', attackRoll: F('kbbb'), defenseRoll: def(s, 's1-marro_warriors-3', hero) }))).toMatch(/at most 3/i);
  });

  it('cannot attack the same figure twice', () => {
    let { s, hero } = stage('nilfheim');
    s = put(s, 's1-thorgrim-1', cellAtDist(s, at(s, hero)!, 5));
    s = unwrap(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('kbbb'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    expect(errOf(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('kbbb'), defenseRoll: def(s, 's1-thorgrim-1', hero) }))).toMatch(/same figure twice/i);
  });

  it('rejects a target beyond Range 5, and blocks the normal attack after an Ice Shard', () => {
    let { s, hero } = stage('nilfheim');
    const h = at(s, hero)!;
    s = put(s, 's1-thorgrim-1', cellAtDist(s, h, 6));
    expect(errOf(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('kbbb'), defenseRoll: F('bbbb') }))).toMatch(/range|sight/i);
    s = put(s, 's1-thorgrim-1', cellAtDist(s, h, 5));
    s = unwrap(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('bbbb'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    expect(errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('k'), defenseRoll: F('b') }))).toMatch(/already/i);
  });

  it('iceShardTargets lists only in-range enemies not yet hit', () => {
    let { s, hero } = stage('nilfheim');
    const h = at(s, hero)!;
    s = put(s, 's1-thorgrim-1', cellAtDist(s, h, 5));
    s = put(s, 's1-marro_warriors-1', cellAtDist(s, h, 6, [at(s, 's1-thorgrim-1')!]));
    expect(iceShardTargets(s, hero)).toEqual(['s1-thorgrim-1']);
  });
});

// ===========================================================================
// Major Q9 — QUEGLIX GUN: Range 8 (= his normal RANGE), 9-die pool spent 1-3 per shot
// ===========================================================================
describe('Major Q9 — Queglix Gun', () => {
  it('spends a 9-die pool 1-3 at a time; a shot exceeding the pool is rejected', () => {
    let { s, hero } = stage('major_q9');
    s = put(s, 's1-thorgrim-1', cellAtDist(s, at(s, hero)!, 6)); // well within Range 8
    expect(queglixDiceLeft(s)).toBe(9);
    for (let i = 0; i < 3; i++) {
      s = unwrap(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 3, attackRoll: F('bbb'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    }
    expect(queglixDiceLeft(s)).toBe(0);
    expect(errOf(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 1, attackRoll: F('b'), defenseRoll: def(s, 's1-thorgrim-1', hero) }))).toMatch(/dice left|already/i);
  });

  it('Queglix reaches Q9\'s full RANGE 8 — as far as his normal attack (regression: was capped at 6)', () => {
    const { s, hero } = stage('major_q9');
    const h = at(s, hero)!;
    // Wherever Q9's NORMAL attack can reach (its Range is 8), the Queglix gun must reach too —
    // a foe at range 7-8 used to be "out of range/sight" for the gun while a normal shot hit it.
    for (const dist of [1, 6, 7, 8]) {
      const s2 = put(s, 's1-thorgrim-1', cellAtDist(s, h, dist));
      expect(legalTargets(s2, hero)).toContain('s1-thorgrim-1'); // normal attack reaches it…
      expect(queglixTargets(s2, hero)).toContain('s1-thorgrim-1'); // …and so does Queglix now
    }
  });

  it('rejects 0 or 4 dice per shot and a target beyond Range 8', () => {
    let { s, hero } = stage('major_q9');
    const h = at(s, hero)!;
    s = put(s, 's1-thorgrim-1', cellAtDist(s, h, 6));
    expect(errOf(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 4 as 1, attackRoll: F('bbbb'), defenseRoll: F('bbbb') }))).toMatch(/1, 2, or 3/i);
    s = put(s, 's1-thorgrim-1', cellAtDist(s, h, 9)); // beyond Range 8
    expect(errOf(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 1, attackRoll: F('b'), defenseRoll: F('bbbb') }))).toMatch(/range|sight/i);
  });

  it('an ENGAGED Major Q9 may only Queglix a figure he is engaged with (no shooting past engagement)', () => {
    let { s, hero } = stage('major_q9');
    const h = at(s, hero)!;
    const adj = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!; // adjacent cell
    s = put(s, 's1-thorgrim-1', adj);                              // adjacent → engages Q9
    s = put(s, 's1-marro_warriors-1', cellAtDist(s, h, 4));        // in Range 6 but NOT engaged
    // 04-combat p.13: an engaged figure can't shoot past its engagement, even with
    // a ranged SPECIAL attack — the far, non-engaged enemy is rejected.
    expect(errOf(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-marro_warriors-1', dice: 1, attackRoll: F('s'), defenseRoll: F('b') }))).toMatch(/range|sight|engage/i);
    // …but Q9 may still Queglix the enemy he IS engaged with.
    s = unwrap(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 1, attackRoll: F('s'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    expect(s.turnAttacks.some(a => a.special === 'queglix')).toBe(true);
  });
});

// ===========================================================================
// Jotun — WILD SWING: Range 1, Attack 4, splash to figures adjacent to target
// ===========================================================================
describe("Warrior's Spirit fires from EVERY kill site (audit O1 — owner report 2026-06-24)", () => {
  // "When Eldgrim died I wasn't prompted to add the Warrior's Spirit to another army card." Before
  // this, only a NORMAL attack (and falls/swipes) queued the Spirit; special attacks, Chomp and the
  // Massive Curse silently dropped it. Now a Viking Champion (Finn/Thorgrim/Eldgrim) destroyed by ANY
  // kill site offers its Spirit to ITS owner.
  it('a SPECIAL attack (Ice Shard) destroying Thorgrim opens his Warrior Armor Spirit', () => {
    let { s, hero } = stage('nilfheim');
    const interior = Object.keys(MAPS[s.mapId].cells).find(k => neighborKeys(k).filter(n => MAPS[s.mapId].cells[n]).length >= 4)!;
    s = put(s, hero, interior);
    const ring = neighborKeys(at(s, hero)!).filter(k => MAPS[s.mapId].cells[k]);
    s = put(s, 's1-thorgrim-1', ring[0]); // adjacent → within Ice Shard Range 5
    // 4 skulls vs Thorgrim's 4 blank defense = 4 wounds ≥ Life 4 → destroyed by the special attack.
    s = unwrap(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('kkkk'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    expect(at(s, 's1-thorgrim-1')).toBeNull(); // destroyed
    expect(s.pendingChoice?.kind).toBe('spirit_placement'); // …Spirit offered (was the bug: nothing happened)
    expect(s.pendingChoice?.seat).toBe(1); // to THORGRIM'S owner, not the attacker
    if (s.pendingChoice?.kind === 'spirit_placement') expect(s.pendingChoice.spirit).toBe('defense'); // Warrior's Armor
  });

  it('CHOMP devouring a Champion still leaves its Spirit', () => {
    let { s, hero } = stage('grimnak');
    const adj = neighborKeys(at(s, hero)!).find(k => MAPS[s.mapId].cells[k])!;
    s = put(s, 's1-thorgrim-1', adj); // adjacent → a legal Chomp target (Hero needs d20 ≥ 16)
    s = unwrap(applyAction(s, 'p1', { kind: 'chomp', targetId: 's1-thorgrim-1', d20: 20 }));
    expect(at(s, 's1-thorgrim-1')).toBeNull(); // devoured
    expect(s.pendingChoice?.kind).toBe('spirit_placement'); // …Spirit still offered
    expect(s.pendingChoice?.seat).toBe(1);
  });
});

describe('Jotun — Wild Swing', () => {
  it('hits the target AND figures adjacent to it, but never Jotun himself', () => {
    let { s, hero } = stage('jotun');
    const h = at(s, hero)!;
    const tgtHex = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!;
    const splashHex = neighborKeys(tgtHex).find(k => MAPS[s.mapId].cells[k] && k !== h && !neighborKeys(h).includes(k))
      ?? neighborKeys(tgtHex).find(k => MAPS[s.mapId].cells[k] && k !== h)!;
    s = put(s, 's1-marro_warriors-1', tgtHex);
    s = put(s, 's1-marro_warriors-2', splashHex);
    const defenders = [
      { figureId: 's1-marro_warriors-1', roll: def(s, 's1-marro_warriors-1', hero) },
      { figureId: 's1-marro_warriors-2', roll: def(s, 's1-marro_warriors-2', hero) },
    ];
    s = unwrap(applyAction(s, 'p1', { kind: 'wild_swing', attackerId: hero, targetId: 's1-marro_warriors-1', attackRoll: F('kbbb'), defenseRolls: defenders }));
    expect(at(s, 's1-marro_warriors-1')).toBeNull(); // 1 skull, Life 1 → dead
    expect(at(s, 's1-marro_warriors-2')).toBeNull(); // splash, same skull → dead
    expect(at(s, hero)).toBe(h); // Jotun untouched
  });

  it('captures EACH affected figure’s own defense roll in lastAttack.defenseGroups', () => {
    // The overlay reveals every splash victim's defense separately, so the engine
    // must keep each figure's roll/shields/outcome distinct — never flattened or
    // dropped. Two victims roll DIFFERENT defense: one whiffs (dies), one fully
    // blocks (survives). The groups must reflect both, independently.
    let { s, hero } = stage('jotun');
    const h = at(s, hero)!;
    const tgtHex = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!;
    const splashHex = neighborKeys(tgtHex).find(k => MAPS[s.mapId].cells[k] && k !== h && !neighborKeys(h).includes(k))
      ?? neighborKeys(tgtHex).find(k => MAPS[s.mapId].cells[k] && k !== h)!;
    s = put(s, 's1-marro_warriors-1', tgtHex);
    s = put(s, 's1-marro_warriors-2', splashHex);
    const whiff = def(s, 's1-marro_warriors-1', hero);                       // all blanks → 0 shields
    const block = def(s, 's1-marro_warriors-2', hero).map(() => 'shield' as CombatFace); // all shields → blocks
    s = unwrap(applyAction(s, 'p1', { kind: 'wild_swing', attackerId: hero, targetId: 's1-marro_warriors-1', attackRoll: F('kbbb'), defenseRolls: [
      { figureId: 's1-marro_warriors-1', roll: whiff },
      { figureId: 's1-marro_warriors-2', roll: block },
    ] }));
    const groups = s.lastAttack?.defenseGroups;
    expect(groups).toBeDefined();
    expect(groups!.length).toBe(2); // one entry per affected figure, not flattened
    const dead = groups!.find(g => g.destroyed)!;
    const lived = groups!.find(g => !g.destroyed)!;
    // The whiffer: its OWN roll (all blanks), 0 shields, destroyed.
    expect(dead.shields).toBe(0);
    expect(dead.roll).toEqual(whiff);
    expect(dead.wounds).toBeGreaterThan(0);
    // The blocker: its OWN (all-shield) roll, shields = its die count, no wound.
    expect(lived.shields).toBe(block.length);
    expect(lived.roll).toEqual(block);
    expect(lived.wounds).toBe(0);
    expect(at(s, 's1-marro_warriors-2')).not.toBeNull(); // fully blocked → survives
  });

  it('Range 1 — a non-adjacent target is rejected', () => {
    let { s, hero } = stage('jotun');
    s = put(s, 's1-thorgrim-1', cellAtDist(s, at(s, hero)!, 2));
    expect(errOf(applyAction(s, 'p1', { kind: 'wild_swing', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('kbbb'), defenseRolls: [{ figureId: 's1-thorgrim-1', roll: F('bbbb') }] }))).toMatch(/adjacent/i);
  });
});

// ===========================================================================
// Braxas — POISONOUS ACID BREATH: ≤3 small/medium in R4+sight; Squad 8+, Hero 17+
// ===========================================================================
describe('Braxas — Poisonous Acid Breath', () => {
  it('destroys a Squad figure on 8+ and spares it on 7; instead of attacking', () => {
    let { s, hero } = stage('braxas');
    const [a, b] = twoNeighbors(s, at(s, hero)!);
    s = put(s, 's1-marro_warriors-1', a);
    s = put(s, 's1-marro_warriors-2', b);
    s = unwrap(applyAction(s, 'p1', { kind: 'acid_breath', attackerId: hero, rolls: [
      { targetId: 's1-marro_warriors-1', d20: 8 }, // exactly 8 → destroyed
      { targetId: 's1-marro_warriors-2', d20: 7 }, // 7 → survives
    ] }));
    expect(at(s, 's1-marro_warriors-1')).toBeNull();
    expect(at(s, 's1-marro_warriors-2')).not.toBeNull();
    // The LAST ATTACK panel reads these — each chosen figure's d20 + outcome (NOT skulls/shields).
    const rolls = s.lastAttack?.d20Rolls;
    expect(rolls).toBeDefined();
    expect(rolls!.length).toBe(2);
    expect(rolls!.find(r => r.d20 === 8)!.destroyed).toBe(true);
    expect(rolls!.find(r => r.d20 === 7)!.destroyed).toBe(false);
    expect(rolls!.every(r => r.need === 8)).toBe(true); // Squad threshold
    expect(errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: 's1-marro_warriors-2', attackRoll: F('k'), defenseRoll: F('bbb') }))).toMatch(/already/i);
  });

  it('engaged Braxas can still Acid Breath a figure it is NOT engaged with (it is not an attack)', () => {
    // Braxas adjacent to enemy A (so Braxas is ENGAGED) and a 2nd enemy B three
    // spaces away (within Range 4, NOT engaged). Acid Breath is "instead of
    // attacking", so the can't-attack-past-engagement rule does NOT apply — the
    // non-engaged figure must still be targetable (the bug that hid the 3rd enemy).
    let { s, hero } = stage('braxas');
    const h = at(s, hero)!;
    const adj = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!; // adjacent → engages Braxas
    const far = cellAtDist(s, h, 3, [adj]); // 3 away, within Range 4, not engaged
    s = put(s, 's1-marro_warriors-1', adj);
    s = put(s, 's1-marro_warriors-2', far);
    // The non-engaged figure is destroyed on 8+ — proving it was a legal target.
    s = unwrap(applyAction(s, 'p1', { kind: 'acid_breath', attackerId: hero, rolls: [
      { targetId: 's1-marro_warriors-2', d20: 8 },
    ] }));
    expect(at(s, 's1-marro_warriors-2')).toBeNull();
  });

  it('destroys a Hero only on 17+ (16 spares)', () => {
    const base = stage('braxas');
    const tgt = neighborKeys(at(base.s, base.hero)!).find(k => MAPS[base.s.mapId].cells[k])!;
    const s16 = unwrap(applyAction(put(base.s, 's1-thorgrim-1', tgt), 'p1', { kind: 'acid_breath', attackerId: base.hero, rolls: [{ targetId: 's1-thorgrim-1', d20: 16 }] }));
    expect(at(s16, 's1-thorgrim-1')).not.toBeNull();
    const s17 = unwrap(applyAction(put(base.s, 's1-thorgrim-1', tgt), 'p1', { kind: 'acid_breath', attackerId: base.hero, rolls: [{ targetId: 's1-thorgrim-1', d20: 17 }] }));
    expect(at(s17, 's1-thorgrim-1')).toBeNull();
  });

  it('cannot target a Large/Huge figure', () => {
    let { s, hero } = stage('braxas');
    s.cards.find(c => c.uid === 's1-thorgrim')!.cardId = 'major_q9'; // Large
    s = put(s, 's1-thorgrim-1', neighborKeys(at(s, hero)!).find(k => MAPS[s.mapId].cells[k])!);
    expect(errOf(applyAction(s, 'p1', { kind: 'acid_breath', attackerId: hero, rolls: [{ targetId: 's1-thorgrim-1', d20: 20 }] }))).toMatch(/small\/medium|not a/i);
  });
});

// ===========================================================================
// Jotun — THROW 14: small/medium non-flying adjacent; 14+ throw ≤4+sight; 11+ → 2 wounds
// ===========================================================================
describe('Jotun — Throw 14', () => {
  it('14+ throws the figure to a chosen empty space; 11+ deals 2 wounds; does not use the attack', () => {
    let { s, hero } = stage('jotun');
    const adj = neighborKeys(at(s, hero)!).find(k => MAPS[s.mapId].cells[k])!;
    s = put(s, 's1-thorgrim-1', adj); // Thorgrim: Life 4, medium, non-flying
    const land = throwLandingHexes(s, hero, 's1-thorgrim-1').find(k => k !== adj)!;
    s = unwrap(applyAction(s, 'p1', { kind: 'throw_figure', attackerId: hero, targetId: 's1-thorgrim-1', to: land, throwD20: 14, damageD20: 11 }));
    expect(at(s, 's1-thorgrim-1')).toBe(land);
    expect(s.figures.find(f => f.id === 's1-thorgrim-1')!.wounds).toBe(2);
    expect(s.turnAttacks.length).toBe(0); // Throw is NOT an attack
    // BOTH d20s are surfaced PUBLICLY in the shared dice overlay (owner request) — the throw-success
    // roll AND the damage roll, each labelled — not just the throw die with the damage buried in the log.
    expect(s.lastRoll?.dice).toEqual([14, 11]);
    expect(s.lastRoll?.labels).toEqual(['Throw (14+)', 'Damage (11+)']);
  });

  it('a roll below 14 fails (the figure stays); the attempt is still spent', () => {
    let { s, hero } = stage('jotun');
    const adj = neighborKeys(at(s, hero)!).find(k => MAPS[s.mapId].cells[k])!;
    s = put(s, 's1-thorgrim-1', adj);
    const land = throwLandingHexes(s, hero, 's1-thorgrim-1').find(k => k !== adj)!;
    s = unwrap(applyAction(s, 'p1', { kind: 'throw_figure', attackerId: hero, targetId: 's1-thorgrim-1', to: land, throwD20: 13, damageD20: 20 }));
    expect(at(s, 's1-thorgrim-1')).toBe(adj); // stayed
    expect(errOf(applyAction(s, 'p1', { kind: 'throw_figure', attackerId: hero, targetId: 's1-thorgrim-1', to: land, throwD20: 20, damageD20: 20 }))).toMatch(/already used Throw/i);
  });

  it('cannot Throw a Large/Huge or a flying figure', () => {
    let { s, hero } = stage('jotun');
    const adj = neighborKeys(at(s, hero)!).find(k => MAPS[s.mapId].cells[k])!;
    s.cards.find(c => c.uid === 's1-thorgrim')!.cardId = 'theracus'; // Large + flying
    s = put(s, 's1-thorgrim-1', adj);
    const land = cellAtDist(s, at(s, hero)!, 3);
    expect(errOf(applyAction(s, 'p1', { kind: 'throw_figure', attackerId: hero, targetId: 's1-thorgrim-1', to: land, throwD20: 20, damageD20: 20 }))).toMatch(/too large|flying/i);
  });
});

describe('Jotun — Throw × Lodin glyph', () => {
  it('Lodin +1 lifts BOTH Throw d20s — raw 13 throws (→14) and raw 10 wounds (→11); no Lodin → fails', () => {
    let { s, hero } = stage('jotun');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    const cells = Object.keys(MAPS[s.mapId].cells);
    const glyphHex = cells.find(k => neighborKeys(k).filter(n => cells.includes(n)).length >= 2)!;
    const adj = neighborKeys(glyphHex).find(n => cells.includes(n))!;
    const jt = s.figures.find(f => f.id === hero)!;
    jt.at = glyphHex; jt.at2 = null; // Jotun stands on the Lodin glyph → his team controls it
    const target = s.figures.find(f => f.id === 's1-thorgrim-1')!;
    target.at = adj; target.at2 = null; // Thorgrim: medium, non-flying, adjacent
    s.glyphs = [{ id: 'lodin', at: glyphHex, faceUp: true }];
    const land = throwLandingHexes(s, hero, 's1-thorgrim-1').find(k => k !== adj && k !== glyphHex)!;
    // raw throw 13 (<14) +1 Lodin = 14 → thrown; raw damage 10 (<11) +1 = 11 → 2 wounds.
    const thrown = unwrap(applyAction(s, 'p1', { kind: 'throw_figure', attackerId: hero, targetId: 's1-thorgrim-1', to: land, throwD20: 13, damageD20: 10 }));
    expect(at(thrown, 's1-thorgrim-1')).toBe(land);
    expect(thrown.figures.find(f => f.id === 's1-thorgrim-1')!.wounds).toBe(2);
    // The SAME raw rolls with no Lodin glyph fail — the figure stays put.
    const noGlyph = JSON.parse(JSON.stringify(s)) as HSState;
    noGlyph.glyphs = [];
    const stays = unwrap(applyAction(noGlyph, 'p1', { kind: 'throw_figure', attackerId: hero, targetId: 's1-thorgrim-1', to: land, throwD20: 13, damageD20: 10 }));
    expect(at(stays, 's1-thorgrim-1')).toBe(adj);
  });
});

// ===========================================================================
// Theracus — CARRY: pick an unengaged friendly small/medium adjacent figure;
// after moving, place it adjacent to Theracus's new position.
// ===========================================================================
describe('Theracus — Carry', () => {
  it('carries an adjacent friendly figure to Theracus’s new position', () => {
    let { s, hero } = stage('theracus');
    const h = at(s, hero)!;
    const passHex = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!;
    s = put(s, 's0-tarn_vikings-1', passHex); // friendly (seat 0) squad
    expect(carryPassengers(s, 0)).toContain('s0-tarn_vikings-1');
    // Discover a legal Theracus destination + its footprint via a dry-run move.
    const to = cellAtDist(s, h, 2, [passHex]);
    const dry = applyAction(s, 'p1', { kind: 'move_figure', figureId: hero, to });
    if ('error' in dry) throw new Error(`dry-run move failed: ${dry.error}`);
    const moved = dry.figures.find(f => f.id === hero)!;
    const foot = [moved.at, moved.at2].filter(Boolean) as string[];
    const occupied = new Set(dry.figures.filter(f => f.at != null).flatMap(f => [f.at, f.at2].filter(Boolean) as string[]));
    const passTo = neighborKeys(moved.at!).find(k => MAPS[s.mapId].cells[k] && !foot.includes(k) && !occupied.has(k))!;
    const carried = unwrap(applyAction(s, 'p1', { kind: 'carry_move', figureId: hero, to, passengerId: 's0-tarn_vikings-1', passengerTo: passTo }));
    expect(at(carried, 's0-tarn_vikings-1')).toBe(passTo);
    const c = carried.figures.find(f => f.id === hero)!;
    expect(rangeDistance(MAPS[carried.mapId].cells, c.at!, passTo)).toBe(1);
  });

  it('a glyph under the SET-DOWN passenger triggers (was missed — only the carrier fired before)', () => {
    let { s, hero } = stage('theracus');
    const h = at(s, hero)!;
    const passHex = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!;
    s = put(s, 's0-tarn_vikings-1', passHex);
    const to = cellAtDist(s, h, 2, [passHex]);
    const dry = applyAction(s, 'p1', { kind: 'move_figure', figureId: hero, to });
    if ('error' in dry) throw new Error(`dry-run move failed: ${dry.error}`);
    const moved = dry.figures.find(f => f.id === hero)!;
    const foot = [moved.at, moved.at2].filter(Boolean) as string[];
    const occupied = new Set(dry.figures.filter(f => f.at != null).flatMap(f => [f.at, f.at2].filter(Boolean) as string[]));
    const passTo = neighborKeys(moved.at!).find(k => MAPS[s.mapId].cells[k] && !foot.includes(k) && !occupied.has(k))!;
    // A face-down glyph sits exactly where the carried figure will be set down.
    s = { ...s, glyphs: [{ id: 'gerda', at: passTo, faceUp: false }] };
    const carried = unwrap(applyAction(s, 'p1', { kind: 'carry_move', figureId: hero, to, passengerId: 's0-tarn_vikings-1', passengerTo: passTo }));
    expect(at(carried, 's0-tarn_vikings-1')).toBe(passTo);
    expect(carried.glyphs.find(g => g.at === passTo)?.faceUp).toBe(true); // the passenger triggered it
  });

  it('a carrier KILLED on takeoff (leaving-engagement swipe) ends the carry gracefully — the passenger stays put', () => {
    // REGRESSION (overnight audit 2026-07-02): a dead carrier used to fail the "adjacent to
    // the new position" check — an ERROR the AI re-proposed forever (frozen bot turn). The
    // carry simply never happens: the move + death resolve, the passenger is never picked up.
    let { s, hero } = stage('theracus');
    // Start Theracus on a CENTRAL hex (all 6 neighbors on-map) — the stage() corner has too
    // few neighbors to seat both a passenger and a non-adjacent enemy.
    const cells = MAPS[s.mapId].cells;
    const h = Object.keys(cells).find(k => neighborKeys(k).filter(n => cells[n]).length === 6)!;
    s = put(s, hero, h);
    const nbrs = neighborKeys(h).filter(k => cells[k]);
    const passHex = nbrs[0];
    // The enemy must NOT also engage the passenger (an engaged figure is an illegal pick) —
    // take a neighbor of Theracus that is not adjacent to the passenger's hex.
    const enemyHex = nbrs.find(k => k !== passHex && (rangeDistance(cells, passHex, k) ?? 0) > 1)!;
    s = put(s, 's0-tarn_vikings-1', passHex); // the would-be passenger (friendly, unengaged)
    s = put(s, 's1-thorgrim-1', enemyHex); // an ENEMY engaging Theracus — the takeoff swipes
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.figures.find(f => f.id === hero)!.wounds = HS_CARDS['theracus'].life - 1; // one swipe kills
    // A landing at distance 4: by the triangle inequality NEITHER of Theracus's lobes can
    // stay adjacent to the enemy (≥ 4−1 = 3 away) — the engagement is definitely abandoned,
    // so exactly one takeoff swipe is owed.
    const to = cellAtDist(s, h, 4, [passHex, enemyHex]);
    const carried = unwrap(applyAction(s, 'p1', {
      kind: 'carry_move', figureId: hero, to,
      passengerId: 's0-tarn_vikings-1', passengerTo: cellAtDist(s, to, 1, [passHex, enemyHex]),
      leaveRolls: [{ enemyFigureId: 's1-thorgrim-1', roll: 'skull' }],
    }));
    expect(at(carried, hero)).toBeNull(); // Theracus fell on takeoff
    expect(at(carried, 's0-tarn_vikings-1')).toBe(passHex); // the passenger never moved
  });

  it('carryLandingHexes is footprint-aware — exactly the empty cells around BOTH of 2-hex Theracus’s lobes', () => {
    let { s, hero } = stage('theracus');
    const h = at(s, hero)!;
    const passHex = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!;
    s = put(s, 's0-tarn_vikings-1', passHex);
    const to = cellAtDist(s, h, 2, [passHex]);
    const foot = carryDestFootprint(s, hero, to);
    expect(foot.length).toBe(2); // Theracus is a 2-hex figure
    const occupied = new Set(
      s.figures.filter(f => f.id !== 's0-tarn_vikings-1' && f.id !== hero && f.at != null)
        .flatMap(f => [f.at, f.at2].filter(Boolean) as string[]),
    );
    const expected = new Set(
      foot.flatMap(fk => neighborKeys(fk)).filter(k => MAPS[s.mapId].cells[k] && !foot.includes(k) && !occupied.has(k)),
    );
    const drops = carryLandingHexes(s, hero, to, 's0-tarn_vikings-1');
    expect(new Set(drops)).toEqual(expected); // around the FULL footprint, never on it
    // Every offered drop is actually accepted by carry_move.
    for (const d of drops.slice(0, 3)) {
      expect('error' in applyAction(s, 'p1', { kind: 'carry_move', figureId: hero, to, passengerId: 's0-tarn_vikings-1', passengerTo: d })).toBe(false);
    }
  });

  it('rejects an ENEMY passenger and an ENGAGED passenger', () => {
    let { s, hero } = stage('theracus');
    const h = at(s, hero)!;
    const passHex = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!;
    s = put(s, 's1-marro_warriors-1', passHex); // enemy adjacent
    expect(carryPassengers(s, 0)).not.toContain('s1-marro_warriors-1');
    s = put(s, 's0-tarn_vikings-1', passHex); // friendly but...
    const enemyHex = neighborKeys(passHex).find(k => MAPS[s.mapId].cells[k] && k !== h)!;
    s = put(s, 's1-marro_warriors-1', enemyHex); // ...engaged by an enemy
    expect(carryPassengers(s, 0)).not.toContain('s0-tarn_vikings-1');
  });

  it('cannot Carry a Large/Huge passenger', () => {
    let { s, hero } = stage('theracus');
    const passHex = neighborKeys(at(s, hero)!).find(k => MAPS[s.mapId].cells[k])!;
    s.cards.find(c => c.uid === 's0-finn')!.cardId = 'theracus'; // (hero card already theracus)
    s.cards.find(c => c.uid === 's0-tarn_vikings')!.cardId = 'jotun'; // a Huge friendly
    s = put(s, 's0-tarn_vikings-1', passHex);
    expect(carryPassengers(s, 0)).not.toContain('s0-tarn_vikings-1');
  });
});

// ===========================================================================
// Cross-cutting clauses — friendly fire, elimination, per-turn resets, wrong hero
// ===========================================================================
describe('Big-Hero powers — cross-cutting fidelity', () => {
  it('Wild Swing splashes an ADJACENT ALLY (friendly fire) but never Jotun', () => {
    let { s, hero } = stage('jotun');
    const interior = Object.keys(MAPS[s.mapId].cells).find(k => neighborKeys(k).filter(n => MAPS[s.mapId].cells[n]).length >= 3)!;
    s = put(s, hero, interior);
    const tgtHex = neighborKeys(interior).find(k => MAPS[s.mapId].cells[k])!;
    // An ALLY (seat 0) adjacent to the target but not on Jotun's hex.
    const allyHex = neighborKeys(tgtHex).find(k => MAPS[s.mapId].cells[k] && k !== interior)!;
    s = put(s, 's1-marro_warriors-1', tgtHex); // enemy target
    s = put(s, 's0-tarn_vikings-1', allyHex); // friendly, adjacent to target → splashed
    const defs = [
      { figureId: 's1-marro_warriors-1', roll: def(s, 's1-marro_warriors-1', hero) },
      { figureId: 's0-tarn_vikings-1', roll: def(s, 's0-tarn_vikings-1', hero) },
    ];
    s = unwrap(applyAction(s, 'p1', { kind: 'wild_swing', attackerId: hero, targetId: 's1-marro_warriors-1', attackRoll: F('kbbb'), defenseRolls: defs }));
    expect(at(s, 's1-marro_warriors-1')).toBeNull(); // enemy target dead
    expect(s.figures.find(f => f.id === 's0-tarn_vikings-1')!.wounds).toBeGreaterThan(0); // ally took the splash
    expect(at(s, hero)).toBe(interior); // Jotun never hit by his own swing
  });

  it('a power that destroys the last enemy figure ends the game (winner set)', () => {
    let { s, hero } = stage('nilfheim');
    s = put(s, s.figures.find(f => f.id === 's1-marro_warriors-4')!.id, null); // remove the parked survivor
    s = put(s, 's1-thorgrim-1', cellAtDist(s, at(s, hero)!, 5));
    s = wound(s, 's1-thorgrim-1', 3); // Thorgrim Life 4 — one more wound kills him
    s = unwrap(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('kbbb'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    expect(at(s, 's1-thorgrim-1')).toBeNull();
    expect(s.phase).toBe('finished');
    expect(s.winnerSeat).toBe(0);
    expect(s.winnerTeam).toBe(-1 - s.winnerSeat!); // FFA: a solo seat's team id is encoded -1 - seat
  });

  it('Queglix Gun’s 9-die pool RESETS at end of turn', () => {
    let { s, hero } = stage('major_q9');
    s = put(s, 's1-thorgrim-1', cellAtDist(s, at(s, hero)!, 6));
    s = unwrap(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 3, attackRoll: F('bbb'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    expect(queglixDiceLeft(s)).toBe(6);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(queglixDiceLeft(s)).toBe(9); // pool refilled
  });

  it('Acid Breath rejects more than 3 targets and a duplicate target', () => {
    let { s, hero } = stage('braxas');
    const ring = neighborKeys(at(s, hero)!).filter(k => MAPS[s.mapId].cells[k]);
    s = put(s, 's1-marro_warriors-1', ring[0]);
    s = put(s, 's1-marro_warriors-2', ring[1]);
    // duplicate
    expect(errOf(applyAction(s, 'p1', { kind: 'acid_breath', attackerId: hero, rolls: [
      { targetId: 's1-marro_warriors-1', d20: 10 }, { targetId: 's1-marro_warriors-1', d20: 10 },
    ] }))).toMatch(/different figures/i);
    // four targets (need 4 in range — reuse three marros + thorgrim around Braxas)
    s = put(s, 's1-marro_warriors-3', ring[2]);
    s = put(s, 's1-thorgrim-1', ring[3]);
    expect(errOf(applyAction(s, 'p1', { kind: 'acid_breath', attackerId: hero, rolls: [
      { targetId: 's1-marro_warriors-1', d20: 10 }, { targetId: 's1-marro_warriors-2', d20: 10 },
      { targetId: 's1-marro_warriors-3', d20: 10 }, { targetId: 's1-thorgrim-1', d20: 20 },
    ] }))).toMatch(/1 to 3/i);
  });

  it('Throw does NOT consume the attack — Jotun may still attack after a throw; damage <11 leaves no wound', () => {
    let { s, hero } = stage('jotun');
    const interior = Object.keys(MAPS[s.mapId].cells).find(k => neighborKeys(k).filter(n => MAPS[s.mapId].cells[n]).length >= 3)!;
    s = put(s, hero, interior);
    const ring = neighborKeys(interior).filter(k => MAPS[s.mapId].cells[k]);
    s = put(s, 's1-thorgrim-1', ring[0]); // the thrown figure
    s = put(s, 's1-marro_warriors-1', ring[1]); // a second enemy to attack after
    const land = throwLandingHexes(s, hero, 's1-thorgrim-1').find(k => !ring.includes(k))!;
    s = unwrap(applyAction(s, 'p1', { kind: 'throw_figure', attackerId: hero, targetId: 's1-thorgrim-1', to: land, throwD20: 20, damageD20: 5 }));
    expect(at(s, 's1-thorgrim-1')).toBe(land); // thrown
    expect(s.figures.find(f => f.id === 's1-thorgrim-1')!.wounds).toBe(0); // damage 5 < 11 → unharmed
    expect(s.turnAttacks.length).toBe(0);
    // Jotun can now make his normal attack on the adjacent Marro.
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: 's1-marro_warriors-1', attackRoll: F('kbbbbbbb'), defenseRoll: def(s, 's1-marro_warriors-1', hero) }));
    expect(at(s, 's1-marro_warriors-1')).toBeNull(); // Jotun's A8 normal attack lands
  });

  it('a 2-hex figure killed by a normal attack clears BOTH lobes (at + at2)', () => {
    // Regression: doAttack used to null only `at` on a kill, leaving a stale `at2`
    // tail behind for double-space figures (Grimnak) — every other destruction site
    // clears both. Stage Drake (Attack 6, melee) vs a 2-hex Grimnak placed adjacent.
    let { s, hero } = stage('drake');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.cards.find(c => c.uid === 's1-thorgrim')!.cardId = 'grimnak'; // figure s1-thorgrim-1 becomes Grimnak (huge, 2-hex)
    const gid = 's1-thorgrim-1';
    const onMap = (k: string) => Object.prototype.hasOwnProperty.call(MAPS[s.mapId].cells, k);
    const front = neighborKeys(at(s, hero)!).find(onMap)!;          // adjacent to Drake
    const back = neighborKeys(front).find(k => k !== at(s, hero) && onMap(k))!;
    const g = s.figures.find(f => f.id === gid)!;
    g.at = front; g.at2 = back; g.wounds = 0;
    // Drake lands 6 skulls; Grimnak (Life 5) rolls only blanks → destroyed.
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: gid, attackRoll: F('kkkkkk'), defenseRoll: def(s, gid, hero) }));
    const dead = s.figures.find(f => f.id === gid)!;
    expect(dead.at).toBeNull();
    expect(dead.at2).toBeNull(); // the fix — tail lobe must not dangle
  });

  it('a Big-Hero special rejects the wrong active hero (Ice Shard needs Nilfheim)', () => {
    let { s, hero } = stage('jotun');
    s = put(s, 's1-thorgrim-1', cellAtDist(s, at(s, hero)!, 3));
    expect(errOf(applyAction(s, 'p1', { kind: 'ice_shard', attackerId: hero, targetId: 's1-thorgrim-1', attackRoll: F('kbbb'), defenseRoll: F('bbbb') }))).toMatch(/Only Nilfheim/i);
  });
});

// ===========================================================================
// Airborne Elite — THE DROP: start in reserve; d20 13+ at round start deploys all
// 4 on empty spaces not adjacent to each other or any figure, and not on glyphs.
// ===========================================================================

/** A 'place_markers' (round start) state where seat 0 owns a 4-figure Airborne
 *  Elite card in RESERVE, plus one enemy (Thorgrim) on the board for adjacency
 *  checks. Quick start lands in place_markers round 1; we then wipe the preset
 *  figures and inject the reserve Airborne. */
function dropStage(): { s: HSState; air: string[]; enemyHex: string } {
  let s = initialState();
  s = addPlayer(s, 'p1', 'Alice', 0, '#10b981');
  s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
  s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'quick' }));
  s = JSON.parse(JSON.stringify(s)) as HSState;
  // Clear the board to ONE enemy + (below) the reserve Airborne. REMOVE the other quick-army figures
  // rather than just nulling them — a real game drops unplaced figures, and seatIsAlive (correctly)
  // reads a lingering unplaced non-reserve figure as a casualty, which would wrongly mark seat 0 dead.
  s.figures = s.figures.filter(f => f.id === 's1-thorgrim-1');
  const enemyHex = Object.keys(MAPS[s.mapId].cells)[0];
  s.figures.find(f => f.id === 's1-thorgrim-1')!.at = enemyHex; // one enemy on board
  s.cards.push({ uid: 's0-airborne_elite', cardId: 'airborne_elite', ownerSeat: 0, orderMarkers: [], attackMod: 0, defenseMod: 0 });
  const air: string[] = [];
  for (let n = 1; n <= 4; n++) {
    const id = `s0-airborne_elite-${n}`;
    s.figures.push({ id, cardUid: 's0-airborne_elite', ownerSeat: 0, at: null, index: n, wounds: 0, reserve: true });
    air.push(id);
  }
  return { s, air, enemyHex };
}
/** Pick `n` mutually non-adjacent hexes from `hexes` (greedy). */
function pickNonAdj(hexes: string[], n: number): string[] {
  const chosen: string[] = [];
  for (const h of hexes) {
    if (chosen.length >= n) break;
    if (chosen.every(c => !neighborKeys(c).includes(h))) chosen.push(h);
  }
  return chosen;
}
const reserveOf = (s: HSState, id: string) => s.figures.find(f => f.id === id)!.reserve === true;

describe('Airborne Elite — The Drop', () => {
  // The Drop is now a TWO-STEP power: `the_drop` ROLLS the d20 (global); a 13+
  // opens an `airborne_drop` pending choice, and the landings arrive as a separate
  // resolve_choice — so the placement is offered only AFTER the roll. Legal hexes
  // (`theDropHexes`) are therefore empty until that choice is open.
  const rollDrop = (s: HSState, pid: 'p1' | 'p2', d20: number) =>
    applyAction(s, pid, { kind: 'the_drop', d20 });
  const placeDrop = (s: HSState, pid: 'p1' | 'p2', placements: string[]) =>
    applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'airborne_drop', placements } });

  it('starts in reserve; canTheDrop is offered at round start; after a hit the landings exclude the enemy + its neighbours', () => {
    const { s: s0, air, enemyHex } = dropStage();
    expect(air.every(id => reserveOf(s0, id))).toBe(true);
    expect(canTheDrop(s0, 0)).toBe(true);
    expect(theDropHexes(s0, 0)).toEqual([]); // nothing to place until a 13+ roll opens the choice
    const s = unwrap(rollDrop(s0, 'p1', 18)); // hit → placement pending
    expect(s.pendingChoice?.kind).toBe('airborne_drop');
    const legal = theDropHexes(s, 0);
    expect(legal).not.toContain(enemyHex); // occupied
    for (const nb of neighborKeys(enemyHex)) expect(legal).not.toContain(nb); // adjacent to a figure
    expect(legal.length).toBeGreaterThan(0);
  });

  it('a NEGATED Airborne card (Glyph of Nilrend) cannot roll The Drop — The Drop is its special power (owner 2026-06-30)', () => {
    const { s: s0, air } = dropStage();
    expect(canTheDrop(s0, 0)).toBe(true); // un-negated: offered as normal
    expect(livingSeats(s0)).toContain(0); // and the all-reserve seat is alive
    // Nilrend negates the Airborne Elite card → ALL its special powers are off, incl. The Drop.
    s0.negatedCardUids = ['s0-airborne_elite'];
    expect(canTheDrop(s0, 0)).toBe(false); // no roll offered
    // A stale/forced roll is rejected (reserveAirborne now excludes the negated card → "none in reserve").
    expect(errOf(rollDrop(s0, 'p1', 18))).toMatch(/no Airborne Elite in reserve/i);
    expect(air.every(id => reserveOf(s0, id))).toBe(true); // they stay in reserve, undeployed
    // …and because a negated Airborne can NEVER reach the board, an army that is ONLY that card is
    // eliminated (it can't keep the seat alive forever → no stalemate). seat 0 has no on-board figure.
    expect(livingSeats(s0)).not.toContain(0);
  });

  it('a HUMAN who still owes The Drop makes the AI driver WAIT — bots never force markers and consume it (owner 2026-06-25)', () => {
    const { s } = dropStage();
    s.players.find(p => p.seat === 1)!.bot = true; // seat 1 is a BOT; seat 0 (human) owns the reserve Airborne
    expect(canTheDrop(s, 0)).toBe(true); // the human can still roll The Drop this round
    // The place-markers gate blocks the bot too, so its ai_step would error — the driver must therefore
    // report NOTHING pending (wait for the human) rather than let the recovery clobber airborneDropRound.
    expect(aiPendingSeat(s)).toBeNull();
    // Once the human has rolled (a miss still sets airborneDropRound), the gate lifts and the bot is free.
    const rolled = unwrap(applyAction(s, 'p1', { kind: 'the_drop', d20: 3 }));
    expect(canTheDrop(rolled, 0)).toBe(false);
    expect(aiPendingSeat(rolled)).toBe(1); // now the bot is the pending actor (place its order markers)
  });

  it('a BOT dropper rolls The Drop BEFORE a lower-seat non-dropper bot wedges the gate (owner 2026-06-25)', () => {
    // Re-home the reserve Airborne onto seat 1 (the HIGHER seat) so the DROPPER sits BEHIND a non-dropper
    // bot at seat 0. The gate blocks EVERY seat's markers until the Airborne rolls; old code handed back
    // seat 0 first, whose blocked marker-place hit the host recovery and clobbered airborneDropRound —
    // consuming the Drop before it ever rolled (a Makros/Wreckage/Vlad game: Vlad's Airborne never dropped).
    const { s, enemyHex } = dropStage();
    for (const f of s.figures) if (f.cardUid === 's0-airborne_elite') f.ownerSeat = 1;
    s.cards.find(c => c.uid === 's0-airborne_elite')!.ownerSeat = 1; // seat 1 owns the reserve Airborne now
    // Give seat 0 an ordinary ON-BOARD figure so it's a LIVING non-dropper bot ahead of the dropper.
    const freeHex = Object.keys(MAPS[s.mapId].cells).find(k => k !== enemyHex && !s.figures.some(f => f.at === k))!;
    s.cards.push({ uid: 's0-marro_warriors', cardId: 'marro_warriors', ownerSeat: 0, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    s.figures.push({ id: 's0-marro_warriors-1', cardUid: 's0-marro_warriors', ownerSeat: 0, at: freeHex, index: 1, wounds: 0 });
    s.players.find(p => p.seat === 0)!.bot = true;
    s.players.find(p => p.seat === 1)!.bot = true;
    expect(canTheDrop(s, 1)).toBe(true);  // the higher-seat bot owes The Drop
    expect(canTheDrop(s, 0)).toBe(false); // seat 0 is just a non-dropper
    // THE FIX: hand back the DROPPER (seat 1), not the lower-seat non-dropper (seat 0) — so its `the_drop`
    // rolls first and clears the gate, instead of seat 0 wedging and the recovery skipping the Drop.
    expect(aiPendingSeat(s)).toBe(1);
    expect(aiNextAction(s, 1)).toEqual({ kind: 'the_drop', d20: 0 });
    // After it rolls (a miss still lifts the gate), the lower-seat non-dropper bot is free to lay markers.
    const rolled = unwrap(applyAction(s, 'p2', { kind: 'the_drop', d20: 4 }));
    expect(canTheDrop(rolled, 1)).toBe(false);
    expect(aiPendingSeat(rolled)).toBe(0);
  });

  it('a roll below 13 keeps them in reserve, opens NO choice, and spends the round’s roll', () => {
    let { s, air } = dropStage();
    s = unwrap(rollDrop(s, 'p1', 12));
    expect(s.pendingChoice).toBeUndefined(); // miss → no placement step
    expect(air.every(id => reserveOf(s, id))).toBe(true); // still reserve
    expect(s.airborneDropRound).toBe(s.round);
    // No second roll this round.
    expect(errOf(rollDrop(s, 'p1', 20))).toMatch(/already been rolled/i);
  });

  it('a 13+ roll opens the placement choice; deploying lands all 4 (reserve cleared)', () => {
    let { s, air } = dropStage();
    s = unwrap(rollDrop(s, 'p1', 13));
    expect(s.pendingChoice?.kind).toBe('airborne_drop');
    expect(air.every(id => reserveOf(s, id))).toBe(true); // STILL reserve until placement resolves
    const spots = pickNonAdj(theDropHexes(s, 0), 4);
    expect(spots).toHaveLength(4);
    s = unwrap(placeDrop(s, 'p1', spots));
    expect(s.pendingChoice).toBeUndefined();
    air.forEach((id, i) => {
      const f = s.figures.find(x => x.id === id)!;
      expect(f.at).toBe(spots[i]);
      expect(f.reserve).toBeUndefined();
    });
  });

  it('the placement choice must resolve BEFORE order markers (the pending gate)', () => {
    let { s } = dropStage();
    s = unwrap(rollDrop(s, 'p1', 18)); // hit → airborne_drop pending
    // The owner cannot place order markers while the Drop placement is open.
    expect(errOf(applyAction(s, 'p1', { kind: 'place_markers', assignments: allOn('s0-airborne_elite') })))
      .toMatch(/pending choice/i);
  });

  it('rejects a landing adjacent to a figure, on a glyph, or adjacent to another drop', () => {
    const base = dropStage();
    const s = unwrap(rollDrop(base.s, 'p1', 18)); // hit → placement pending
    const legal = theDropHexes(s, 0);
    const spots = pickNonAdj(legal, 4);
    // adjacent to the enemy
    const adjEnemy = neighborKeys(base.enemyHex).find(k => MAPS[s.mapId].cells[k])!;
    expect(errOf(placeDrop(s, 'p1', [adjEnemy, spots[1], spots[2], spots[3]]))).toMatch(/adjacent to a figure|occupied|glyph/i);
    // two drops adjacent to EACH OTHER
    const a = spots[0];
    const adjA = neighborKeys(a).find(k => legal.includes(k))!;
    expect(errOf(placeDrop(s, 'p1', [a, adjA, spots[2], spots[3]]))).toMatch(/adjacent to each other/i);
    // on a glyph
    const gs = unwrap(rollDrop(dropStage().s, 'p1', 18));
    const gspots = pickNonAdj(theDropHexes(gs, 0), 4);
    gs.glyphs = [{ id: 'astrid', at: gspots[0], faceUp: true }];
    expect(errOf(placeDrop(gs, 'p1', gspots))).toMatch(/glyph|adjacent/i);
  });

  it('rejects the wrong number of landings and duplicates', () => {
    let { s } = dropStage();
    s = unwrap(rollDrop(s, 'p1', 18)); // hit → placement pending
    const spots = pickNonAdj(theDropHexes(s, 0), 4);
    expect(errOf(placeDrop(s, 'p1', spots.slice(0, 3)))).toMatch(/all 4/i);
    expect(errOf(placeDrop(s, 'p1', [spots[0], spots[0], spots[1], spots[2]]))).toMatch(/distinct/i);
  });

  it('recurs the next round after a miss', () => {
    let { s } = dropStage();
    s = unwrap(rollDrop(s, 'p1', 5)); // miss, airborneDropRound = 1
    expect(canTheDrop(s, 0)).toBe(false); // not again this round
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.round = 2; // next round
    expect(canTheDrop(s, 0)).toBe(true); // offered again
    s = unwrap(rollDrop(s, 'p1', 20)); // hit → pending
    const spots = pickNonAdj(theDropHexes(s, 0), 4);
    s = unwrap(placeDrop(s, 'p1', spots));
    expect(s.figures.find(f => f.id === 's0-airborne_elite-1')!.at).toBe(spots[0]);
  });

  it('only the Airborne owner, only during place_markers', () => {
    const { s } = dropStage();
    // seat 1 has no reserve Airborne
    expect(canTheDrop(s, 1)).toBe(false);
    expect(errOf(rollDrop(s, 'p2', 20))).toMatch(/no Airborne Elite in reserve/i);
    // not during the turns sub-phase
    const turns = JSON.parse(JSON.stringify(s)) as HSState;
    turns.subPhase = 'turns';
    expect(errOf(rollDrop(turns, 'p1', 20))).toMatch(/start of a round/i);
  });

  it('a team is ELIMINATED when its last ON-BOARD figure dies — reserve Airborne grant NO last-chance Drop (owner 2026-06-25)', () => {
    let { s, hero } = stage('finn'); // seat 0 active, board wiped, Finn placed
    const h = at(s, hero)!;
    const tgtHex = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!;
    s = put(s, 's1-marro_warriors-1', tgtHex); // seat-1's only ON-BOARD figure
    s = put(s, 's1-marro_warriors-4', null); // remove the parked survivor
    // seat 1 ALSO holds a reserve Airborne — but it has COMMITTED a figure to the board (the marro).
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.cards.push({ uid: 's1-airborne_elite', cardId: 'airborne_elite', ownerSeat: 1, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    s.figures.push({ id: 's1-airborne_elite-1', cardUid: 's1-airborne_elite', ownerSeat: 1, at: null, index: 1, wounds: 0, reserve: true });
    // Finn kills the marro — seat 1's last ON-BOARD figure. The reserve Airborne do NOT save it.
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: 's1-marro_warriors-1', attackRoll: F('kkk'), defenseRoll: def(s, 's1-marro_warriors-1', hero) }));
    expect(at(s, 's1-marro_warriors-1')).toBeNull(); // dead
    // Seat 1 is OUT despite the reserve Airborne → only seat 0 remains, so the game ENDS (it would have
    // stayed 'playing' under the old reserve-counts rule). A finished game with winner 0 = seat 1 eliminated.
    expect(s.phase).toBe('finished');
    expect(s.winnerSeat).toBe(0);
  });

  it('a NEVER-DEPLOYED reserve army (no casualties yet) stays alive so its Drop can still land', () => {
    // The flip side: a seat that has NOT yet committed a figure to the board — e.g. an all-Airborne army
    // whose Drop hasn't hit — keeps its rounds to roll, since it never lost an on-board figure.
    let { s } = stage('finn');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.figures = s.figures.filter(f => f.ownerSeat !== 1); // remove seat-1's figures so there are NO casualties
    s.cards = s.cards.filter(c => c.ownerSeat !== 1);
    s.cards.push({ uid: 's1-airborne_elite', cardId: 'airborne_elite', ownerSeat: 1, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    s.figures.push({ id: 's1-airborne_elite-1', cardUid: 's1-airborne_elite', ownerSeat: 1, at: null, index: 1, wounds: 0, reserve: true });
    expect(livingSeats(s)).toContain(1); // un-deployed reserve army is still in the game
  });
});

describe('AI powers — Grimnak Chomp', () => {
  it('the bot chomps an adjacent enemy squad figure (a free kill) in the attack phase', () => {
    let { s, hero, park } = stage('grimnak'); // s0-finn-1 relabelled to Grimnak; park = an enemy Marro
    const here = at(s, hero)!;
    const adj = neighborKeys(here).find(k => MAPS[s.mapId].cells[k] && k !== here);
    s = put(s, park, adj!); // enemy squad figure right next to Grimnak
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' })); // into the attack phase
    const intent = aiNextAction(s, 0);
    expect(intent?.kind).toBe('chomp');
    if (intent?.kind === 'chomp') expect(intent.targetId).toBe(park);
  });
});

describe('AI powers — Big Hero specials initiate on an in-range enemy', () => {
  // Each big hero's special either REPLACES its normal attack or (Mind Shackle) comes
  // free before it; the bot must reach for the special — not a plain attack — whenever it
  // catches an enemy. An adjacent enemy is within every special's range, so each case
  // stages the hero with one foe adjacent, ends the move, and asserts the matching intent.
  const cases: { card: string; kind: string }[] = [
    { card: 'ne_gok_sa', kind: 'mind_shackle' },
    { card: 'mimring', kind: 'fire_line' },
    { card: 'deathwalker_9000', kind: 'explosion' },
    { card: 'nilfheim', kind: 'ice_shard' },
    { card: 'major_q9', kind: 'queglix' },
    { card: 'jotun', kind: 'wild_swing' },
    { card: 'braxas', kind: 'acid_breath' },
  ];
  for (const { card, kind } of cases) {
    it(`${card} → ${kind}`, () => {
      let { s, hero, park } = stage(card);
      const here = at(s, hero)!;
      const adj = neighborKeys(here).find(k => MAPS[s.mapId].cells[k] && k !== here)!;
      s = put(s, park, adj);
      s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
      expect(aiNextAction(s, 0)?.kind).toBe(kind);
    });
  }
});

describe('AI powers — Tarn Berserker Charge', () => {
  it('the bot charges (after moving, before attacking) while a Viking is still out of range', () => {
    let { s, hero } = stage('tarn_vikings'); // s0-finn-1 relabelled to Tarn; the enemy Marro sits in the far corner
    // Move one step so "a Tarn moved this turn" holds, staying far from the enemy (out of range).
    const here = at(s, hero)!;
    const step = neighborKeys(here).find(k => MAPS[s.mapId].cells[k] && !s.figures.some(f => f.at === k))!;
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: hero, to: step }));
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    expect(aiNextAction(s, 0)?.kind).toBe('berserker_charge');
  });
});

describe('AI powers — Marro Water Clone', () => {
  it('the bot clones (instead of attacking) when a Marro is down and nothing is in range', () => {
    let { s, hero } = stage('marro_warriors'); // s0-finn-1 → Marro; the enemy sits far away (no legal target)
    // Add a FALLEN squad-mate (no position) for a successful clone to bring back.
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.figures.push({ id: 's0-finn-2', cardUid: 's0-finn', ownerSeat: 0, at: null, at2: null, index: 2, wounds: 0 });
    // Move one step so "moved this turn" holds; stay far from the enemy so no swing is available.
    const here = at(s, hero)!;
    const step = neighborKeys(here).find(k => MAPS[s.mapId].cells[k] && !s.figures.some(f => f.at === k))!;
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: hero, to: step }));
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    expect(aiNextAction(s, 0)?.kind).toBe('water_clone');
  });
});

// ===========================================================================
// Glyphs — a 2-hex figure's FULL footprint counts (both lobes), not just `at`.
// Reported in play: Braxas with only its back lobe on a glyph didn't trigger it.
// ===========================================================================
describe('Glyphs — both lobes of a 2-hex figure count', () => {
  it('a 2-hex figure controls a glyph under its BACK lobe (at2), not just the lead hex', () => {
    let { s, hero } = stage('grimnak'); // s0-finn-1 → Grimnak (2-hex)
    s = JSON.parse(JSON.stringify(s)) as HSState;
    const cells = Object.keys(MAPS[s.mapId].cells);
    const back = cells.find(k => neighborKeys(k).some(n => cells.includes(n)))!;
    const lead = neighborKeys(back).find(n => cells.includes(n))!;
    const g = s.figures.find(f => f.id === hero)!;
    g.at = lead; g.at2 = back; // footprint: lead + back; the glyph sits under the BACK lobe
    const atk = s.figures.find(f => f.id === 's1-thorgrim-1')!;
    atk.at = cells.find(k => k !== lead && k !== back)!; atk.at2 = null;
    // Baseline: Gerda present but FACE-DOWN grants nothing.
    s.glyphs = [{ id: 'gerda', at: back, faceUp: false }];
    const base = effectiveDefenseDice(s, g, atk).dice;
    // Face-up: the back lobe occupies Gerda → +1 defense. (Before the footprint fix,
    // seatControlsGlyph only checked `at`, so a back-lobe glyph granted nothing.)
    s.glyphs = [{ id: 'gerda', at: back, faceUp: true }];
    expect(effectiveDefenseDice(s, g, atk).dice).toBe(base + 1);
  });

  it('orienting a 2-hex figure so its tail swings onto a hidden glyph reveals + claims it', () => {
    let { s, hero } = stage('grimnak');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    const cells = Object.keys(MAPS[s.mapId].cells);
    const lead = cells.find(k => neighborKeys(k).filter(n => cells.includes(n)).length >= 2)!;
    const dirs = neighborKeys(lead).map((n, i) => ({ n, i })).filter(x => cells.includes(x.n));
    const startTail = dirs[0], glyphDir = dirs[1];
    const g = s.figures.find(f => f.id === hero)!;
    g.at = lead; g.at2 = startTail.n; g.facing = startTail.i;
    s.figures.find(f => f.id === 's1-marro_warriors-4')!.at = cells[cells.length - 1]; // park far → not engaged
    s.glyphs = [{ id: 'astrid', at: glyphDir.n, faceUp: false }]; // hidden glyph on the OTHER neighbour
    const oriented = unwrap(applyAction(s, 'p1', { kind: 'orient_figure', figureId: hero, dir: glyphDir.i }));
    expect(oriented.figures.find(f => f.id === hero)!.at2).toBe(glyphDir.n); // tail swung onto it
    expect(oriented.glyphs.find(x => x.at === glyphDir.n)?.faceUp).toBe(true); // revealed by the swing
    expect(oriented.log.some(e => e.tag === 'glyph' && /reveals a hidden glyph/.test(e.text))).toBe(true);
  });
});

describe('Glyphs — wave 2 occupancy auras', () => {
  it('Lodin: +1 to a d20 — Ne-Gok-Sa rolls 19 and Mind Shackles ONLY while controlling Lodin', () => {
    let { s, hero } = stage('ne_gok_sa');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    const cells = Object.keys(MAPS[s.mapId].cells);
    const glyphHex = cells.find(k => neighborKeys(k).some(n => cells.includes(n)))!;
    const adj = neighborKeys(glyphHex).find(n => cells.includes(n))!;
    const ng = s.figures.find(f => f.id === hero)!;
    ng.at = glyphHex; ng.at2 = null;
    const target = s.figures.find(f => f.id === 's1-marro_warriors-1')!;
    target.at = adj; target.at2 = null;
    s.glyphs = [{ id: 'lodin', at: glyphHex, faceUp: true }];
    // 19 + Lodin = 20 → seize succeeds (the card switches to seat 0).
    const seized = unwrap(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: target.id, d20: 19 }));
    expect(seized.figures.find(f => f.id === target.id)!.ownerSeat).toBe(0);
    // The SAME roll with no Lodin fails — the figure stays seat 1.
    const noGlyph = JSON.parse(JSON.stringify(s)) as HSState;
    noGlyph.glyphs = [];
    const missed = unwrap(applyAction(noGlyph, 'p1', { kind: 'mind_shackle', targetId: target.id, d20: 19 }));
    expect(missed.figures.find(f => f.id === target.id)!.ownerSeat).toBe(1);
  });

  it('Mind Shackle targets a UNIQUE figure but NEVER a common (Arrow Grut)', () => {
    // The card says "choose any UNIQUE figure adjacent" — a common squad (Gruts, Deathreavers,
    // Swog Rider) is off-limits. Regression for a live game where Ne-Gok-Sa shackled an Arrow Grut.
    expect(HS_CARDS.arrow_gruts.common).toBe(true);   // guard: the roster still marks it common
    expect(HS_CARDS.marro_warriors.common).toBeFalsy(); // and Marro Warriors stays UNIQUE
    let { s, hero } = stage('ne_gok_sa');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    const cells = Object.keys(MAPS[s.mapId].cells);
    const ngHex = cells.find(k => neighborKeys(k).filter(n => cells.includes(n)).length >= 2)!;
    const [adjA, adjB] = neighborKeys(ngHex).filter(n => cells.includes(n));
    s.figures.find(f => f.id === hero)!.at = ngHex;
    // A UNIQUE enemy (Marro Warriors) adjacent — a legal shackle target.
    s.figures.find(f => f.id === 's1-marro_warriors-1')!.at = adjA;
    // A COMMON enemy (Arrow Grut) adjacent — must NOT be targetable.
    s.cards.push({ uid: 's1-arrow_gruts', cardId: 'arrow_gruts', ownerSeat: 1, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    s.figures.push({ id: 's1-arrow_gruts-1', cardUid: 's1-arrow_gruts', ownerSeat: 1, at: adjB, at2: null, index: 1, wounds: 0 });

    const targets = mindShackleTargets(s, 0);
    expect(targets).toContain('s1-marro_warriors-1');     // unique squad IS shackle-able
    expect(targets).not.toContain('s1-arrow_gruts-1');    // common is NOT

    // The engine also rejects a hand-crafted attempt on the common (server re-validation),
    // even on a natural 20…
    const onCommon = applyAction(s, 'p1', { kind: 'mind_shackle', targetId: 's1-arrow_gruts-1', d20: 20 });
    expect('error' in onCommon).toBe(true);
    expect(s.figures.find(f => f.id === 's1-arrow_gruts-1')!.ownerSeat).toBe(1); // untouched
    // …but a 20 on the UNIQUE target still seizes it.
    const onUnique = unwrap(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: 's1-marro_warriors-1', d20: 20 }));
    expect(onUnique.figures.find(f => f.id === 's1-marro_warriors-1')!.ownerSeat).toBe(0);
  });

  it("Proftaka: a figure on the glyph can't move unless a friendly is adjacent", () => {
    let { s, hero } = stage('finn');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    const cells = Object.keys(MAPS[s.mapId].cells);
    const glyphHex = cells.find(k => neighborKeys(k).filter(n => cells.includes(n)).length >= 2)!;
    const adj = neighborKeys(glyphHex).find(n => cells.includes(n))!;
    const f = s.figures.find(x => x.id === hero)!;
    f.at = glyphHex; f.at2 = null;
    s.glyphs = [{ id: 'proftaka', at: glyphHex, faceUp: true }];
    s.figures.find(x => x.id === 's1-marro_warriors-4')!.at = cells[cells.length - 1]; // enemy far, not adjacent
    expect(legalDestinations(s, hero).size).toBe(0); // trapped — no friendly adjacent
    // A friendly figure adjacent frees it.
    s.figures.push({ id: 's0-finn-2', cardUid: 's0-finn', ownerSeat: 0, at: adj, at2: null, index: 2, wounds: 0 });
    expect(legalDestinations(s, hero).size).toBeGreaterThan(0);
  });

  it("Thorian: opponents must be ADJACENT to make a normal attack on the controller's figures", () => {
    let { s, hero } = stage('marro_warriors'); // Range-6 attacker (seat 0)
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.movementEnded = true; // attack phase, so legalTargets is live
    const aHex = Object.keys(MAPS[s.mapId].cells).find(
      k => neighborKeys(k).filter(n => MAPS[s.mapId].cells[n]).length >= 4,
    )!;
    s.figures.find(f => f.id === hero)!.at = aHex;
    const dHex = cellAtDist(s, aHex, 3); // in Range 6, clear LOS, NOT adjacent
    const def = s.figures.find(f => f.id === 's1-thorgrim-1')!;
    def.at = dHex; def.at2 = null;
    // Defender stands on Thorian → seat 1 controls it → a ranged normal attack is blocked.
    s.glyphs = [{ id: 'thorian', at: dHex, faceUp: true }];
    expect(legalTargets(s, hero)).not.toContain(def.id);
    // Without Thorian, the Range-6 attacker can hit it from distance 3.
    const noGlyph = JSON.parse(JSON.stringify(s)) as HSState;
    noGlyph.glyphs = [];
    expect(legalTargets(noGlyph, hero)).toContain(def.id);
  });
});

describe('Otonashi — Ninja (Phantom Walk / Attack the Wild / Tricky Speed)', () => {
  it('card stats + Phantom Walk flags (Ghost Walk + Disengage) as printed', () => {
    expect(HS_CARDS.otonashi).toMatchObject({
      type: 'hero', figures: 1, life: 1, move: 6, range: 1, attack: 2, defense: 3, height: 4, points: 10,
      ghostWalk: true, disengage: true, attackTheWild: 2, trickySpeed: 4,
    });
  });

  it('Attack the Wild 2 — +2 attack dice vs a Wild personality, none vs a non-Wild, NORMAL attacks only', () => {
    let { s, hero } = stage('otonashi'); // flat Training Field → no height noise
    s = JSON.parse(JSON.stringify(s)) as HSState; s.glyphs = []; // drop Astrid so the count is clean
    const cells = Object.keys(MAPS[s.mapId].cells);
    s = put(s, 's1-marro_warriors-1', cells[5]); // Marro Warriors = Wild
    s = put(s, 's1-thorgrim-1', cells[8]);        // Thorgrim = Valiant
    const oto = s.figures.find(f => f.id === hero)!;
    const marro = s.figures.find(f => f.id === 's1-marro_warriors-1')!;
    const thor = s.figures.find(f => f.id === 's1-thorgrim-1')!;
    expect(effectiveAttackDice(s, oto, marro).dice).toBe(4); // 2 printed + 2 Attack the Wild
    expect(effectiveAttackDice(s, oto, thor).dice).toBe(2);  // Valiant → no bonus
    expect(effectiveAttackDice(s, oto, marro, false).dice).toBe(2); // a special attack is unmodifiable
  });

  it('Tricky Speed 4 — +4 move adjacent to a FRIENDLY Tricky figure only', () => {
    let { s, hero } = stage('otonashi');
    s = JSON.parse(JSON.stringify(s)) as HSState; s.glyphs = []; // drop Valda/Astrid noise
    const h = at(s, hero)!;
    const nbr = neighborKeys(h).find(k => MAPS[s.mapId].cells[k])!;
    // Inject a friendly (seat 0) Tricky ally — Ne-Gok-Sa is "Tricky" — adjacent to Otonashi.
    s.cards.push({ uid: 's0-tricky', cardId: 'ne_gok_sa', ownerSeat: 0, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    s.figures.push({ id: 's0-tricky-1', cardUid: 's0-tricky', ownerSeat: 0, at: nbr, index: 1, wounds: 0 });
    const oto = () => s.figures.find(f => f.id === hero)!;
    expect(effectiveMove(s, oto()).dice).toBe(10); // 6 printed + 4 Tricky Speed
    // Ally no longer adjacent → printed 6.
    const far = Object.keys(MAPS[s.mapId].cells).find(k => k !== h && !neighborKeys(h).includes(k))!;
    s.figures.find(f => f.id === 's0-tricky-1')!.at = far;
    expect(effectiveMove(s, oto()).dice).toBe(6);
    // An ENEMY Tricky figure adjacent does NOT grant it (must be a figure YOU control).
    s.figures.find(f => f.id === 's0-tricky-1')!.ownerSeat = 1;
    s.cards.find(c => c.uid === 's0-tricky')!.ownerSeat = 1;
    s.figures.find(f => f.id === 's0-tricky-1')!.at = nbr;
    expect(effectiveMove(s, oto()).dice).toBe(6);
  });
});
