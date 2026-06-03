import { describe, it, expect } from 'vitest';
import { initialState, addPlayer, applyAction } from './engine';
import { QUEST1 } from './content';
import type { HQState } from './types';

const QUEST1_STAIRS = QUEST1.startCells;

// Movement is path-based: a hero may move to any square within their movement
// roll, passing THROUGH friendly heroes but never ending on an occupied square.

function unwrap(r: ReturnType<typeof applyAction>): HQState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function startedGame(): HQState {
  let s = initialState();
  s = addPlayer(s, 'p1', 'Player One', 0);
  s = unwrap(applyAction(s, 'p1', { kind: 'start_game' }));
  return s;
}

/** A clear east–west floor corridor on row y, with heroes 0 & 1 placed so that
 *  hero 0 (active) is boxed in behind hero 1. */
function corridorSetup(): HQState {
  const s: HQState = JSON.parse(JSON.stringify(startedGame()));
  // Clear the quest's furniture/monsters so the hand-built test corridor is empty.
  s.furniture = [];
  s.monsters = [];
  const y = 4;
  // A one-tile-wide corridor walled off above and below + capped at both ends,
  // so the only route between its cells runs straight along row y.
  for (let x = 1; x <= 8; x++) {
    s.tiles[y - 1][x] = { kind: 'wall', region: 'corridor', revealed: true };
    s.tiles[y + 1][x] = { kind: 'wall', region: 'corridor', revealed: true };
  }
  s.tiles[y][1] = { kind: 'wall', region: 'corridor', revealed: true };
  s.tiles[y][8] = { kind: 'wall', region: 'corridor', revealed: true };
  for (let x = 2; x <= 7; x++) {
    s.tiles[y][x] = { kind: 'floor', region: 'room_test', revealed: true };
  }
  // Park the two non-involved heroes far away so they don't sit on the path.
  s.heroes[2].at = { x: 0, y: 0 };
  s.heroes[3].at = { x: 0, y: 1 };
  s.heroes[0].at = { x: 2, y };   // active hero, in the "back"
  s.heroes[1].at = { x: 3, y };   // friendly hero blocking the only exit
  s.turnIndex = 0;
  const h = s.heroes[0];
  h.hasRolled = true;
  h.moveRolled = 6;
  h.moveLeft = 6;
  return s;
}

describe('heroquest movement: path-based, pass over friendly heroes', () => {
  it('lets a boxed-in hero move past a friendly hero to an empty square', () => {
    const s = corridorSetup();
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 5, y: 4 } }));
    expect(out.heroes[0].at).toEqual({ x: 5, y: 4 });
    expect(out.heroes[0].moveLeft).toBe(6 - 3); // 3 squares travelled (through the friendly)
  });

  it('cannot END its move on a square occupied by a friendly hero', () => {
    const s = corridorSetup();
    const res = applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 4 } });
    expect(res.ok).toBe(false);
  });

  it('rejects a diagonal destination (no clear orthogonal path)', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    // Only the corridor row is floor, so (3,5) is walled — but even with a single
    // open diagonal cell there is no orthogonal one-square route to it.
    s.tiles[5][2] = { kind: 'floor', region: 'room_test', revealed: true };
    const res = applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 5 } });
    expect(res.ok).toBe(false);
  });

  it('rejects a destination beyond the movement allowance', () => {
    const s = corridorSetup();
    s.heroes[0].moveLeft = 2;
    const res = applyAction(s, 'p1', { kind: 'move_to', at: { x: 6, y: 4 } }); // 4 away
    expect(res.ok).toBe(false);
  });

  it('still blocks paths that run through a monster', () => {
    const s = corridorSetup();
    s.monsters = [{
      id: 'block', kind: 'orc', at: { x: 4, y: 4 }, body: 1, bodyMax: 1,
      attack: 3, defense: 2, move: 6, roomId: 'room_test',
    }];
    const res = applyAction(s, 'p1', { kind: 'move_to', at: { x: 6, y: 4 } });
    expect(res.ok).toBe(false);
  });

  it('a pit trap mid-path springs and stops the hero ON the trap square', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 }; // clear the corridor
    s.traps = [{ id: 'pit1', kind: 'pit', at: { x: 4, y: 4 }, triggered: false, revealed: false }];
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 6, y: 4 } }));
    expect(out.heroes[0].at).toEqual({ x: 4, y: 4 }); // stopped on the pit, not at (6,4)
    expect(out.heroes[0].inPit).toBe(true);
    expect(out.heroes[0].moveLeft).toBe(0);
  });
});

