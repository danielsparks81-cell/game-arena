// HeroScape MULTIPLAYER + TEAMS (Phase 1) — regression tests for the clauses the
// 2..6-player / teams expansion introduces. Free-for-all is "everyone on their
// own team", so the whole engine.test.ts (all 1-v-1) is the FFA/2-player case and
// stays unchanged; these lock the new behaviour:
//   • win = last TEAM standing (a team wins with members to spare)
//   • allies never engage one another (no forced leaving-swipe between team-mates)
//   • the turn order interleaves teams (no back-to-back team-mate turns)
//   • team-mates draft from ONE shared per-team budget
//   • custom (non-preset) budgets, and ≥2 teams required to start
import { describe, it, expect } from 'vitest';
import {
  initialState,
  addPlayer,
  applyAction,
  attackDiceRequirements,
  moveConsequences,
  mapSupportsCount,
  placeableHexes,
} from './engine';
import { hexKey, offsetToAxial, neighborKeys } from './board';
import { MAPS } from './maps';
import { HS_CARDS, HS_DRAFT_POOL } from './content';
import type { CombatFace, HSResult, HSState, InitiativeAttempt, OrderMarkerValue } from './types';

const F = (spec: string): CombatFace[] =>
  [...spec].map(c => (c === 'k' ? 'skull' : c === 's' ? 'shield' : 'blank'));
const allOn = (cardUid: string): { marker: OrderMarkerValue; cardUid: string }[] =>
  (['1', '2', '3', 'X'] as const).map(marker => ({ marker, cardUid }));
const at = (col: number, row: number): string => {
  const { q, r } = offsetToAxial(col, row);
  return hexKey(q, r);
};

function unwrap(r: HSResult): HSState {
  if ('error' in r) throw new Error(`unexpected engine error: ${r.error}`);
  return r;
}
function errOf(r: HSResult): string {
  if (!('error' in r)) throw new Error('expected an engine error, got a state');
  return r.error;
}
function fig(s: HSState, id: string) {
  const f = s.figures.find(x => x.id === id);
  if (!f) throw new Error(`no figure ${id}`);
  return f;
}
function place(s: HSState, id: string, key: string | null): HSState {
  const c: HSState = JSON.parse(JSON.stringify(s));
  fig(c, id).at = key;
  return c;
}
function clearExcept(s: HSState, ...keep: string[]): HSState {
  const c: HSState = JSON.parse(JSON.stringify(s));
  const set = new Set(keep);
  for (const f of c.figures) if (!set.has(f.id)) f.at = null;
  return c;
}

/** Seat p1..pn into a fresh lobby. */
function lobbyN(n: number): HSState {
  let s = initialState();
  for (let seat = 0; seat < n; seat++) s = addPlayer(s, `p${seat + 1}`, `P${seat + 1}`, seat);
  return s;
}

/** N-seat battle staged into 'turns': armies[seat] = card ids, teams[seat] = team
 *  id (undefined ⇒ own team), `first` wins initiative. Figures land on distinct
 *  cells (tests reposition with `place`); glyph-free; all markers stacked on each
 *  seat's first card. */
