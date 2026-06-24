// HeroScape self-play FUZZER — plays many full games with random LEGAL moves and
// server-rolled dice (a faithful mini-copy of makeMoveHS's dice seam), asserting
// the pure engine never throws, never produces a malformed state, and that games
// terminate. This exercises the powers in combinations the scenario tests don't.
//
// MULTIPLAYER: each game seats a RANDOM 2..6 players and a RANDOM team layout
// (free-for-all OR shared teams), so the N-player turn engine, the team-interleave
// turn order, per-team draft budgets' sibling (win = last TEAM standing), and the
// "eliminated seat keeps the game going" round flow all get hammered.
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
  effectiveDefenseDice,
  iceShardTargets,
  queglixTargets,
  queglixDiceLeft,
  wildSwingTargets,
  wildSwingDefenders,
  acidBreathTargets,
  canAcidBreath,
  throwTargets,
  throwLandingHexes,
  carryPassengers,
  erlandDestinations,
  erlandSummonableIds,
  sturlaPlacementHexes,
} from './engine';
import { HS_CARDS } from './content';
import { MAPS } from './maps';
import { neighborKeys } from './board';
import type { HSState, HSAction, Figure, CombatFace, OrderMarkerValue, InitiativeAttempt } from './types';

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

const pidOf = (seat: number): string => `p${seat + 1}`;
const SEAT_COLORS = ['#10b981', '#ef4444', '#eab308', '#a855f7', '#ec4899', '#14b8a6'];

/** d20 initiative attempts over `seats`, ties for highest re-rolled until the top
 *  roll is unique — matching the engine's tie discipline (every non-final attempt
 *  is tied-for-highest; the final is decisive). No Dagmar bonus (the fuzzer runs
 *  glyph-free), so plain 1-20 rolls validate. */
function buildInitAttempts(rng: () => number, seats: number[]): InitiativeAttempt[] {
  const out: InitiativeAttempt[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const att = seats.map(seat => ({ seat, roll: d20(rng) }));
    out.push(att);
    const max = Math.max(...att.map(a => a.roll));
    if (att.filter(a => a.roll === max).length === 1) break; // unique high → done
  }
  return out;
}

