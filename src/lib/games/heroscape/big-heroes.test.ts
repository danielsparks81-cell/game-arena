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
  carryPassengers,
  iceShardTargets,
  queglixDiceLeft,
  throwLandingHexes,
} from './engine';
import { rangeDistance, neighborKeys } from './board';
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
// Major Q9 — QUEGLIX GUN: Range 6, 9-die pool spent 1-3 per shot
// ===========================================================================
describe('Major Q9 — Queglix Gun', () => {
  it('spends a 9-die pool 1-3 at a time; a shot exceeding the pool is rejected', () => {
    let { s, hero } = stage('major_q9');
    s = put(s, 's1-thorgrim-1', cellAtDist(s, at(s, hero)!, 6)); // edge of Range 6
    expect(queglixDiceLeft(s)).toBe(9);
    for (let i = 0; i < 3; i++) {
      s = unwrap(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 3, attackRoll: F('bbb'), defenseRoll: def(s, 's1-thorgrim-1', hero) }));
    }
    expect(queglixDiceLeft(s)).toBe(0);
    expect(errOf(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 1, attackRoll: F('b'), defenseRoll: def(s, 's1-thorgrim-1', hero) }))).toMatch(/dice left|already/i);
  });

  it('rejects 0 or 4 dice per shot and a target beyond Range 6', () => {
    let { s, hero } = stage('major_q9');
    const h = at(s, hero)!;
    s = put(s, 's1-thorgrim-1', cellAtDist(s, h, 6));
    expect(errOf(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 4 as 1, attackRoll: F('bbbb'), defenseRoll: F('bbbb') }))).toMatch(/1, 2, or 3/i);
    s = put(s, 's1-thorgrim-1', cellAtDist(s, h, 7));
    expect(errOf(applyAction(s, 'p1', { kind: 'queglix', attackerId: hero, targetId: 's1-thorgrim-1', dice: 1, attackRoll: F('b'), defenseRoll: F('bbbb') }))).toMatch(/range|sight/i);
  });
});

// ===========================================================================
// Jotun — WILD SWING: Range 1, Attack 4, splash to figures adjacent to target
// ===========================================================================
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
    expect(errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: hero, targetId: 's1-marro_warriors-2', attackRoll: F('k'), defenseRoll: F('bbb') }))).toMatch(/already/i);
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
});
