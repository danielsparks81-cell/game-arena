import { describe, it, expect, vi, afterEach } from 'vitest';
import { initialState, addPlayer, applyAction } from './engine';
import { QUEST1, TOOL_KIT } from './content';
import type { HQState } from './types';

const QUEST1_STAIRS = QUEST1.startCells;

// Movement is path-based: a hero may move to any square within their movement
// roll, passing THROUGH friendly heroes but never ending on an occupied square.

function unwrap(r: ReturnType<typeof applyAction>): HQState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function startedGame(): HQState {
  // These tests assert QUEST1 ("the_trial") geometry — Verag, the entrance
  // staircase and its doors. start_game from a fresh lobby loads CAMPAIGN[0] (the
  // tutorial "The Vault"), so we use the 'finished'-retry path, which honours
  // state.questId, to load the_trial directly. p1 then owns all four heroes.
  let s = initialState('the_trial');
  s = addPlayer(s, 'p1', 'Player One', 0);
  s = JSON.parse(JSON.stringify(s));
  s.phase = 'finished';
  s.questId = 'the_trial';
  s = unwrap(applyAction(s, 'p1', { kind: 'start_game' }));
  // start_game then opens a pre-quest spell draft (Wizard then Elf pick a school);
  // resolve it to reach the heroes' turn. Schools don't matter for movement tests.
  if (s.phase === 'spell_draft') s = unwrap(applyAction(s, 'p1', { kind: 'pick_spell_school', school: 'air' }));
  if (s.phase === 'spell_draft') s = unwrap(applyAction(s, 'p1', { kind: 'pick_spell_school', school: 'water' }));
  return s;
}

/** Zargon now plays one monster per zargon_step (host-ticked). Drain the whole
 *  turn so tests can assert the end-of-Zargon state. */
function drainZargon(s: HQState): HQState {
  let g = s;
  for (let i = 0; i < 200 && g.phase === 'zargon'; i++) g = unwrap(applyAction(g, 'p1', { kind: 'zargon_step' }));
  return g;
}

/** A clear east–west floor corridor on row y, with heroes 0 & 1 placed so that
 *  hero 0 (active) is boxed in behind hero 1. */
function corridorSetup(): HQState {
  const s: HQState = JSON.parse(JSON.stringify(startedGame()));
  // Clear the quest's furniture/monsters so the hand-built test corridor is empty.
  s.furniture = [];
  s.monsters = [];
  // Reset all reveals so moving in the test strip doesn't re-reveal a real room
  // (which would re-spawn its monsters and trip the look-and-stop interrupt).
  for (const row of s.tiles) for (const t of row) t.revealed = false;
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
    s.tiles[y][x] = { kind: 'floor', region: 'corridor', revealed: true };
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

describe('heroquest: drag movement (move_path)', () => {
  it('walks the full traced path when nothing interrupts', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    const path = [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }];
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_path', path }));
    expect(out.heroes[0].at).toEqual({ x: 5, y: 4 });
    expect(out.heroes[0].moveLeft).toBe(3); // 6 - 3
  });

  it('stops on a pit trap partway down the traced path', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    s.traps = [{ id: 'pit1', kind: 'pit', at: { x: 4, y: 4 }, triggered: false, revealed: false }];
    const path = [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }];
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_path', path }));
    expect(out.heroes[0].at).toEqual({ x: 4, y: 4 }); // stopped on the pit
    expect(out.heroes[0].inPit).toBe(true);
    expect(out.heroes[0].moveLeft).toBe(0);
  });
});