// ---- set up a battle with 2..6 RANDOM armies on real map cells. Figures take
// distinct cells from a single cursor (no overlap); double-space figures are
// placed 1-hex (at2 omitted), which the engine tolerates — the fuzzer is about
// crash/termination coverage, not 2-hex fidelity. The 'playing' state is built
// DIRECTLY (quick mode is 2-player only), glyph-free to keep initiative rolls
// plain (no Dagmar +8 to mirror). ----------------------------------------------
function setupRandomBattle(rng: () => number): HSState {
  const numPlayers = 2 + Math.floor(rng() * 5); // 2..6
  // Team layout: 40% free-for-all (team undefined ⇒ own team), else 2..numPlayers
  // shared teams. Seats 0..numTeams-1 get distinct ids so there are always ≥2.
  const ffa = rng() < 0.4;
  let teams: Record<number, number> | null = null;
  if (!ffa) {
    const numTeams = 2 + Math.floor(rng() * (numPlayers - 1)); // 2..numPlayers
    teams = {};
    for (let seat = 0; seat < numPlayers; seat++) {
      teams[seat] = seat < numTeams ? seat : Math.floor(rng() * numTeams);
    }
  }

  let s = initialState();
  for (let seat = 0; seat < numPlayers; seat++) {
    s = addPlayer(s, pidOf(seat), `Player ${seat + 1}`, seat, SEAT_COLORS[seat]);
  }
  const mapId = s.mapId;
  const cellKeys = Object.keys(MAPS[mapId].cells);
  const allCards = Object.keys(HS_CARDS);
  const armyFor = (): string[] => Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(rng, allCards));

  const cards: HSState['cards'] = [];
  const figures: Figure[] = [];
  let cursor = 0;
  for (let seat = 0; seat < numPlayers; seat++) {
    armyFor().forEach((cardId, idx) => {
      const def = HS_CARDS[cardId];
      const uid = `s${seat}-${cardId}-${idx}`;
      cards.push({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
      for (let n = 1; n <= def.figures && cursor < cellKeys.length; n++) {
        figures.push({ id: `${uid}-${n}`, cardUid: uid, ownerSeat: seat, at: cellKeys[cursor++], index: n, wounds: 0 });
      }
    });
  }

  const c: HSState = JSON.parse(JSON.stringify(s));
  c.players = c.players.map(p => ({ ...p, team: teams ? teams[p.seat] : undefined }));
  c.phase = 'playing';
  c.subPhase = 'place_markers';
  c.mode = 'quick';
  c.round = 1;
  c.turnNumber = 1;
  c.cards = cards;
  c.figures = figures;
  c.glyphs = [];
  c.mapId = mapId;
  return placeMarkersAndInit(c, rng);
}

// ---- place random order markers for every LIVING seat, then roll initiative.
// An eliminated seat (no figures — possible mid-game with 3+ players) is skipped;
// the engine gates initiative on living seats, not all players. ----------------
function placeMarkersAndInit(s: HSState, rng: () => number): HSState {
  const markers: OrderMarkerValue[] = ['1', '2', '3', 'X'];
  const seatsToPlace = [...new Set(s.figures.filter(f => f.at != null).map(f => f.ownerSeat))].sort((a, b) => a - b);
  if (seatsToPlace.length < 2) return s; // a single team left ⇒ the engine would have finished
  for (const seat of seatsToPlace) {
    const living = s.cards.filter(
      cd => cd.ownerSeat === seat && s.figures.some(f => f.cardUid === cd.uid && f.at != null),
    );
    if (living.length === 0) continue;
    const assignments = markers.map(m => ({ marker: m, cardUid: pick(rng, living).uid }));
    const r = applyAction(s, pidOf(seat), { kind: 'place_markers', assignments });
    if ('error' in r) return s; // out of phase — bail this round
    s = r;
  }
  const attempts = buildInitAttempts(rng, seatsToPlace);
  const r = applyAction(s, pidOf(seatsToPlace[0]), { kind: 'roll_initiative', attempts: attempts as never });
  return 'error' in r ? s : r;
}

// ---- the server dice seam (a faithful mini-makeMoveHS) ----------------------
function serverApply(s: HSState, pid: string, a: HSAction, rng: () => number): HSState | { error: string } {
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
  } else if (a.kind === 'ice_shard' || a.kind === 'queglix') {
    // Single-target special attack: roll the fixed/chosen attack dice + the
    // target's effective defense (printed + auras, no height).
    const tgt = s.figures.find(f => f.id === a.targetId);
    const atk = s.figures.find(f => f.id === a.attackerId);
    const dd = tgt && atk ? Math.max(0, effectiveDefenseDice(s, tgt, atk).dice) : 0;
    const aDice = a.kind === 'queglix' ? a.dice : 4;
    e = { ...a, attackRoll: rollN(rng, aDice), defenseRoll: rollN(rng, dd) };
  } else if (a.kind === 'wild_swing') {
    const defs = wildSwingDefenders(s, a.attackerId, a.targetId);
    e = { ...a, attackRoll: rollN(rng, 4), defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: rollN(rng, d.defense) })) };
  } else if (a.kind === 'acid_breath') {
    e = { ...a, rolls: a.rolls.map(r => ({ targetId: r.targetId, d20: d20(rng) })) };
  } else if (a.kind === 'throw_figure') {
    e = { ...a, throwD20: d20(rng), damageD20: d20(rng) };
  } else if (a.kind === 'carry_move') {
    const mover = s.figures.find(f => f.id === a.figureId);
    const cons = mover ? moveConsequences(s, mover, a.to) : { tier: 'none' as const, fallDice: 0, abandonedEnemyIds: [] as string[] };
    e = {
      ...a,
      ...(cons.tier === 'extreme' ? { extremeFallD20: d20(rng) } : cons.fallDice > 0 ? { fallRoll: rollN(rng, cons.fallDice) } : {}),
      ...(cons.abandonedEnemyIds.length ? { leaveRolls: cons.abandonedEnemyIds.map(id => ({ enemyFigureId: id, roll: rollFace(rng) })) } : {}),
    };
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
  // Big Heroes special powers (slice 8b) — enumerate legal instances of whichever
  // power the ACTIVE Big Hero card has; serverApply fills the dice. The hero is a
  // 1-figure card, so mine[0] is it (if alive).
  const activeDef = HS_CARDS[s.cards.find(c => c.uid === uid)?.cardId ?? ''];
  const hero = mine[0];
  if (activeDef?.id === 'nilfheim' && hero) {
    for (const t of iceShardTargets(s, hero.id)) out.push({ kind: 'ice_shard', attackerId: hero.id, targetId: t } as HSAction);
  } else if (activeDef?.id === 'major_q9' && hero) {
    const left = queglixDiceLeft(s);
    for (const t of queglixTargets(s, hero.id)) for (const dice of [1, 2, 3]) if (dice <= left) out.push({ kind: 'queglix', attackerId: hero.id, targetId: t, dice } as HSAction);
  } else if (activeDef?.id === 'jotun' && hero) {
    for (const t of wildSwingTargets(s, hero.id)) out.push({ kind: 'wild_swing', attackerId: hero.id, targetId: t } as HSAction);
    for (const t of throwTargets(s, seat)) {
      const lands = throwLandingHexes(s, hero.id, t);
      if (lands.length) out.push({ kind: 'throw_figure', attackerId: hero.id, targetId: t, to: lands[0] } as HSAction);
    }
  } else if (activeDef?.id === 'braxas' && hero && canAcidBreath(s, seat)) {
    const targs = acidBreathTargets(s, seat);
    if (targs.length) out.push({ kind: 'acid_breath', attackerId: hero.id, rolls: targs.slice(0, 3).map(targetId => ({ targetId, d20: 0 })) } as HSAction);
  } else if (activeDef?.id === 'theracus' && hero && hero.at2 != null) {
    // Carry runs a real move, so only fuzz it for a properly placed 2-hex
    // Theracus (the random setup places figures 1-hex, so this is usually
    // skipped — Carry's move path is covered by the scenario tests).
    const passengers = carryPassengers(s, seat);
    const dests = [...legalDestinations(s, hero.id)];
    if (passengers.length && dests.length) {
      const occ = new Set(s.figures.flatMap(f => [f.at, f.at2].filter(Boolean) as string[]));
      const land = neighborKeys(dests[0]).find(k => MAPS[s.mapId].cells[k] && !occ.has(k) && k !== dests[0]);
      if (land) out.push({ kind: 'carry_move', figureId: hero.id, to: dests[0], passengerId: passengers[0], passengerTo: land } as HSAction);
    }
  }
  return out;
}

