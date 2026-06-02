import { describe, it, expect } from 'vitest';
import { initialState, addPlayer, applyAction } from './engine';
import type { HQState } from './types';

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

describe('heroquest movement: pass through friendly figures', () => {
  it('lets a boxed-in hero move past a friendly hero to an empty square', () => {
    const s = corridorSetup();
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 5, y: 4 } }));
    expect(out.heroes[0].at).toEqual({ x: 5, y: 4 });
    expect(out.heroes[0].moveLeft).toBe(6 - 3); // 3 squares travelled
  });

  it('cannot end its move on a square occupied by a friendly hero', () => {
    const s = corridorSetup();
    const res = applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 4 } });
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
    // The only corridor route to (6,4) passes through the monster at (4,4).
    const res = applyAction(s, 'p1', { kind: 'move_to', at: { x: 6, y: 4 } });
    expect(res.ok).toBe(false);
  });
});