describe('heroquest traps: faithful spring effects (rulebook pp.17–18)', () => {
  afterEach(() => vi.restoreAllMocks());
  // DIE_FACES = [skull,skull,skull,white_shield,white_shield,black_shield].
  // Math.random→0 picks index 0 (skull); →0.9 picks index 5 (black_shield).
  const forceSkulls = () => vi.spyOn(Math, 'random').mockReturnValue(0);
  const forceShields = () => vi.spyOn(Math, 'random').mockReturnValue(0.9);

  it('falling block seals the square forever and bounces the hero back', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    s.traps = [{ id: 'fb', kind: 'falling_block', at: { x: 4, y: 4 }, triggered: false, revealed: false }];
    forceShields(); // 0 skulls → no damage, clean position assertions
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 6, y: 4 } }));
    expect(out.heroes[0].at).toEqual({ x: 3, y: 4 });  // fell back to the square before the trap
    expect(out.tiles[4][4].kind).toBe('blocked');      // permanent wall
    expect(out.heroes[0].body).toBe(8);                // no skulls rolled
    expect(out.heroes[0].moveLeft).toBe(0);            // turn ends
  });

  it('falling block deals 1 BP per skull (3 dice, no defence)', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    s.traps = [{ id: 'fb', kind: 'falling_block', at: { x: 4, y: 4 }, triggered: false, revealed: false }];
    forceSkulls(); // 3 skulls → -3 BP
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 6, y: 4 } }));
    expect(out.heroes[0].body).toBe(5);
    expect(out.tiles[4][4].kind).toBe('blocked');
  });

  it('a dodged spear deals no damage and the hero keeps moving', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    s.traps = [{ id: 'sp', kind: 'spear', at: { x: 4, y: 4 }, triggered: false, revealed: false }];
    forceShields(); // shield → dodge
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 6, y: 4 } }));
    expect(out.heroes[0].at).toEqual({ x: 6, y: 4 }); // continued to the destination
    expect(out.heroes[0].body).toBe(8);               // unharmed
    expect(out.traps[0].triggered).toBe(true);        // the spear is spent
  });

  it('a struck spear deals 1 BP and ends the move on the trap square', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    s.traps = [{ id: 'sp', kind: 'spear', at: { x: 4, y: 4 }, triggered: false, revealed: false }];
    forceSkulls(); // skull → struck
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 6, y: 4 } }));
    expect(out.heroes[0].at).toEqual({ x: 4, y: 4 });
    expect(out.heroes[0].body).toBe(7);
    expect(out.heroes[0].moveLeft).toBe(0);
  });

  it('fighting from a pit rolls one fewer attack die (min 1)', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    s.heroes[0].inPit = true;
    s.monsters = [{
      id: 'm', kind: 'orc', at: { x: 3, y: 4 }, body: 1, bodyMax: 1,
      attack: 3, defense: 2, move: 6, roomId: 'corridor',
    }];
    forceShields();
    const out = unwrap(applyAction(s, 'p1', { kind: 'attack', monsterId: 'm' }));
    expect(out.lastRoll?.faces.length).toBe(2); // barbarian attack 3 − 1 (in pit)
  });
});

describe('heroquest disarm: faithful odds (rulebook pp.19–20)', () => {
  afterEach(() => vi.restoreAllMocks());
  const forceSkulls = () => vi.spyOn(Math, 'random').mockReturnValue(0);
  const forceBlackShield = () => vi.spyOn(Math, 'random').mockReturnValue(0.9);

  /** Active `seat` hero stands at (4,4) next to a revealed trap at (5,4). */
  function disarmSetup(seat: number): HQState {
    const s = corridorSetup();
    s.heroes.forEach((h, i) => { if (i !== seat) h.at = { x: i, y: 0 }; });
    s.turnIndex = seat;
    s.heroes[seat].at = { x: 4, y: 4 };
    s.heroes[seat].hasActed = false;
    s.traps = [{ id: 't', kind: 'pit', at: { x: 5, y: 4 }, triggered: false, revealed: true }];
    return s;
  }

  it('the Dwarf disarms on a skull (only a black shield springs it)', () => {
    const s = disarmSetup(1); // seat 1 = dwarf, body 7
    forceSkulls();
    const out = unwrap(applyAction(s, 'p1', { kind: 'disarm_trap', trapId: 't' }));
    expect(out.traps[0].triggered).toBe(true);
    expect(out.heroes[1].body).toBe(7); // disarmed, unharmed
  });

  it('the Dwarf springs the trap only on a black shield', () => {
    const s = disarmSetup(1);
    forceBlackShield();
    const out = unwrap(applyAction(s, 'p1', { kind: 'disarm_trap', trapId: 't' }));
    expect(out.heroes[1].body).toBe(6); // -1 BP
  });

  it('a non-Dwarf without a Tool Kit cannot disarm', () => {
    const s = disarmSetup(0); // seat 0 = barbarian, no kit
    const res = applyAction(s, 'p1', { kind: 'disarm_trap', trapId: 't' });
    expect(res.ok).toBe(false);
  });

  it('a non-Dwarf with a Tool Kit disarms on a shield', () => {
    const s = disarmSetup(0);
    s.heroes[0].items.push({ ...TOOL_KIT });
    forceBlackShield(); // shield → success for non-dwarf
    const out = unwrap(applyAction(s, 'p1', { kind: 'disarm_trap', trapId: 't' }));
    expect(out.traps[0].triggered).toBe(true);
    expect(out.heroes[0].body).toBe(8); // unharmed
  });

  it('a non-Dwarf with a Tool Kit springs the trap on a skull', () => {
    const s = disarmSetup(0);
    s.heroes[0].items.push({ ...TOOL_KIT });
    forceSkulls();
    const out = unwrap(applyAction(s, 'p1', { kind: 'disarm_trap', trapId: 't' }));
    expect(out.heroes[0].body).toBe(7); // -1 BP
  });
});

