// OVERNIGHT STRESS (2026-07-02) — mass AI-vs-AI simulation sweep for the gladiator/vampire
// go-live batch. Opt-in (slow): run with  STRESS=1 npx vitest run overnight-stress
//
// This is the heavy sibling of audit-playthrough.test.ts: the same deterministic
// seeded driver, but ~110 FULL games across forced new-card armies, mixed new+old
// armies, natural big-budget drafts, 4-6 player FFA/teams, and the walled random-glyph
// PERCOLATOR map. Beyond "no crash + a winner", it tracks POWER TELEMETRY per step so
// the batch can assert every new special genuinely fires in real games:
//   blood_hungry / net_trip / chilling_touch (intents), eternal_hatred + summon_rechets
//   (pending choices), Marcu control transfers, successful summons, Gladiator Inspiration.
// End-state invariants (2-hex at2 integrity, on-map positions) run after every game.
import { describe, it, expect } from 'vitest';
import {
  createInitialStateForHost,
  applyAction,
  aiNextAction,
  aiEngineAction,
  livingSeats,
  seatInitiativeBonus,
  canTheDrop,
} from './engine';
import { COMBAT_DIE_FACES, HS_CARDS } from './content';
import { MAPS } from './maps';
import type { HSState, HSAction, CombatFace, InitiativeAttempt } from './types';

const STRESS = !!process.env.STRESS;

// ---- seeded PRNG (matches audit-playthrough.test.ts so seeds line up) -------
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function unwrap(r: ReturnType<typeof applyAction>, ctx = ''): HSState {
  if (r && typeof r === 'object' && 'error' in r) throw new Error(`engine rejected${ctx ? ` (${ctx})` : ''}: ${r.error}`);
  return r as HSState;
}

function anyPendingSeat(s: HSState): number | null {
  if (s.pendingChoice) return s.pendingChoice.seat;
  if (s.phase === 'draft') return s.draft?.turnSeat ?? null;
  if (s.phase === 'placement') return s.players.find(p => !(s.placementReady ?? []).includes(p.seat))?.seat ?? null;
  if (s.phase !== 'playing') return null;
  if (s.subPhase === 'place_markers') {
    // THE DROP FIRST (mirrors aiPendingSeat): the marker gate blocks EVERY seat until the
    // Airborne owner rolls, so the dropper must act before anyone places markers.
    const dropper = s.players.find(p => canTheDrop(s, p.seat));
    if (dropper) return dropper.seat;
    const living = livingSeats(s);
    return s.players.find(p => living.includes(p.seat) && !(s.markersReady ?? []).includes(p.seat))?.seat ?? null;
  }
  return s.marcuControlSeat ?? s.turnSeat ?? null;
}

function decisive(seats: number[]): InitiativeAttempt {
  return seats.map((seat, i) => ({ seat, roll: 20 - i }));
}

type Telemetry = {
  finished: boolean;
  rounds: number;
  steps: number;
  capped: boolean;
  kinds: Record<string, number>;
  /** pendingChoice kinds observed at any step (eternal_hatred, summon_rechets, glyph_*, …). */
  choicesSeen: Set<string>;
  /** Marcu control actually transferred to an opponent at some point. */
  marcuControlled: boolean;
  /** The Rechets were successfully summoned in this game. */
  summoned: boolean;
  /** Gladiator Inspiration was active during some round. */
  inspired: boolean;
  glyphsRevealed: number;
  state: HSState;
};

const armyCost = (ids: string[]) => ids.reduce((t, id) => t + HS_CARDS[id].points, 0);

/** Drive a FULL game with the AI on every seat (same shape as audit-playthrough,
 *  plus per-step power telemetry). `armies` forces the post-roll draft. */
