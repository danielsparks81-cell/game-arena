// HeroScape self-play FUZZER — plays many full games with random LEGAL moves and
// server-rolled dice (a faithful mini-copy of makeMoveHS's dice seam), asserting
// the pure engine never throws, never produces a malformed state, and that games
// terminate. This exercises the powers in combinations the scenario tests don't.
//
// Deterministic: each game runs from a seeded PRNG, so a failure prints the seed
// + the action log to reproduce. The engine itself stays pure (no Math.random
// here leaks into it — the fuzzer rolls the dice and injects them, exactly as the
// server does).
import { describe, it, expect } from 'vitest';
import {
  initialState,
  addPlayer,
  applyAction,
  getActiveCardUid,
  legalDestinations,
  grappleDestinations,
  legalTargets,
  canFireLine,
  fireLineSpaces,
  fireLineDefenders,
  canMindShackle,
  mindShackleTargets,
  canChomp,
  chompTargets,
  canGrenade,
  grenadeTargets,
  grenadeDefenders,
  attackDiceRequirements,
  moveConsequences,
} from './engine';
import { HS_CARDS } from './content';
import { MAPS } from './maps';
import type { HSState, HSAction, Figure, CombatFace, OrderMarkerValue } from './types';

// ---- seeded RNG ------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rng: () => number, xs: T[]): T => xs[Math.floor(rng() * xs.length)];
const rollFace = (rng: () => number): CombatFace => {
  const r = Math.floor(rng() * 6); // combat die: 3 skull / 2 shield / 1 blank
  return r < 3 ? 'skull' : r < 5 ? 'shield' : 'blank';
};
const rollN = (rng: () => number, n: number): CombatFace[] =>
  Array.from({ length: Math.max(0, n) }, () => rollFace(rng));
const d20 = (rng: () => number): number => 1 + Math.floor(rng() * 20);

const ATT = (a: number, b: number) => [[{ seat: 0, roll: a }, { seat: 1, roll: b }]];