describe('heroquest monsters: melee attacks (orthogonal + diagonal house rule)', () => {
  afterEach(() => vi.restoreAllMocks());
  const forceShields = () => vi.spyOn(Math, 'random').mockReturnValue(0.9);

  /** Open floor room x∈[3,7], y∈[2,6]; only hero 0 alive so one end_turn runs
   *  Zargon. Returns state with hero 0 placed by the caller. */
  function zargonSetup(): HQState {
    const s: HQState = JSON.parse(JSON.stringify(startedGame()));
    s.furniture = [];
    s.monsters = [];
    for (const row of s.tiles) for (const t of row) t.revealed = false;
    for (let y = 2; y <= 6; y++) for (let x = 3; x <= 7; x++) {
      s.tiles[y][x] = { kind: 'floor', region: 'corridor', revealed: true };
    }
    // Only hero 0 lives → ending its turn wraps to Zargon immediately.
    s.heroes[1].body = 0; s.heroes[1].at = { x: 0, y: 0 };
    s.heroes[2].body = 0; s.heroes[2].at = { x: 0, y: 1 };
    s.heroes[3].body = 0; s.heroes[3].at = { x: 0, y: 2 };
    s.turnIndex = 0;
    return s;
  }

  it('a monster already orthogonally adjacent strikes from its square', () => {
    const s = zargonSetup();
    s.heroes[0].at = { x: 5, y: 4 };
    s.monsters = [{
      id: 'm', kind: 'orc', at: { x: 4, y: 4 }, body: 1, bodyMax: 1,
      attack: 3, defense: 2, move: 6, roomId: 'corridor',
    }];
    forceShields();
    const out = drainZargon(unwrap(applyAction(s, 'p1', { kind: 'end_turn' })));
    expect(out.monsters[0].at).toEqual({ x: 4, y: 4 }); // did NOT dance to a diagonal
    expect(out.lastRoll?.rolledBy).toBe('monster');      // it attacked
    expect(out.lastRoll?.faces.length).toBe(3);          // m.attack dice
  });

  it('a monster diagonally adjacent to a hero attacks (house rule: monsters strike diagonally)', () => {
    const s = zargonSetup();
    s.heroes[0].at = { x: 5, y: 4 };
    s.monsters = [{
      id: 'm', kind: 'orc', at: { x: 4, y: 3 }, body: 1, bodyMax: 1, // diagonal to the hero
      attack: 3, defense: 2, move: 6, roomId: 'corridor',
    }];
    forceShields();
    const out = drainZargon(unwrap(applyAction(s, 'p1', { kind: 'end_turn' })));
    expect(out.monsters[0].at).toEqual({ x: 4, y: 3 }); // already adjacent → strikes from its square
    expect(out.lastRoll?.rolledBy).toBe('monster');      // it attacked diagonally
  });
});

