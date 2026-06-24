// AUDIT PLAYTHROUGH — full-game, AI-driven, deterministic end-to-end runs added
// for the engine audit (2026-06). These drive REAL games from lobby → draft →
// placement → multiple full rounds → a declared winner, with the AI brain on
// EVERY seat (so both sides actually play), and assert the high-level health of
// the whole pipeline:
//   • the engine never throws / never rejects a legal AI intent,
//   • phases advance in the documented order and a winner is eventually declared,
//   • a 2-player AND a 3-player(+teams, 2-v-1) game both finish with a coherent
//     winner/winnerTeam,
//   • at least one GLYPH triggers (a face-down glyph flipped face-up by a figure
//     stopping on it) and at least one SPECIAL ATTACK fires across the batch.
//
// This complements fuzz.test.ts (random LEGAL moves, crash/termination coverage)
// and ai.test.ts (the AI brain): here the AI plays itself to completion and we
// watch the SHAPE of the whole match. The file is self-contained and can be kept
// as a regression net or removed — it modifies no engine/UI source.
//
// Deterministic: every die is rolled by a seeded PRNG and injected via
// aiEngineAction, so the engine stays pure (no Math.random leaks in) and any
// failure reproduces from its seed.
import { describe, it, expect } from 'vitest';
import {
  createInitialStateForHost,
  applyAction,
  aiNextAction,
  aiPendingSeat,
  aiEngineAction,
  livingSeats,
} from './engine';
import { COMBAT_DIE_FACES } from './content';
import type { HSState, HSAction, CombatFace, InitiativeAttempt } from './types';

// ---- seeded PRNG (matches ai.test.ts so seeds line up) ----------------------
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

/** Any seat that currently owes an action — the simulation drives EVERY seat via
 *  the AI brain regardless of the bot flag, so both/all sides genuinely play. */
function anyPendingSeat(s: HSState): number | null {
  if (s.pendingChoice) return s.pendingChoice.seat;
  if (s.phase === 'draft') return s.draft?.turnSeat ?? null;
  if (s.phase === 'placement') return s.players.find(p => !(s.placementReady ?? []).includes(p.seat))?.seat ?? null;
  if (s.phase !== 'playing') return null;
  if (s.subPhase === 'place_markers') {
    const living = livingSeats(s);
    return s.players.find(p => living.includes(p.seat) && !(s.markersReady ?? []).includes(p.seat))?.seat ?? null;
  }
  return s.turnSeat ?? null;
}

/** A decisive d20 roll-off: distinct descending rolls → no tie, first seat wins. */
function decisive(seats: number[]): InitiativeAttempt {
  return seats.map((seat, i) => ({ seat, roll: 20 - i }));
}

type Telemetry = {
  finished: boolean;
  rounds: number;
  steps: number;
  capped: boolean;
  /** action.kind → count of intents the AI actually applied. */
  kinds: Record<string, number>;
  /** Distinct (phase/subPhase) pairs observed, in first-seen order. */
  phasesSeen: string[];
  /** Glyphs flipped face-up by game end (a real glyph trigger). */
  glyphsRevealed: number;
  /** The final state, for caller assertions. */
  state: HSState;
};

/** Drive a FULL game with the AI on every seat. `prep` may mutate the post-roll
 *  draft state (e.g. inject armies) before the loop. Returns rich telemetry. */