function playFullGame(opts: {
  seed: number;
  budget: number;
  bots: number;
  mapId?: string;
  teams?: Record<number, number>;
  armies?: Record<number, string[]>;
  cap?: number;
  glyphSeed?: number;
}): Telemetry {
  const { seed, budget, bots, mapId = 'training_field', teams, armies, cap = 40000, glyphSeed } = opts;
  const rng = makeRng(seed);
  const rollDie = (): CombatFace => COMBAT_DIE_FACES[Math.floor(rng() * COMBAT_DIE_FACES.length)];
  const rollers = {
    rollDie,
    rollDice: (n: number) => Array.from({ length: n }, rollDie),
    d20: () => 1 + Math.floor(rng() * 20),
    rng, // enables the WEIGHTED draft (the live-server path) — armies vary by seed
  };
  const idOf = (s: HSState, seat: number) => s.players.find(p => p.seat === seat)!.playerId;

  let s = createInitialStateForHost({ userId: 'host', username: 'Host' });
  for (let b = 0; b < bots; b++) s = unwrap(applyAction(s, 'host', { kind: 'add_bot' }), 'add_bot');
  if (teams) {
    s = unwrap(applyAction(s, 'host', { kind: 'set_lobby_config', mapId, pointBudget: budget, mode: 'draft', teams }), 'set_teams');
  }
  s = unwrap(applyAction(s, 'host', { kind: 'start_game', mode: 'draft', pointBudget: budget, mapId, ...(glyphSeed != null ? { glyphSeed } : {}) }), 'start_game');
  s = unwrap(applyAction(s, 'host', { kind: 'draft_roll', attempts: [decisive(s.players.map(p => p.seat))] }), 'draft_roll');
  if (armies) {
    const c = JSON.parse(JSON.stringify(s)) as HSState;
    for (const [seatStr, ids] of Object.entries(armies)) {
      const seat = Number(seatStr);
      c.draft!.armies[seat] = [...ids];
      c.draft!.spent[seat] = armyCost(ids);
    }
    // Mirror real drafting: a UNIQUE card leaves the pool when drafted. Without this the
    // bots re-draft the forced uniques (two Cypriens on one card — unreachable live).
    const forced = new Set(Object.values(armies).flat());
    c.draft!.pool = c.draft!.pool.filter(id => HS_CARDS[id].common || !forced.has(id));
    s = c;
  }

  const kinds: Record<string, number> = {};
  const choicesSeen = new Set<string>();
  let marcuControlled = false;
  let inspired = false;
  let steps = 0;
  let capped = false;
  for (let i = 0; i < cap; i++) {
    if (s.phase === 'finished') break;
    if (s.pendingChoice) choicesSeen.add(s.pendingChoice.kind);
    if (s.marcuControlSeat != null) marcuControlled = true;
    if ((s.inspiredCardUids?.length ?? 0) > 0) inspired = true;
    // Replicate the SERVER's auto-resolve loop (actions.ts): these four choices' STEP-1 d20s
    // are rolled server-side, never by the AI brain — a driver that skips this stalls on them.
    const pc = s.pendingChoice;
    if (pc && (pc.kind === 'glyph_oreld' || pc.kind === 'glyph_nilrend' || pc.kind === 'glyph_wannok' || pc.kind === 'eternal_hatred') && pc.d20 == null) {
      s = unwrap(
        applyAction(s, idOf(s, pc.seat), { kind: 'resolve_choice', choice: { kind: pc.kind, d20: rollers.d20() } }),
        `server auto-roll ${pc.kind} (seed=${seed})`,
      );
      steps++;
      continue;
    }
    if (
      s.phase === 'playing' &&
      s.subPhase === 'place_markers' &&
      livingSeats(s).every(seat => (s.markersReady ?? []).includes(seat))
    ) {
      // Tie-proof: fix the TOTALS as strictly descending (20, 19, 18…) and derive each seat's
      // raw as total − its FULL bonus (Dagmar + Lodin + Capuan — the engine's own total, so a
      // glyph-holding seat validates too). A bonus can never equalize the roll-off this way.
      const stateAtRoll = s;
      const att = livingSeats(s).map((seat, i) => {
        const bonus = seatInitiativeBonus(stateAtRoll, seat);
        const raw = Math.max(1, 20 - i - bonus); // clamp for extreme stacks (2×Dagmar+Lodin)
        return bonus > 0 ? { seat, raw, bonus, roll: raw + bonus } : { seat, roll: raw };
      });
      s = unwrap(applyAction(s, 'host', { kind: 'roll_initiative', attempts: [att] }), 'roll_initiative');
      continue;
    }
    const seat = anyPendingSeat(s);
    if (seat == null) throw new Error(`stalled: nobody owes an action (phase=${s.phase}/${s.subPhase}, round=${s.round}, seed=${seed})`);
    const intent: HSAction | null = aiNextAction(s, seat);
    if (!intent) throw new Error(`seat ${seat} produced no intent (phase=${s.phase}/${s.subPhase}, round=${s.round}, choice=${s.pendingChoice?.kind}, seed=${seed})`);
    const applied = aiEngineAction(s, intent, rollers);
    s = unwrap(applyAction(s, idOf(s, seat), applied), `${intent.kind} by seat ${seat} (seed=${seed})`);
    kinds[intent.kind] = (kinds[intent.kind] ?? 0) + 1;
    steps++;
    if (i === cap - 1) capped = true;
  }

  return {
    finished: s.phase === 'finished',
    rounds: s.round,
    steps,
    capped,
    kinds,
    choicesSeen,
    marcuControlled,
    inspired,
    summoned: (s.rechetsSummoned?.length ?? 0) > 0,
    glyphsRevealed: (s.glyphs ?? []).filter(g => g.faceUp).length,
    state: s,
  };
}