describe('heroquest: jumping a discovered trap (rulebook p.19)', () => {
  afterEach(() => vi.restoreAllMocks());
  const forceSkulls = () => vi.spyOn(Math, 'random').mockReturnValue(0);
  const forceShields = () => vi.spyOn(Math, 'random').mockReturnValue(0.9);

  /** Hero 0 at (3,4) next to a revealed trap at (4,4), landing clear at (5,4). */
  function jumpSetup(): HQState {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    s.heroes[0].at = { x: 3, y: 4 };
    s.traps = [{ id: 't', kind: 'pit', at: { x: 4, y: 4 }, triggered: false, revealed: true }];
    return s;
  }

  it('a shield clears the trap: land beyond, spend 2 squares, no action used', () => {
    const s = jumpSetup();
    forceShields();
    const out = unwrap(applyAction(s, 'p1', { kind: 'jump_trap', trapId: 't' }));
    expect(out.heroes[0].at).toEqual({ x: 5, y: 4 }); // landed past the trap
    expect(out.heroes[0].moveLeft).toBe(4);            // 6 − 2
    expect(out.traps[0].triggered).toBe(false);        // jumped over, still armed
    expect(out.heroes[0].hasActed).toBe(false);        // jumping is movement, not an action
    expect(out.heroes[0].body).toBe(8);
  });

  it('a skull springs the trap mid-leap', () => {
    const s = jumpSetup();
    forceSkulls();
    const out = unwrap(applyAction(s, 'p1', { kind: 'jump_trap', trapId: 't' }));
    expect(out.heroes[0].at).toEqual({ x: 4, y: 4 }); // dropped into the pit
    expect(out.heroes[0].inPit).toBe(true);
    expect(out.heroes[0].body).toBe(7);
    expect(out.heroes[0].moveLeft).toBe(0);
    expect(out.traps[0].triggered).toBe(true);
  });

  it('needs at least 2 squares of movement', () => {
    const s = jumpSetup();
    s.heroes[0].moveLeft = 1;
    expect(applyAction(s, 'p1', { kind: 'jump_trap', trapId: 't' }).ok).toBe(false);
  });

  it('cannot jump when the landing square is a wall', () => {
    const s = jumpSetup();
    s.tiles[4][5] = { kind: 'wall', region: 'corridor', revealed: true };
    expect(applyAction(s, 'p1', { kind: 'jump_trap', trapId: 't' }).ok).toBe(false);
  });

  it('cannot jump a trap that has not been discovered', () => {
    const s = jumpSetup();
    s.traps[0].revealed = false;
    expect(applyAction(s, 'p1', { kind: 'jump_trap', trapId: 't' }).ok).toBe(false);
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

  it('act-then-move: acting BEFORE rolling lets you roll and move after', () => {
    const s = corridorSetup();
    s.heroes[1].at = { x: 7, y: 4 };
    // Hasn't committed to moving yet (no roll), so acting first is allowed.
    s.heroes[0].hasRolled = false; s.heroes[0].moveRolled = 0; s.heroes[0].moveLeft = 0;
    let g = unwrap(applyAction(s, 'p1', { kind: 'search_traps' }));
    expect(g.heroes[0].hasActed).toBe(true);
    expect(g.heroes[0].moveLeft).toBe(0); // not rolled yet
    g = unwrap(applyAction(g, 'p1', { kind: 'roll_move' })); // can still roll after acting
    expect(g.heroes[0].moveLeft).toBeGreaterThan(0);
    g = unwrap(applyAction(g, 'p1', { kind: 'move_to', at: { x: 3, y: 4 } }));
    expect(g.heroes[0].at).toEqual({ x: 3, y: 4 });
  });

  it('rolling then acting WITHOUT moving forfeits the movement', () => {
    const s = corridorSetup(); // sets hasRolled + moveLeft = 6
    s.heroes[1].at = { x: 7, y: 4 };
    const g = unwrap(applyAction(s, 'p1', { kind: 'search_traps' }));
    expect(g.heroes[0].hasActed).toBe(true);
    expect(g.heroes[0].moveLeft).toBe(0); // committed to move by rolling, then acted → forfeit
  });
});

describe('heroquest doors: edge doors block until opened', () => {
  it('a closed door blocks the crossing; opening it from the doorway lets you through', () => {
    let s = startedGame();
    const door = QUEST1.doors[0];
    const cross = door.crossings[0];
    s = JSON.parse(JSON.stringify(s));
    // Park other heroes; stand hero 0 on the corridor side of the door.
    s.heroes[1].at = { x: 29, y: 1 };
    s.heroes[2].at = { x: 29, y: 2 };
    s.heroes[3].at = { x: 29, y: 3 };
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
    s.heroes[1].at = { x: 1, y: 20 };
    s.heroes[2].at = { x: 0, y: 19 };
    s.heroes[3].at = { x: 0, y: 18 };
    s.heroes[0].at = { x: 12, y: 12 };  // inside Verag's chamber 'e' (not yet revealed)
    s.heroes[0].hasRolled = true;
    s.heroes[0].moveLeft = 6;
    s.turnIndex = 0;
    s = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 12, y: 13 } })); // a step reveals 'e'
    expect(s.monsters.some(m => m.displayName === 'Verag')).toBe(true);
  });
});