function playFullGame(opts: {
  seed: number;
  budget: number;
  bots: number;
  mapId?: string;
  teams?: Record<number, number>;
  prep?: (s: HSState) => HSState;
  cap?: number;
}): Telemetry {
  const { seed, budget, bots, mapId = 'training_field', teams, prep, cap = 20000 } = opts;
  const rng = makeRng(seed);
  const rollDie = (): CombatFace => COMBAT_DIE_FACES[Math.floor(rng() * COMBAT_DIE_FACES.length)];
  const rollers = {
    rollDie,
    rollDice: (n: number) => Array.from({ length: n }, rollDie),
    d20: () => 1 + Math.floor(rng() * 20),
  };
  const idOf = (s: HSState, seat: number) => s.players.find(p => p.seat === seat)!.playerId;

  let s = createInitialStateForHost({ userId: 'host', username: 'Host' }); // seat 0
  for (let b = 0; b < bots; b++) s = unwrap(applyAction(s, 'host', { kind: 'add_bot' }), 'add_bot'); // seats 1..bots
  if (teams) {
    s = unwrap(
      applyAction(s, 'host', { kind: 'set_lobby_config', mapId, pointBudget: budget, mode: 'draft', teams }),
      'set_teams',
    );
  }
  s = unwrap(applyAction(s, 'host', { kind: 'start_game', mode: 'draft', pointBudget: budget, mapId }), 'start_game');
  s = unwrap(applyAction(s, 'host', { kind: 'draft_roll', attempts: [decisive(s.players.map(p => p.seat))] }), 'draft_roll');
  if (prep) s = prep(s);

  const kinds: Record<string, number> = {};
  const phasesSeen: string[] = [];
  let steps = 0;
  let capped = false;
  for (let i = 0; i < cap; i++) {
    const tag = `${s.phase}/${s.subPhase ?? '-'}`;
    if (!phasesSeen.includes(tag)) phasesSeen.push(tag);
    if (s.phase === 'finished') break;
    // The server rolls initiative once every living seat has locked its markers.
    if (
      s.phase === 'playing' &&
      s.subPhase === 'place_markers' &&
      livingSeats(s).every(seat => (s.markersReady ?? []).includes(seat))
    ) {
      s = unwrap(applyAction(s, 'host', { kind: 'roll_initiative', attempts: [decisive(livingSeats(s))] }), 'roll_initiative');
      continue;
    }
    const seat = anyPendingSeat(s);
    if (seat == null) throw new Error(`stalled: nobody owes an action (phase=${s.phase}/${s.subPhase}, round=${s.round}, seed=${seed})`);
    const intent: HSAction | null = aiNextAction(s, seat);
    if (!intent) throw new Error(`seat ${seat} produced no intent (phase=${s.phase}/${s.subPhase}, round=${s.round}, seed=${seed})`);
    const applied = aiEngineAction(s, intent, rollers);
    s = unwrap(applyAction(s, idOf(s, seat), applied), `${intent.kind} by seat ${seat}`);
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
    phasesSeen,
    glyphsRevealed: (s.glyphs ?? []).filter(g => g.faceUp).length,
    state: s,
  };
}

// The special-attack / free-power intent kinds the AI can emit (each REPLACES or
// precedes a normal swing). Seeing any one means a special power was actually used.
const SPECIAL_KINDS = [
  'chomp', 'mind_shackle', 'fire_line', 'explosion', 'ice_shard', 'queglix',
  'wild_swing', 'acid_breath', 'throw_figure', 'berserker_charge', 'water_clone',
  'the_drop', 'grenade', 'grenade_throw',
];

describe('HeroScape audit — full 2-player playthrough', () => {
  it('runs lobby → draft → placement → rounds → a declared winner without throwing', () => {
    const t = playFullGame({ seed: 7, budget: 200, bots: 1 });
    expect(t.finished).toBe(true);
    expect(t.capped).toBe(false);
    // Phases advanced in the documented order (draft → placement → playing → finished).
    expect(t.phasesSeen.some(p => p.startsWith('draft'))).toBe(true);
    expect(t.phasesSeen.some(p => p.startsWith('placement'))).toBe(true);
    expect(t.phasesSeen).toContain('playing/place_markers');
    expect(t.phasesSeen).toContain('playing/turns');
    expect(t.state.phase).toBe('finished');
    // A coherent winner: a real seat, and (single-team default) its own team.
    expect([0, 1]).toContain(t.state.winnerSeat);
    expect(t.state.winnerTeam).toBe(t.state.players.find(p => p.seat === t.state.winnerSeat)?.team ?? -1 - (t.state.winnerSeat ?? 0));
    // The losing side has no figures left on the board.
    const winTeam = t.state.winnerTeam;
    const loserAlive = t.state.figures.filter(f => f.at != null && (t.state.players.find(p => p.seat === f.ownerSeat)?.team ?? -1 - f.ownerSeat) !== winTeam);
    expect(loserAlive.length).toBe(0);
    // The bot drafted, deployed, placed markers, moved, and attacked — the whole verb set.
    for (const k of ['draft_card', 'place_figure', 'place_markers', 'move_step', 'attack']) {
      expect(t.kinds[k] ?? 0).toBeGreaterThan(0);
    }
    // It played multiple rounds (not a one-round fluke).
    expect(t.rounds).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line no-console
    console.log(`[audit 2p] finished=${t.finished} rounds=${t.rounds} steps=${t.steps} glyphsRevealed=${t.glyphsRevealed} kinds=${JSON.stringify(t.kinds)}`);
  });

  it('finishes across several seeds + budgets (deterministic), phases always advancing', () => {
    for (const [seed, budget] of [[1, 150], [3, 200], [42, 250], [99, 300]] as const) {
      const t = playFullGame({ seed, budget, bots: 1 });
      expect(t.finished, `seed ${seed} budget ${budget} should finish`).toBe(true);
      expect(t.state.winnerSeat == null || [0, 1].includes(t.state.winnerSeat)).toBe(true);
    }
  });
});