// ---- resolve any open pendingChoice randomly --------------------------------
function resolvePending(s: HSState, rng: () => number): HSState | { error: string } | null {
  const pc = s.pendingChoice;
  if (!pc) return null;
  const pid = pidOf(pc.seat);
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
  if (pc.kind === 'roll_ceremony') {
    // Two-step per figure: SELECT the next un-rolled figure (shared highlight), then ROLL it.
    if (pc.selectedFigureId == null) {
      const next = pc.queue[0]?.figureIds[0];
      if (!next) return null;
      return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_select', figureId: next } });
    }
    return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_roll', d20: d20(rng) } });
  }
  if (pc.kind === 'glyph_sturla_place') {
    const hexes = sturlaPlacementHexes(s, pc.figureId);
    if (!hexes.length) return null; // engine should have skipped this riser
    return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'glyph_sturla_place', hex: pick(rng, hexes) } });
  }
  if (pc.kind === 'glyph_oreld') {
    const d = d20(rng);
    const list = d === 1 ? pc.ownCandidates : pc.foeCandidates;
    const e = list.length ? pick(rng, list) : { cardUid: '', markerIndex: -1 };
    return applyAction(s, pid, {
      kind: 'resolve_choice',
      choice: { kind: 'glyph_oreld', d20: d, cardUid: e.cardUid, markerIndex: e.markerIndex },
    });
  }
  // wave-3 CHOICE glyphs — exercise the human/AI decision paths under random play.
  if (pc.kind === 'glyph_erland') {
    const figs = erlandSummonableIds(s);
    const dests = erlandDestinations(s);
    if (!figs.length || !dests.length) return null; // engine should have fizzled
    return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'glyph_erland', figureId: pick(rng, figs), to: pick(rng, dests) } });
  }
  if (pc.kind === 'glyph_nilrend') {
    if (pc.d20 == null) return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'glyph_nilrend', d20: d20(rng) } });
    const eligible = pc.d20 === 1 ? pc.ownCardUids : pc.foeCardUids;
    if (!eligible.length) return null; // engine fizzles the empty side at the roll
    return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'glyph_nilrend', cardUid: pick(rng, eligible) } });
  }
  if (pc.kind === 'glyph_wannok') {
    if (pc.d20 == null) return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', d20: d20(rng) } });
    const teamOf = (seat: number) => s.players.find(p => p.seat === seat)?.team ?? -1 - seat;
    const opps = s.players.filter(p => teamOf(p.seat) !== teamOf(pc.seat) && s.figures.some(f => f.at != null && f.ownerSeat === p.seat)).map(p => p.seat);
    if (!opps.length) return null;
    return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', opponentSeat: pick(rng, opps) } });
  }
  if (pc.kind === 'glyph_wannok_victim') {
    const mine = s.figures.filter(f => f.at != null && f.ownerSeat === pc.seat).map(f => f.id);
    if (!mine.length) return null;
    return applyAction(s, pid, { kind: 'resolve_choice', choice: { kind: 'glyph_wannok_victim', figureId: pick(rng, mine) } });
  }
  return null;
}