describe('heroquest Quest 1 content fidelity (vs the Quest Book)', () => {
  it('uses the Orc as the wandering monster', () => {
    expect(QUEST1.wanderingMonster).toBe('orc');
  });

  it('has a mummy guardian that rolls 4 Attack dice (note C)', () => {
    const guardian = QUEST1.monsters.find(m => m.kind === 'mummy' && !!m.displayName);
    expect(guardian).toBeDefined();
    expect(guardian!.attack).toBe(4);
  });

  it('fields goblins AND orcs plus Verag the gargoyle', () => {
    const kinds = new Set(QUEST1.monsters.map(m => m.kind));
    expect(kinds.has('goblin')).toBe(true);
    expect(kinds.has('orc')).toBe(true);
    expect(QUEST1.monsters.some(m => m.displayName === 'Verag' && m.kind === 'gargoyle')).toBe(true);
  });

  it('has an empty chest (B), an 84-gold chest (D), a 120-gold chest (E), and a useless weapons rack (A)', () => {
    const gold = QUEST1.furniture
      .filter(f => f.fixedContent?.kind === 'gold')
      .map(f => (f.fixedContent as { kind: 'gold'; amount: number }).amount)
      .sort((a, b) => a - b);
    expect(gold).toEqual([84, 120]);
    const empties = QUEST1.furniture.filter(f => f.fixedContent?.kind === 'nothing');
    expect(empties.some(f => f.kind === 'chest')).toBe(true);   // empty chest (B)
    expect(empties.some(f => f.kind === 'weapon_rack')).toBe(true);    // useless weapons rack (A)
  });

  it('has no traps or secret doors (Zargon says so)', () => {
    expect(QUEST1.traps.length).toBe(0);
    expect(QUEST1.doors.every(d => !d.secret)).toBe(true);
  });

  it('starts the heroes INSIDE an enclosed entrance room (not bare corridor)', () => {
    const s = startedGame();
    for (const start of QUEST1.startCells) {
      const t = s.tiles[start.y][start.x];
      expect(t.kind).toBe('stairs');                 // still a start/exit tile
      expect(t.region.startsWith('room_')).toBe(true); // but now part of a room
    }
    // The entrance room is revealed from turn 1 (heroes stand in it).
    expect(s.tiles[QUEST1.startCells[0].y][QUEST1.startCells[0].x].revealed).toBe(true);
  });
});