// ---- set up a battle with two RANDOM armies (1-3 cards each from the 16, so
// every power gets exercised across many seeds). Figures are dropped onto real
// map cells (seat 0 from the front, seat 1 from the back) — double-space figures
// are placed 1-hex here (at2 omitted), which the engine tolerates; the fuzzer is
// about crash/termination coverage, not 2-hex fidelity. ---------------------
function setupRandomBattle(rng: () => number): HSState {
  let s = initialState();
  s = addPlayer(s, 'p1', 'Alice', 0, '#10b981');
  s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
  s = applyAction(s, 'p1', { kind: 'start_game', mode: 'quick' }) as HSState;
  const mapId = s.mapId;
  const cellKeys = Object.keys(MAPS[mapId].cells);
  const allCards = Object.keys(HS_CARDS);
  const armyFor = (): string[] => Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(rng, allCards));
  const cards: HSState['cards'] = [];
  const figures: Figure[] = [];
  let front = 0;
  let back = cellKeys.length - 1;
  for (const [seat, ids] of [[0, armyFor()], [1, armyFor()]] as const) {
    ids.forEach((cardId, idx) => {
      const def = HS_CARDS[cardId];
      const uid = `s${seat}-${cardId}-${idx}`;
      cards.push({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
      for (let n = 1; n <= def.figures && front <= back; n++) {
        const at = seat === 0 ? cellKeys[front++] : cellKeys[back--];
        figures.push({ id: `${uid}-${n}`, cardUid: uid, ownerSeat: seat, at, index: n, wounds: 0 });
      }
    });
  }
  const c: HSState = JSON.parse(JSON.stringify(s));
  c.cards = cards;
  c.figures = figures;
  c.mapId = mapId;
  return placeMarkersAndInit(c, rng);
}

// ---- place random order markers for both seats, then roll initiative --------
function placeMarkersAndInit(s: HSState, rng: () => number): HSState {
  const markers: OrderMarkerValue[] = ['1', '2', '3', 'X'];
  for (const seat of [0, 1]) {
    const pid = seat === 0 ? 'p1' : 'p2';
    const living = s.cards.filter(
      cd => cd.ownerSeat === seat && s.figures.some(f => f.cardUid === cd.uid && f.at != null),
    );
    if (living.length === 0) return s;
    const assignments = markers.map(m => ({ marker: m, cardUid: pick(rng, living).uid }));
    const r = applyAction(s, pid, { kind: 'place_markers', assignments });
    if ('error' in r) return s; // already placed / out of phase — bail this round
    s = r;
  }
  const r = applyAction(s, 'p2', { kind: 'roll_initiative', attempts: ATT(d20(rng), d20(rng)) as never });
  return 'error' in r ? s : r;
}

// ---- the server dice seam (a faithful mini-makeMoveHS) ----------------------
function serverApply(s: HSState, pid: 'p1' | 'p2', a: HSAction, rng: () => number): HSState | { error: string } {
  let e: HSAction = a;
  if (a.kind === 'attack') {
    const req = attackDiceRequirements(s, a.attackerId, a.targetId);
    e = { ...a, attackRoll: rollN(rng, req?.attack ?? 0), defenseRoll: rollN(rng, req?.defense ?? 0) };
  } else if (a.kind === 'fire_line') {
    const defs = fireLineDefenders(s, a.attackerId, a.dir);
    e = { ...a, attackRoll: rollN(rng, 4), defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: rollN(rng, d.defense) })) };
  } else if (a.kind === 'grenade_throw') {
    const pc = s.pendingChoice;
    const thrower = pc && pc.kind === 'grenade_throw' ? pc.throwers[0] : '';
    const defs = grenadeDefenders(s, thrower, a.targetId);
    e = { ...a, attackRoll: rollN(rng, 2), defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: rollN(rng, d.defense) })) };
  } else if (a.kind === 'move_figure' || a.kind === 'grapple_move') {
    const mover = s.figures.find(f => f.id === a.figureId);
    const cons = mover ? moveConsequences(s, mover, a.to) : { tier: 'none' as const, fallDice: 0, abandonedEnemyIds: [] as string[] };
    e = {
      ...a,
      ...(cons.tier === 'extreme' ? { extremeFallD20: d20(rng) } : cons.fallDice > 0 ? { fallRoll: rollN(rng, cons.fallDice) } : {}),
      ...(cons.abandonedEnemyIds.length ? { leaveRolls: cons.abandonedEnemyIds.map(id => ({ enemyFigureId: id, roll: rollFace(rng) })) } : {}),
    };
  } else if (a.kind === 'mind_shackle' || a.kind === 'chomp') {
    e = { ...a, d20: d20(rng) };
  } else if (a.kind === 'berserker_charge') {
    e = { kind: 'berserker_charge', d20: d20(rng) };
  } else if (a.kind === 'water_clone') {
    const uid = getActiveCardUid(s);
    const marro = s.figures.filter(f => f.cardUid === uid && f.at != null);
    e = { kind: 'water_clone', rolls: marro.map(f => ({ marroFigureId: f.id, d20: d20(rng) })) };
  }
  return applyAction(s, pid, e);
}

// ---- enumerate a few LEGAL wire-actions for the active seat -----------------
function legalActions(s: HSState, seat: number): HSAction[] {
  const out: HSAction[] = [];
  const uid = getActiveCardUid(s);
  if (uid == null) return out;
  const mine = s.figures.filter(f => f.cardUid === uid && f.at != null);
  for (const f of mine) {
    for (const to of legalDestinations(s, f.id)) out.push({ kind: 'move_figure', figureId: f.id, to } as HSAction);
    for (const to of grappleDestinations(s, f.id)) out.push({ kind: 'grapple_move', figureId: f.id, to } as HSAction);
    for (const t of legalTargets(s, f.id)) out.push({ kind: 'attack', attackerId: f.id, targetId: t } as HSAction);
    if (canFireLine(s, f.id)) {
      for (let dir = 0; dir < 6; dir++) if (fireLineSpaces(s, f.id, dir).length) out.push({ kind: 'fire_line', attackerId: f.id, dir } as HSAction);
    }
  }
  if (canMindShackle(s, seat)) for (const t of mindShackleTargets(s, seat)) out.push({ kind: 'mind_shackle', targetId: t, d20: 0 } as HSAction);
  if (canChomp(s, seat)) for (const t of chompTargets(s, seat)) out.push({ kind: 'chomp', targetId: t, d20: 0 } as HSAction);
  if (canGrenade(s, seat)) out.push({ kind: 'grenade' } as HSAction);
  return out;
}