/** End-state invariants that must hold after EVERY game, whatever happened in it. */
function assertEndInvariants(t: Telemetry, label: string) {
  const s = t.state;
  expect(t.capped, `${label}: hit the step cap (stall?)`).toBe(false);
  expect(t.finished, `${label}: game did not finish`).toBe(true);
  const cells = MAPS[s.mapId].cells;
  for (const f of s.figures) {
    if (f.at == null) continue;
    expect(cells[f.at], `${label}: ${f.id} stands OFF the map at ${f.at}`).toBeTruthy();
    const card = s.cards.find(c => c.uid === f.cardUid)!;
    const def = HS_CARDS[card.cardId];
    if ((def.baseSize ?? 1) === 2) {
      // The 2-hex landmine: an on-board double-space figure must ALWAYS have its tail set.
      expect(f.at2, `${label}: 2-hex ${f.id} (${def.name}) has a null at2`).toBeTruthy();
      expect(cells[f.at2!], `${label}: 2-hex ${f.id} tail OFF the map at ${f.at2}`).toBeTruthy();
    } else {
      expect(f.at2 ?? null, `${label}: 1-hex ${f.id} carries a stale at2`).toBeNull();
    }
  }
}

const GLADIATORS = ['spartacus', 'crixus', 'retiarius', 'capuan_gladiators'];
const VAMPIRES = ['iskra_esenwein', 'marcu_esenwein', 'cyprien_esenwein', 'sonya_esenwein', 'rechets_of_bogdan'];