describe('heroquest: move-then-act vs act-then-move rule', () => {
  it('move-then-act forfeits the remaining movement', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 }; // clear the corridor
    let g = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 4 } }));
    expect(g.heroes[0].moveLeft).toBe(5); // moved one square
    g = unwrap(applyAction(g, 'p1', { kind: 'search_traps' }));
    expect(g.heroes[0].hasActed).toBe(true);
    expect(g.heroes[0].moveLeft).toBe(0); // can't finish moving after acting
  });

  it('act-then-move keeps the full movement allowance', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    let g = unwrap(applyAction(s, 'p1', { kind: 'search_traps' }));
    expect(g.heroes[0].hasActed).toBe(true);
    expect(g.heroes[0].moveLeft).toBe(6); // acted before moving → full move intact
    g = unwrap(applyAction(g, 'p1', { kind: 'move_to', at: { x: 3, y: 4 } }));
    expect(g.heroes[0].at).toEqual({ x: 3, y: 4 });
  });
});

describe('heroquest doors: edge doors block until opened', () => {
  it('a closed door blocks the crossing; opening it from the doorway lets you through', () => {
    let s = startedGame();
    const door = QUEST1.doors[0];
    const cross = door.crossings[0];
    s = JSON.parse(JSON.stringify(s));
    // Park other heroes; stand hero 0 on the corridor side of the door.
    s.heroes[1].at = { x: 28, y: 1 };
    s.heroes[2].at = { x: 29, y: 1 };
    s.heroes[3].at = { x: 30, y: 1 };
    s.heroes[0].at = { ...cross.b };
    s.heroes[0].hasRolled = true;
    s.heroes[0].moveLeft = 6;
    s.turnIndex = 0;

    // Closed door → the room cell across the wall is unreachable.
    const blocked = applyAction(s, 'p1', { kind: 'move_to', at: { ...cross.a } });
    expect(blocked.ok).toBe(false);

    // Open it (the hero is standing in the doorway).
    s = unwrap(applyAction(s, 'p1', { kind: 'open_door', doorId: door.id }));
    expect(s.doors.find(d => d.id === door.id)!.open).toBe(true);

    // Clear any monsters the reveal spawned, then cross the now-open doorway.
    s.monsters = [];
    s.heroes[0].hasRolled = true;
    s.heroes[0].moveLeft = 6;
    const ok = applyAction(s, 'p1', { kind: 'move_to', at: { ...cross.a } });
    expect(ok.ok).toBe(true);
  });
});

describe('heroquest: monsters spawn when a room is revealed', () => {
  it("spawns a room's monsters the moment a hero first sees into it", () => {
    let s = startedGame();
    // Verag is far from the entry, so he isn't on the board yet.
    expect(s.monsters.some(m => m.displayName === 'Verag')).toBe(false);
    // Drop hero 0 into Verag's central chamber and take one step so LOS reveals it.
    s = JSON.parse(JSON.stringify(s));
    s.heroes[1].at = { x: 28, y: 1 };
    s.heroes[2].at = { x: 29, y: 1 };
    s.heroes[3].at = { x: 30, y: 1 };
    s.heroes[0].at = { x: 14, y: 11 };
    s.heroes[0].hasRolled = true;
    s.heroes[0].moveLeft = 6;
    s.turnIndex = 0;
    s = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 15, y: 11 } }));
    expect(s.monsters.some(m => m.displayName === 'Verag')).toBe(true);
  });
});

describe('heroquest win condition: kill-and-exit gating', () => {
  // Two adjacent staircase tiles from the live board.
  const STAIR_A = QUEST1_STAIRS[0];
  const STAIR_B = QUEST1_STAIRS.find(c => Math.abs(c.x - STAIR_A.x) + Math.abs(c.y - STAIR_A.y) === 1)!;

  // Move the three non-test heroes off the staircase so hero 0 can step
  // between stair tiles without colliding with a teammate.
  function soloOnStairs(objectiveDefeated: boolean): HQState {
    const s: HQState = JSON.parse(JSON.stringify(startedGame()));
    s.heroes[1].at = { x: 28, y: 1 };
    s.heroes[2].at = { x: 29, y: 1 };
    s.heroes[3].at = { x: 30, y: 1 };
    s.heroes[0].at = { ...STAIR_A };
    s.heroes[0].hasRolled = true;
    s.heroes[0].moveLeft = 6;
    s.turnIndex = 0;
    if (objectiveDefeated) s.objectiveDefeated = true;
    return s;
  }

  it('does NOT win when a hero moves on the staircase before Verag is slain', () => {
    // Verag lazy-spawns later (absent from state.monsters at start), so moving
    // onto a stair tile must NOT be mistaken for a completed quest.
    const s = soloOnStairs(false);
    expect(s.objectiveDefeated).toBeFalsy();
    const next = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { ...STAIR_B } }));
    expect(next.phase).toBe('heroes');
    expect(next.winner).toBeNull();
  });

  it('wins once the objective is defeated and a hero reaches the stairs', () => {
    const s = soloOnStairs(true);
    const next = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { ...STAIR_B } }));
    expect(next.phase).toBe('finished');
    expect(next.winner).toBe('heroes');
  });
});