function teamBattle(armies: string[][], teams?: (number | undefined)[], first = 0): HSState {
  const mapId = 'training_field';
  const n = armies.length;
  let s = lobbyN(n);
  const cellKeys = Object.keys(MAPS[mapId].cells);
  const cards: HSState['cards'] = [];
  const figures: HSState['figures'] = [];
  let cursor = 0;
  for (let seat = 0; seat < n; seat++) {
    for (const cardId of armies[seat]) {
      const def = HS_CARDS[cardId];
      const uid = `s${seat}-${cardId}`;
      cards.push({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
      for (let k = 1; k <= def.figures; k++) {
        figures.push({ id: `${uid}-${k}`, cardUid: uid, ownerSeat: seat, at: cellKeys[cursor++], index: k, wounds: 0 });
      }
    }
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
  s = c;
  for (let seat = 0; seat < n; seat++) {
    s = unwrap(applyAction(s, `p${seat + 1}`, { kind: 'place_markers', assignments: allOn(`s${seat}-${armies[seat][0]}`) }));
  }
  const attempt: InitiativeAttempt = Array.from({ length: n }, (_, seat) => ({ seat, roll: seat === first ? 20 : seat + 1 }));
  return unwrap(applyAction(s, 'p1', { kind: 'roll_initiative', attempts: [attempt] }));
}

describe('multiplayer: seating, teams, custom budget', () => {
  it('seats up to 6 players and starts a draft', () => {
    let s = lobbyN(6);
    expect(s.players).toHaveLength(6);
    s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 400, mapId: 'star_field' }));
    expect(s.phase).toBe('draft');
  });

  it('a battle needs at least two teams — not everyone on one colour', () => {
    let s = lobbyN(3);
    s = unwrap(applyAction(s, 'p1', { kind: 'set_lobby_config', teams: { 0: 0, 1: 0, 2: 0 } }));
    expect(errOf(applyAction(s, 'p1', { kind: 'start_game', mode: 'draft' }))).toMatch(/at least two teams/i);
    s = unwrap(applyAction(s, 'p1', { kind: 'set_lobby_config', teams: { 0: 0, 1: 0, 2: 1 } }));
    expect(unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'draft', mapId: 'star_field' })).phase).toBe('draft');
  });

  it('an UNASSIGNED (solo) player is a distinct side even when a team id equals their seat', () => {
    // Seats 0 & 2 → team id 1; seat 1 LEFT UNASSIGNED (a solo side). The solo seat
    // must NOT be read as "team 1" just because its seat number is 1 — that would
    // make a 3-way alliance with no enemy and wrongly block the start. It's a valid
    // 2-v-1, so the draft must begin. (Regression: teamOfSeat's solo fallback.)
    let s = lobbyN(3);
    s = unwrap(applyAction(s, 'p1', { kind: 'set_lobby_config', teams: { 0: 1, 2: 1 } }));
    expect(unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'draft', mapId: 'star_field' })).phase).toBe('draft');
  });

  it('quick (fixed-army) mode stays 2-player only', () => {
    expect(errOf(applyAction(lobbyN(3), 'p1', { kind: 'start_game', mode: 'quick' }))).toMatch(/2 players only/i);
  });

  it('accepts a custom (non-preset) budget and rejects out-of-range', () => {
    expect(unwrap(applyAction(lobbyN(2), 'p1', { kind: 'set_lobby_config', pointBudget: 175 })).pointBudget).toBe(175);
    expect(errOf(applyAction(lobbyN(2), 'p1', { kind: 'set_lobby_config', pointBudget: 10 }))).toMatch(/Budget must be/i);
  });
});

describe('multiplayer: win is last TEAM standing', () => {
  it('a team wins when the last rival team is wiped — even with a member untouched', () => {
    // seats 0 & 1 = team 0; seat 2 = team 1 (its only figure). p1 kills it →
    // team 1 gone → team 0 wins though p2 (seat 1) never fought.
    let s = teamBattle([['marro_warriors'], ['marro_warriors'], ['marro_warriors']], [0, 0, 1], 0);
    const ATTACKER = 's0-marro_warriors-1';
    const ALLY = 's1-marro_warriors-1';
    const TARGET = 's2-marro_warriors-1';
    s = clearExcept(s, ATTACKER, ALLY, TARGET);
    s = place(s, ATTACKER, at(3, 3));
    s = place(s, TARGET, at(3, 4)); // adjacent → in range of a Marro normal attack
    s = place(s, ALLY, at(0, 7)); // far away, uninvolved
    const req = attackDiceRequirements(s, ATTACKER, TARGET)!; // adjacent ⇒ non-null
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: ATTACKER,
        targetId: TARGET,
        attackRoll: F('k'.repeat(req.attack)),
        defenseRoll: F('b'.repeat(req.defense)),
      }),
    );
    expect(s.phase).toBe('finished');
    expect(s.winnerTeam).toBe(0);
    expect([0, 1]).toContain(s.winnerSeat); // a team-0 seat survives
    expect(fig(s, ALLY).at).not.toBeNull(); // …and the untouched ally is alive
  });
});

describe('multiplayer: allies do not engage one another', () => {
  it('moving away from a team-mate draws no leaving swipe; an enemy still does', () => {
    // seats 0 & 1 = team 0, seat 2 = team 1. A seat-0 figure flanked by a team-mate
    // and an enemy: leaving only abandons (provokes) the ENEMY.
    let s = teamBattle([['marro_warriors'], ['marro_warriors'], ['marro_warriors']], [0, 0, 1], 0);
    const MOVER = 's0-marro_warriors-1';
    const ALLY = 's1-marro_warriors-1';
    const ENEMY = 's2-marro_warriors-1';
    s = clearExcept(s, MOVER, ALLY, ENEMY);
    const center = at(3, 3);
    const cells = MAPS[s.mapId].cells;
    const nbrs = neighborKeys(center).filter(k => cells[k]);
    s = place(s, MOVER, center);
    s = place(s, ALLY, nbrs[0]);
    s = place(s, ENEMY, nbrs[1]);
    const cons = moveConsequences(s, fig(s, MOVER), at(3, 6)); // step well clear of both
    expect(cons.abandonedEnemyIds).toContain(ENEMY); // enemy swipes on the way out
    expect(cons.abandonedEnemyIds).not.toContain(ALLY); // team-mate never does
  });
});