describe.runIf(STRESS)('OVERNIGHT — forced gladiators vs vampires (20 seeds)', () => {
  it('every game finishes; across the batch every new special fires', () => {
    const agg = { blood: 0, net: 0, chill: 0, hatred: 0, summonChoice: 0, summoned: 0, controlled: 0, inspired: 0, finished: 0 };
    const N = 20;
    for (let k = 1; k <= N; k++) {
      const t = playFullGame({
        seed: k * 7919,
        budget: 700,
        bots: 1,
        armies: { 0: GLADIATORS, 1: [...VAMPIRES, 'brunak'] },
      });
      assertEndInvariants(t, `glad-vs-vamp seed ${k * 7919}`);
      agg.finished += t.finished ? 1 : 0;
      agg.blood += t.kinds['blood_hungry'] ?? 0;
      agg.net += t.kinds['net_trip'] ?? 0;
      agg.chill += t.kinds['chilling_touch'] ?? 0;
      agg.hatred += t.choicesSeen.has('eternal_hatred') ? 1 : 0;
      agg.summonChoice += t.choicesSeen.has('summon_rechets') ? 1 : 0;
      agg.summoned += t.summoned ? 1 : 0;
      agg.controlled += t.marcuControlled ? 1 : 0;
      agg.inspired += t.inspired ? 1 : 0;
    }
    // eslint-disable-next-line no-console
    console.log(`[stress glad-vs-vamp] ${JSON.stringify(agg)}`);
    expect(agg.finished).toBe(N);
    // Every new power genuinely fires somewhere in the batch.
    expect(agg.blood, 'Blood Hungry never fired').toBeGreaterThan(0);
    expect(agg.net, 'Net Trip never rolled').toBeGreaterThan(0);
    expect(agg.chill, 'Chilling Touch never attempted').toBeGreaterThan(0);
    expect(agg.hatred, 'Eternal Hatred choice never opened').toBeGreaterThan(0);
    expect(agg.summonChoice, 'Summon offer never opened').toBeGreaterThan(0);
    expect(agg.summoned, 'the Rechets were never successfully summoned').toBeGreaterThan(0);
    expect(agg.controlled, 'Marcu control never transferred').toBeGreaterThan(0);
    expect(agg.inspired, 'Gladiator Inspiration never activated').toBeGreaterThan(0);
  }, 600_000);
});

describe.runIf(STRESS)('OVERNIGHT — vampire mirror match (6 seeds, double Marcu/summon pressure)', () => {
  it('two full vampire armies fight to a finish', () => {
    for (let k = 1; k <= 6; k++) {
      const t = playFullGame({
        seed: k * 104729,
        budget: 700,
        bots: 1,
        armies: { 0: [...VAMPIRES], 1: [...VAMPIRES] },
      });
      assertEndInvariants(t, `vamp-mirror seed ${k * 104729}`);
    }
  }, 300_000);
});

describe.runIf(STRESS)('OVERNIGHT — new cards mixed with the existing roster (20 seeds)', () => {
  // Each pairing crosses a new card into an old-card interaction seam:
  // counter strike (samurai), stealth dodge (krav), scatter (rats), aura (raelin),
  // The Drop (airborne), chomp/2-hex (grimnak), water clone (marro), fire line (mimring).
  const PAIRINGS: [string[], string[]][] = [
    [['brunak', 'izumi_samurai'], ['crixus', 'krav_maga']],
    [['retiarius', 'deathreavers'], ['cyprien_esenwein', 'raelin']],
    [['spartacus', 'capuan_gladiators', 'crixus'], ['airborne_elite', 'marro_warriors']],
    [['iskra_esenwein', 'rechets_of_bogdan', 'marcu_esenwein'], ['grimnak', 'blade_gruts']],
    [['sonya_esenwein', 'cyprien_esenwein'], ['mimring', 'zettian_guards']],
    [['brunak', 'blade_gruts'], ['retiarius', 'izumi_samurai']],
    [['capuan_gladiators', 'crixus', 'retiarius'], ['ne_gok_sa', 'marro_warriors']],
    [['marcu_esenwein', 'iskra_esenwein', 'rechets_of_bogdan'], ['syvarris', 'tarn_vikings']],
    [['spartacus', 'crixus'], ['drake', 'krav_maga']],
    [['cyprien_esenwein', 'sonya_esenwein', 'iskra_esenwein', 'rechets_of_bogdan'], ['finn', 'thorgrim', 'tarn_vikings']],
  ];
  it('every pairing finishes twice (two seeds each) with clean end-state invariants', () => {
    let n = 0;
    for (const [a, b] of PAIRINGS) {
      for (const seed of [n * 31 + 5, n * 31 + 17]) {
        const t = playFullGame({ seed: seed * 6151, budget: 900, bots: 1, armies: { 0: a, 1: b } });
        assertEndInvariants(t, `mixed[${n}] seed ${seed * 6151} (${a[0]} vs ${b[0]})`);
      }
      n++;
    }
  }, 600_000);
});