// ---- resolve any open pendingChoice randomly --------------------------------
function resolvePending(s: HSState, rng: () => number): HSState | { error: string } | null {
  const pc = s.pendingChoice;
  if (!pc) return null;
  const pid = pc.seat === 0 ? 'p1' : 'p2';
  if (pc.kind === 'grenade_throw') {
    const tgts = grenadeTargets(s, pc.throwers[0]);
    if (!tgts.length) return null; // engine should have skipped; bail
    return serverApply(s, pid, { kind: 'grenade_throw', targetId: pick(rng, tgts) } as HSAction, rng);
  }
  if (pc.kind === 'berserker_charge') return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'berserker_charge', remove: rng() < 0.5 } });
  if (pc.kind === 'spirit_placement') return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'spirit_placement', cardUid: pick(rng, pc.options) } });
  if (pc.kind === 'water_clone_place') {
    const opts = pc.placements[pc.chosen.length]?.options ?? [];
    const free = opts.filter(h => !pc.chosen.includes(h));
    if (!free.length) return null;
    return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex: pick(rng, free) } });
  }
  return null;
}

// ---- invariants -------------------------------------------------------------
function assertValid(s: HSState): void {
  for (const f of s.figures) {
    expect(Number.isFinite(f.wounds)).toBe(true);
    expect(f.wounds).toBeGreaterThanOrEqual(0);
    if (f.at != null) expect(typeof f.at).toBe('string');
  }
  if (s.phase === 'finished') expect([0, 1, null]).toContain(s.winnerSeat ?? null);
  // ELIMINATION INVARIANT: once the battle is under way, if EITHER seat has no
  // living figures the game MUST be finished — a death path that leaves a seat
  // empty without ending the game is a bug (this is the kind of gap a fuzzer
  // catches that scenario tests miss). Skipped before turns begin (off-board
  // setup) and once finished.
  if (s.phase === 'playing' && s.subPhase === 'turns') {
    const alive = new Set(s.figures.filter(f => f.at != null).map(f => f.ownerSeat));
    expect(alive.has(0) && alive.has(1)).toBe(true);
  }
}

type Kinds = Record<string, number>;
function playGame(seed: number, kinds: Kinds): { rounds: number; finished: boolean; actions: number; capped: boolean } {
  const rng = mulberry32(seed);
  let s = setupRandomBattle(rng);
  let actions = 0;
  const CAP = 4000;
  const bump = (k: string) => { kinds[k] = (kinds[k] ?? 0) + 1; };
  while (s.phase !== 'finished' && actions < CAP) {
    actions++;
    assertValid(s);
    const pend = resolvePending(s, rng);
    if (pend) {
      if ('error' in pend) break;
      s = pend;
      continue;
    }
    if (s.subPhase === 'place_markers') {
      const next = placeMarkersAndInit(s, rng);
      if (next === s) break;
      s = next;
      continue;
    }
    if (s.subPhase !== 'turns' || s.turnSeat == null) break;
    const seat = s.turnSeat;
    const pid = seat === 0 ? 'p1' : 'p2';
    const acts = legalActions(s, seat);
    const choice: HSAction = acts.length && rng() < 0.7 ? pick(rng, acts) : { kind: 'end_turn' };
    const r = serverApply(s, pid, choice, rng);
    if ('error' in r) {
      const e2 = applyAction(s, pid, { kind: 'end_turn' });
      if ('error' in e2) break;
      s = e2;
    } else {
      bump(choice.kind); // count the action kinds that actually applied
      s = r;
    }
  }
  return { rounds: s.round, finished: s.phase === 'finished', actions, capped: actions >= CAP };
}

describe('HeroScape self-play fuzzer', () => {
  it('plays many random games without the engine throwing or hanging', () => {
    let finished = 0;
    let capped = 0;
    let totalActions = 0;
    const kinds: Kinds = {};
    const N = 80;
    for (let seed = 1; seed <= N; seed++) {
      const r = playGame(seed * 2654435761, kinds);
      if (r.finished) finished++;
      if (r.capped) capped++;
      totalActions += r.actions;
    }
    // eslint-disable-next-line no-console
    console.log(`[fuzz] ${N} games: ${finished} finished, ${capped} hit cap (stalemate), ${totalActions} actions; kinds=${JSON.stringify(kinds)}`);
    // The point is robustness: a crash or invalid state throws above and fails
    // the test. A few random games stalemate (neither side lands a kill) and hit
    // the cap — that's fine, not a hang. Most should still reach a winner.
    expect(finished).toBeGreaterThan(N * 0.5);
    expect(capped).toBeLessThan(N * 0.2); // very few should stalemate
    // The fuzzer must actually exercise the special powers (not just moves), or
    // it isn't testing much — assert each fired at least once across the batch.
    for (const k of ['attack', 'fire_line', 'grenade', 'chomp', 'mind_shackle']) {
      expect(kinds[k] ?? 0).toBeGreaterThan(0);
    }
  }, 30_000);
});