describe('multiplayer: turn order interleaves teams', () => {
  it('team-mates do not act back-to-back — the turn skips to the next team', () => {
    // 4 players, seats {0,1}=team A, {2,3}=team B, seat 0 wins initiative. FFA
    // order would be 0,1,2,3 (both A first); dealt round-robin by team it is
    // 0,2,1,3 — A, B, A, B.
    const s = teamBattle(
      [['marro_warriors'], ['marro_warriors'], ['marro_warriors'], ['marro_warriors']],
      [0, 0, 1, 1],
      0,
    );
    expect(s.initiative).toEqual([0, 2, 1, 3]);
  });
});

describe('multiplayer: team-mates share one draft budget', () => {
  it('a per-team budget is shared across its players, not given to each', () => {
    // seats 0 & 1 = team 0; seat 2 = team 1. Team 0's budget affords the priciest
    // card OR the second, not both. p1 takes the priciest; p2 (same team) then
    // cannot afford the second — proving the pool is shared, not per-player.
    const byCost = [...HS_DRAFT_POOL].sort((a, b) => HS_CARDS[b].points - HS_CARDS[a].points);
    const c1 = byCost[0];
    const c2 = byCost[1];
    const teamBudget = HS_CARDS[c1].points + HS_CARDS[c2].points - 1;
    let s = lobbyN(3);
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'set_lobby_config',
        teams: { 0: 0, 1: 0, 2: 1 },
        teamBudgets: { 0: teamBudget, 1: 500 },
      }),
    );
    s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 200, mapId: 'star_field' }));
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'draft_roll',
        attempts: [[{ seat: 0, roll: 15 }, { seat: 1, roll: 10 }, { seat: 2, roll: 5 }]],
      }),
    );
    expect(s.draft!.turnSeat).toBe(0);
    s = unwrap(applyAction(s, 'p1', { kind: 'draft_card', cardId: c1 }));
    expect(s.draft!.turnSeat).toBe(1); // the team-mate is next in the cycle
    expect(errOf(applyAction(s, 'p2', { kind: 'draft_card', cardId: c2 }))).toMatch(/points left/i);
  });
});

describe('multiplayer: the 6-point star battlefield', () => {
  const star = MAPS['star_field'];
  const hexDist = (a: string, b: string): number => {
    const [q1, r1] = a.split(',').map(Number);
    const [q2, r2] = b.split(',').map(Number);
    const dq = q1 - q2, dr = r1 - r2;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  };

  it('exists with a roomy zone per seat for 3-6 players', () => {
    expect(star).toBeTruthy();
    for (const n of [3, 4, 5, 6]) {
      const z = star.zonesByCount![n];
      expect(Object.keys(z)).toHaveLength(n); // one start zone per seat
      for (let s = 0; s < n; s++) expect(z[s].length).toBeGreaterThan(12); // army room
    }
  });

  it('mapSupportsCount: the star supports every count 2-6, the rectangles are 2-only', () => {
    for (const n of [2, 3, 4, 5, 6]) expect(mapSupportsCount(star, n)).toBe(true);
    expect(mapSupportsCount(MAPS['training_field'], 2)).toBe(true);
    expect(mapSupportsCount(MAPS['training_field'], 4)).toBe(false);
  });

  it('start zones are ≥10 apart at 6 players — beyond Range 9, no turn-one sniping', () => {
    const z = star.zonesByCount![6];
    let min = Infinity;
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        for (const a of z[i]) for (const b of z[j]) min = Math.min(min, hexDist(a, b));
      }
    }
    expect(min).toBeGreaterThanOrEqual(10);
  });

  it('a 3-player game places onto three distinct, non-empty star zones', () => {
    const s = {
      version: 8,
      phase: 'placement',
      mapId: 'star_field',
      players: [
        { seat: 0, playerId: 'p1', username: 'A' },
        { seat: 1, playerId: 'p2', username: 'B' },
        { seat: 2, playerId: 'p3', username: 'C' },
      ],
      figures: [],
    } as unknown as HSState;
    const z0 = placeableHexes(s, 0), z1 = placeableHexes(s, 1), z2 = placeableHexes(s, 2);
    expect(z0.size).toBeGreaterThan(12);
    expect(z1.size).toBeGreaterThan(12);
    expect(z2.size).toBeGreaterThan(12);
    for (const k of z0) expect(z1.has(k) || z2.has(k)).toBe(false); // disjoint
  });
});