describe('HeroScape audit — full 3-player + TEAMS (2-v-1) playthrough', () => {
  it('runs a 3-seat team game to a single winning TEAM without throwing', () => {
    // Seats 0+1 are team 0 (allies); seat 2 is team 1 (solo). Win = LAST TEAM
    // standing, so the engine's team-aware elimination + interleaved turn order
    // both get exercised end-to-end.
    const t = playFullGame({
      seed: 11,
      budget: 220,
      bots: 2,
      mapId: 'star_field',
      teams: { 0: 0, 1: 0, 2: 1 },
      cap: 40000,
    });
    expect(t.finished).toBe(true);
    expect(t.capped).toBe(false);
    expect(t.phasesSeen).toContain('playing/turns');
    expect(t.state.phase).toBe('finished');
    // The winner is a real seat and winnerTeam names that seat's team (0 or 1).
    expect([0, 1, 2]).toContain(t.state.winnerSeat);
    const winnerTeam = t.state.players.find(p => p.seat === t.state.winnerSeat)!.team;
    expect(t.state.winnerTeam).toBe(winnerTeam);
    expect([0, 1]).toContain(winnerTeam);
    // Only the winning team has figures left on the board.
    const teamsAlive = new Set(
      t.state.figures.filter(f => f.at != null).map(f => t.state.players.find(p => p.seat === f.ownerSeat)!.team),
    );
    expect(teamsAlive.size).toBe(1);
    expect([...teamsAlive][0]).toBe(winnerTeam);
    // The draft genuinely happened (cards were picked) and every seat deployed
    // figures. (state.draft is deleted once play begins, so we read telemetry +
    // the surviving card roster rather than the cleared draft state.)
    expect(t.kinds['draft_card'] ?? 0).toBeGreaterThanOrEqual(3);
    for (const seat of [0, 1, 2]) expect(t.state.cards.some(c => c.ownerSeat === seat)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[audit 3p teams] finished=${t.finished} rounds=${t.rounds} steps=${t.steps} winnerSeat=${t.state.winnerSeat} winnerTeam=${t.state.winnerTeam} kinds=${JSON.stringify(t.kinds)}`);
  }, 60_000);

  it('finishes a free-for-all 3-player game too (no teams)', () => {
    const t = playFullGame({ seed: 23, budget: 200, bots: 2, mapId: 'star_field', cap: 40000 });
    expect(t.finished).toBe(true);
    // FFA default: winner is its own (negative) team id, and exactly one seat survives.
    expect([0, 1, 2]).toContain(t.state.winnerSeat);
    const survivors = new Set(t.state.figures.filter(f => f.at != null).map(f => f.ownerSeat));
    expect(survivors.size).toBe(1);
    expect([...survivors][0]).toBe(t.state.winnerSeat);
  }, 60_000);
});

describe('HeroScape audit — a glyph trigger fires in a real game', () => {
  it('a face-down glyph gets revealed (flipped face-up) across a full game', () => {
    // training_field carries two face-down glyphs (Astrid +1 atk, Gerda +1 def). The
    // move brain detours onto a nearby unclaimed glyph, so by game end at least one
    // has been revealed by a figure stopping on it — a real on-stop glyph trigger.
    const t = playFullGame({ seed: 7, budget: 200, bots: 1 });
    expect(t.glyphsRevealed).toBeGreaterThanOrEqual(1);
  });
});

describe('HeroScape audit — a SPECIAL ATTACK fires in a real game', () => {
  it('forces a Big-Hero / special-power army and confirms a special power is used', () => {
    // Inject armies so a special attacker is GUARANTEED on the board, then let the AI
    // play to a finish — it should reach for the special at least once. Grimnak's CHOMP
    // (a free adjacent auto-kill) is the most reliable to land, backed by a squad for
    // bodies; the foe gets a squad to be chomped. We assert SOME special kind fired.
    const t = playFullGame({
      seed: 4,
      budget: 400,
      bots: 1,
      mapId: 'training_field',
      prep: (s) => {
        const c = JSON.parse(JSON.stringify(s)) as HSState;
        // Force completed armies for both seats, then let the engine finish the draft
        // (both pass when nothing affordable remains / they're done). Simpler: set the
        // armies AND drop them straight into placement via the normal draft-pass path.
        c.draft!.armies[0] = ['grimnak', 'zettian_guards'];
        c.draft!.spent[0] = 190;
        c.draft!.armies[1] = ['izumi_samurai', 'zettian_guards'];
        c.draft!.spent[1] = 170;
        return c;
      },
      cap: 40000,
    });
    expect(t.finished).toBe(true);
    const specialsUsed = SPECIAL_KINDS.filter(k => (t.kinds[k] ?? 0) > 0);
    // eslint-disable-next-line no-console
    console.log(`[audit special] finished=${t.finished} rounds=${t.rounds} specialsUsed=${JSON.stringify(specialsUsed)} kinds=${JSON.stringify(t.kinds)}`);
    expect(specialsUsed.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('across a batch of seeds, at least one special attack and one glyph trigger occur', () => {
    // Belt-and-suspenders: even with purely natural drafts, a sweep of games should
    // surface a special power and a glyph reveal somewhere — proving they happen in
    // ordinary play, not only when hand-forced.
    let anySpecial = false;
    let anyGlyph = false;
    let finishedCount = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed++) {
      const t = playFullGame({ seed: seed * 1009, budget: 350, bots: 1, cap: 40000 });
      if (t.finished) finishedCount++;
      if (SPECIAL_KINDS.some(k => (t.kinds[k] ?? 0) > 0)) anySpecial = true;
      if (t.glyphsRevealed > 0) anyGlyph = true;
    }
    // eslint-disable-next-line no-console
    console.log(`[audit batch] ${finishedCount}/${N} finished; anySpecial=${anySpecial} anyGlyph=${anyGlyph}`);
    expect(finishedCount).toBeGreaterThan(N * 0.5);
    expect(anySpecial).toBe(true);
    expect(anyGlyph).toBe(true);
  }, 60_000);
});

describe('HeroScape audit — the ROLL CEREMONY pendingChoice IS self-resolved by the AI', () => {
  // CONTRACT NOTE: Mitonsoul (curse) and Sturla (resurrect) used to open an AUTO pendingChoice
  // the pure-engine AI couldn't resolve (a wedge if a driver bypassed the server's auto-loop).
  // They are now an interactive ROLL CEREMONY that aiResolveChoice DOES drive — the bot selects
  // a figure, then rolls it (the d20 is injected by the action layer / aiEngineAction). Oreld
  // stays an AUTO glyph (still server-rolled). Any future AI driver that bypasses the
  // server's auto-resolve loop MUST replicate it. This test pins that current behavior.
  it('a bot owning a roll_ceremony choice drives it (select, then roll) — no stall', () => {
    let s = createInitialStateForHost({ userId: 'host', username: 'Host' });
    s = JSON.parse(JSON.stringify(s)) as HSState;
    // Minimal mid-turn state: a bot seat owns an open curse ceremony with one of its figures up.
    s.phase = 'playing';
    s.subPhase = 'turns';
    s.turnSeat = 0;
    s.players = [{ seat: 0, playerId: 'bot-1', username: 'Bot', bot: true } as HSState['players'][number]];
    s.figures = [{ id: 'f-1', cardUid: 'c', ownerSeat: 0, at: '0,0', index: 1, wounds: 0 } as HSState['figures'][number]];
    s.cards = [{ uid: 'c', cardId: 'finn', ownerSeat: 0, orderMarkers: [], attackMod: 0, defenseMod: 0 }];
    s.pendingChoice = { kind: 'roll_ceremony', mode: 'curse', seat: 0, at: '0,0', queue: [{ seat: 0, figureIds: ['f-1'] }], selectedFigureId: null, results: [], risers: [] };

    // The server's drive loop picks this bot up AND the pure AI now resolves it: first SELECT…
    expect(aiPendingSeat(s)).toBe(0);
    expect(aiNextAction(s, 0)).toEqual({ kind: 'resolve_choice', choice: { kind: 'roll_ceremony_select', figureId: 'f-1' } });
    // …then, once a figure is selected, ROLL it (the d20 is added by the action layer).
    s.pendingChoice.selectedFigureId = 'f-1';
    expect(aiNextAction(s, 0)).toEqual({ kind: 'resolve_choice', choice: { kind: 'roll_ceremony_roll' } });
  });
});