describe('heroquest win condition: escape (all heroes reach the stairs)', () => {
  it('wins once the LAST hero leaves via the stairway (two-step exit)', () => {
    let s = startedGame();
    s = JSON.parse(JSON.stringify(s));
    s.quest.winCondition = { kind: 'escape' };
    // The other three heroes have already escaped and left the board; hero 0 is
    // the last, standing in the entrance room next to the stairs.
    for (const i of [1, 2, 3]) { s.heroes[i].at = { x: 29, y: i }; s.heroes[i].escaped = true; }
    s.heroes[0].at = { x: 4, y: 17 };
    s.heroes[0].hasRolled = true;
    s.heroes[0].moveLeft = 6;
    s.turnIndex = 0;
    // Stepping onto the stairway raises the exit prompt — NOT an instant win.
    let out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 17 } }));
    expect(out.pendingPrompt?.kind).toBe('exit_dungeon');
    expect(out.phase).toBe('heroes');
    // Confirming sends the last hero out → every hero is clear → quest won. The win
    // routes through the Armory intermission before the campaign advances.
    out = unwrap(applyAction(out, 'p1', { kind: 'exit_dungeon', confirm: true }));
    expect(out.winner).toBe('heroes');
    expect(out.phase).toBe('intermission');
  });

  it('does NOT win while a living hero is still off the stairs', () => {
    let s = startedGame();
    s = JSON.parse(JSON.stringify(s));
    s.quest.winCondition = { kind: 'escape' };
    s.heroes[0].at = { x: 2, y: 17 };  // on stairs
    s.heroes[1].at = { x: 3, y: 17 };  // on stairs
    s.heroes[2].at = { x: 2, y: 18 };  // on stairs
    s.heroes[3].at = { x: 4, y: 17 };  // in the entrance room but NOT on a stair
    s.heroes[3].hasRolled = true;
    s.heroes[3].moveLeft = 2;
    s.turnIndex = 3;
    // A move that stays OFF the stairs must not complete the escape.
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 5, y: 17 } }));
    expect(out.phase).not.toBe('finished');
  });

  it('grants the quest reward (gold divided among living heroes) on victory', () => {
    let s = startedGame();
    s = JSON.parse(JSON.stringify(s));
    s.quest.winCondition = { kind: 'escape' };
    s.quest.reward = { kind: 'gold', amount: 240, split: 'divided' };
    for (const i of [1, 2, 3]) { s.heroes[i].at = { x: 29, y: i }; s.heroes[i].escaped = true; }
    s.heroes[0].at = { x: 4, y: 17 };
    s.heroes[0].hasRolled = true;
    s.heroes[0].moveLeft = 6;
    s.turnIndex = 0;
    const before = s.heroes.map(h => h.gold);
    let out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 17 } }));
    out = unwrap(applyAction(out, 'p1', { kind: 'exit_dungeon', confirm: true }));
    expect(out.winner).toBe('heroes');
    out.heroes.forEach((h, i) => expect(h.gold).toBe(before[i] + 60)); // 240 / 4 living
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
    s.heroes[1].at = { x: 29, y: 1 };
    s.heroes[2].at = { x: 29, y: 2 };
    s.heroes[3].at = { x: 29, y: 3 };
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

  it('wins once the objective is defeated and the LAST hero exits the stairs', () => {
    const s = soloOnStairs(true);
    // The other three have already escaped; hero 0 is the last to leave.
    for (const i of [1, 2, 3]) s.heroes[i].escaped = true;
    // Moving within the stairway (objective defeated) raises the exit prompt.
    let next = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { ...STAIR_B } }));
    expect(next.pendingPrompt?.kind).toBe('exit_dungeon');
    // Confirming leaves the dungeon → all heroes out → quest won.
    next = unwrap(applyAction(next, 'p1', { kind: 'exit_dungeon', confirm: true }));
    expect(next.winner).toBe('heroes');
    expect(next.phase).toBe('intermission');
  });
});

describe('heroquest: the staircase is ONE logical space', () => {
  // Clear the three teammates off the stairs so hero 0 moves freely.
  function soloStairs(at: { x: number; y: number }, moveLeft: number): HQState {
    const s: HQState = JSON.parse(JSON.stringify(startedGame()));
    s.heroes[1].at = { x: 29, y: 1 };
    s.heroes[2].at = { x: 29, y: 2 };
    s.heroes[3].at = { x: 29, y: 3 };
    s.heroes[0].at = { ...at };
    s.heroes[0].hasRolled = true;
    s.heroes[0].moveLeft = moveLeft;
    s.turnIndex = 0;
    return s;
  }

  it('stepping off the back stair corner costs 1 movement, not 2', () => {
    // (2,18) is the far stair corner; (4,18) is a room cell two GRID steps away
    // but only ONE logical step off the stairway: (2,18)->(3,18) within the
    // stairs is free, then (3,18)->(4,18) off the stairs = 1.
    const s = soloStairs({ x: 2, y: 18 }, 1);
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 4, y: 18 } }));
    expect(out.heroes[0].at).toEqual({ x: 4, y: 18 });
    expect(out.heroes[0].moveLeft).toBe(0);
  });

  it('repositioning WITHIN the stairway is free (0 movement spent)', () => {
    const s = soloStairs({ x: 2, y: 17 }, 1);
    const out = unwrap(applyAction(s, 'p1', { kind: 'move_to', at: { x: 3, y: 18 } }));
    expect(out.heroes[0].at).toEqual({ x: 3, y: 18 });
    expect(out.heroes[0].moveLeft).toBe(1); // still on the stairs → nothing spent
  });
});