describe.runIf(STRESS)('OVERNIGHT — natural drafts at a big budget (40 seeds, pool of 39)', () => {
  it('the weighted-random AI draft (which now sees all 10 new cards) always reaches a finish', () => {
    let finished = 0;
    let newCardDrafts = 0;
    const NEW = new Set([...GLADIATORS, ...VAMPIRES, 'brunak']);
    const N = 40;
    for (let k = 1; k <= N; k++) {
      const t = playFullGame({ seed: k * 2477, budget: 450, bots: 1 });
      assertEndInvariants(t, `natural seed ${k * 2477}`);
      finished += t.finished ? 1 : 0;
      if (t.state.cards.some(c => NEW.has(c.cardId))) newCardDrafts++;
    }
    // eslint-disable-next-line no-console
    console.log(`[stress natural] finished=${finished}/${N} gamesWithNewCards=${newCardDrafts}`);
    expect(finished).toBe(N);
    expect(newCardDrafts, 'the AI never drafted a new card in 40 games').toBeGreaterThan(0);
  }, 900_000);
});

describe.runIf(STRESS)('OVERNIGHT — multiplayer: 4p FFA + 6p teams with new cards salted in', () => {
  it('4-player FFA on star_field finishes (8 seeds)', () => {
    for (let k = 1; k <= 8; k++) {
      const t = playFullGame({
        seed: k * 3571,
        budget: 500,
        bots: 3,
        mapId: 'star_field',
        armies: k % 2 === 0
          ? { 0: GLADIATORS, 1: [...VAMPIRES], 2: ['grimnak', 'blade_gruts'], 3: ['izumi_samurai', 'raelin'] }
          : undefined,
        cap: 60000,
      });
      assertEndInvariants(t, `4p seed ${k * 3571}`);
    }
  }, 1_800_000); // 4p AI games average ~75s each — give the batch real headroom
  it('6-player 3v3 TEAMS finishes (4 seeds) — Eternal Hatred must pick an ENEMY, never a teammate', () => {
    for (let k = 1; k <= 4; k++) {
      const t = playFullGame({
        seed: k * 4523,
        budget: 1000, // PER-TEAM budget: covers the forced ~480-pt armies + room for teammates to draft
        bots: 5,
        mapId: 'star_field',
        teams: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
        armies: {
          0: [...VAMPIRES],
          3: GLADIATORS,
        },
        cap: 80000,
      });
      assertEndInvariants(t, `6p teams seed ${k * 4523}`);
      // If control ever transferred, it landed on the ENEMY team (the engine validated it);
      // reaching a finish proves no teammate-control wedge occurred.
      const winnerTeam = t.state.winnerTeam;
      expect([0, 1]).toContain(winnerTeam);
    }
  }, 600_000);
});

describe.runIf(STRESS)('OVERNIGHT — vampires on the walled random-glyph PERCOLATOR (10 seeds)', () => {
  // The map that maximizes collision odds: random face-down glyphs (incl. choice-openers
  // like Oreld/Erland/Mitonsoul) + summoned bats landing anywhere within 6 of Iskra.
  it('full vampire games with live random glyph pools always finish', () => {
    let anySummon = 0;
    for (let k = 1; k <= 10; k++) {
      const t = playFullGame({
        seed: k * 911,
        budget: 700,
        bots: 1,
        mapId: 'percolator_by_ulysses',
        glyphSeed: k * 13,
        armies: { 0: [...VAMPIRES], 1: GLADIATORS },
      });
      assertEndInvariants(t, `percolator seed ${k * 911}`);
      if (t.summoned) anySummon++;
    }
    // eslint-disable-next-line no-console
    console.log(`[stress percolator] summonsSucceeded=${anySummon}/10`);
  }, 600_000);
});