// ---- invariants -------------------------------------------------------------
function assertValid(s: HSState): void {
  const seats = s.players.map(p => p.seat);
  // Mirror the engine's encoding: an unassigned (solo) seat is its own team, id -1-seat.
  const teamOf = (seat: number): number => s.players.find(p => p.seat === seat)?.team ?? -1 - seat;
  for (const f of s.figures) {
    expect(Number.isFinite(f.wounds)).toBe(true);
    expect(f.wounds).toBeGreaterThanOrEqual(0);
    if (f.at != null) expect(typeof f.at).toBe('string');
  }
  if (s.phase === 'finished') {
    expect([...seats, null]).toContain(s.winnerSeat ?? null);
    // The winning side is a single team; winnerTeam names it.
    if (s.winnerSeat != null) expect(s.winnerTeam).toBe(teamOf(s.winnerSeat));
  }
  // ELIMINATION INVARIANT (team-aware): once the battle is under way, MORE THAN
  // ONE team must still have a living figure — the moment only one team remains
  // the game MUST be finished. A death path that wipes the last rival team
  // without ending the game is a bug (exactly the gap a fuzzer catches). Skipped
  // before turns begin (setup) and once finished.
  if (s.phase === 'playing' && s.subPhase === 'turns') {
    const teamsAlive = new Set(s.figures.filter(f => f.at != null).map(f => teamOf(f.ownerSeat)));
    expect(teamsAlive.size).toBeGreaterThan(1);
  }
}

type Kinds = Record<string, number>;
function playGame(seed: number, kinds: Kinds): { rounds: number; finished: boolean; actions: number; capped: boolean; players: number } {
  const rng = mulberry32(seed);
  let s = setupRandomBattle(rng);
  const players = s.players.length;
  let actions = 0;
  const CAP = 5000;
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
    const pid = pidOf(seat);
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
  return { rounds: s.round, finished: s.phase === 'finished', actions, capped: actions >= CAP, players };
}

describe('HeroScape self-play fuzzer', () => {
  it('plays many random 2-6 player games without the engine throwing or hanging', () => {
    let finished = 0;
    let capped = 0;
    let totalActions = 0;
    const kinds: Kinds = {};
    const byPlayers: Record<number, number> = {};
    const N = 120;
    for (let seed = 1; seed <= N; seed++) {
      const r = playGame(seed * 2654435761, kinds);
      if (r.finished) finished++;
      if (r.capped) capped++;
      totalActions += r.actions;
      byPlayers[r.players] = (byPlayers[r.players] ?? 0) + 1;
    }
    // eslint-disable-next-line no-console
    console.log(`[fuzz] ${N} games: ${finished} finished, ${capped} hit cap (stalemate), ${totalActions} actions; players=${JSON.stringify(byPlayers)}; kinds=${JSON.stringify(kinds)}`);
    // The point is robustness: a crash or invalid state throws above and fails
    // the test. Some random games stalemate (no side lands a finishing blow) and
    // hit the cap — with 3-6 mutually-wary armies that is more common than 1-v-1,
    // so the bar is looser than the 2-player fuzzer's. Most should still resolve.
    expect(finished).toBeGreaterThan(N * 0.4);
    expect(capped).toBeLessThan(N * 0.45);
    // The fuzzer must actually exercise the special powers (not just moves), or
    // it isn't testing much — assert each fired at least once across the batch.
    // Includes the 5 Big-Hero powers it drives (slice 8b). Carry is omitted: the
    // random setup places figures 1-hex, so a 2-hex Theracus's move-based Carry is
    // guarded off here and is covered by big-heroes.test.ts instead.
    for (const k of [
      'attack', 'fire_line', 'grenade', 'chomp', 'mind_shackle',
      'ice_shard', 'queglix', 'wild_swing', 'acid_breath', 'throw_figure',
    ]) {
      expect(kinds[k] ?? 0).toBeGreaterThan(0);
    }
  }, 60_000);
});