// Turn order passes around the PHYSICAL start-zone ring, not by seat index. The Star Field
// assigns seats to its 6 tips farthest-first (seat 0 & seat 1 sit on OPPOSITE tips), so a raw
// seat-index rotation zig-zags across the board. The fix orders by each zone's angle about centre.
describe('turn order follows the physical start-zone ring (Star Field)', () => {
  /** A star_field N-seat battle staged into 'turns', one figure per seat IN its real start zone. */
  function starTurns(n: number, first: number): HSState {
    let s = lobbyN(n);
    const star = MAPS['star_field'];
    const zonesFor = (seat: number) => star.zonesByCount![n][seat];
    const cards: HSState['cards'] = [];
    const figures: HSState['figures'] = [];
    for (let seat = 0; seat < n; seat++) {
      const uid = `s${seat}-tarn_vikings`;
      cards.push({ uid, cardId: 'tarn_vikings', ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
      // 3 Tarn figures, dropped onto the first hexes of this seat's zone.
      const zone = zonesFor(seat);
      for (let k = 1; k <= HS_CARDS['tarn_vikings'].figures; k++) {
        figures.push({ id: `${uid}-${k}`, cardUid: uid, ownerSeat: seat, at: zone[k - 1], index: k, wounds: 0 });
      }
    }
    const c: HSState = JSON.parse(JSON.stringify(s));
    c.phase = 'playing'; c.subPhase = 'place_markers'; c.mode = 'quick';
    c.round = 1; c.turnNumber = 1; c.cards = cards; c.figures = figures; c.glyphs = []; c.mapId = 'star_field';
    s = c;
    for (let seat = 0; seat < n; seat++) {
      s = unwrap(applyAction(s, `p${seat + 1}`, { kind: 'place_markers', assignments: allOn(`s${seat}-tarn_vikings`) }));
    }
    const attempt: InitiativeAttempt = Array.from({ length: n }, (_, seat) => ({ seat, roll: seat === first ? 20 : seat + 1 }));
    return unwrap(applyAction(s, 'p1', { kind: 'roll_initiative', attempts: [attempt] }));
  }

  /** The expected ring: seats sorted by the angle of their start-zone centroid about the centre. */
  function expectedRing(n: number): number[] {
    const star = MAPS['star_field'];
    const centroid = (seat: number) => {
      const zone = star.zonesByCount![n][seat];
      let x = 0, y = 0;
      for (const k of zone) { const [q, r] = k.split(',').map(Number); x += Math.sqrt(3) * (q + r / 2); y += 1.5 * r; }
      return { x: x / zone.length, y: y / zone.length };
    };
    const pts = Array.from({ length: n }, (_, seat) => ({ seat, c: centroid(seat) }));
    const cx = pts.reduce((a, p) => a + p.c.x, 0) / n;
    const cy = pts.reduce((a, p) => a + p.c.y, 0) / n;
    return pts.map(p => ({ seat: p.seat, a: Math.atan2(p.c.y - cy, p.c.x - cx) })).sort((p, q) => p.a - q.a).map(o => o.seat);
  }

  for (const n of [4, 6]) {
    it(`${n} players: order is the angular ring rotated to the winner, NOT seat order`, () => {
      const winner = 2;
      const s = starTurns(n, winner);
      const ring = expectedRing(n);
      const w = ring.indexOf(winner);
      const rotated = [...ring.slice(w), ...ring.slice(0, w)];
      expect(s.initiative).toEqual(rotated); // winner first, then AROUND the ring
      expect(s.initiative[0]).toBe(winner);
      // Consecutive players in the order sit on ADJACENT tips: every step's centre-angle gap is
      // small; the only big jump is the single wrap back to the winner. (Sanity vs seat-index zig-zag.)
      const naiveSeatRotation = Array.from({ length: n }, (_, i) => (winner + i) % n);
      if (JSON.stringify(ring) !== JSON.stringify(Array.from({ length: n }, (_, i) => i))) {
        expect(s.initiative).not.toEqual(naiveSeatRotation); // the fix actually changed the order
      }
    });
  }
});
