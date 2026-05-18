// Battleship — classic 10×10, 5 ships per side, strict turn-by-turn shooting.
// Two phases: 'setup' (each player places their fleet, then marks Ready) and 'playing'
// (alternating one shot per turn). Hidden-info note: the server stores both fleets'
// ship positions in the shared state; clients are expected to render the opponent fleet
// without revealing un-hit ship cells (trust-based privacy for casual play).

export const SIZE = 10;
export const SHIP_SIZES = [5, 4, 3, 3, 2] as const;
export const SHIP_NAMES = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'] as const;
export const NUM_SHIPS = SHIP_SIZES.length;

export type Orientation = 'h' | 'v';
export type Player = 'A' | 'B';
export type ShotResult = 'miss' | 'hit' | 'sunk';

export type Ship = {
  id: number;            // 0..4 (index into SHIP_SIZES)
  size: number;
  placed: boolean;
  row?: number;          // top cell when placed
  col?: number;
  orientation?: Orientation;
};

export type FleetState = {
  ships: Ship[];
  ready: boolean;
  /** Per-cell record of opponent shots taken AT this fleet (10×10). null = not shot yet. */
  shots: (ShotResult | null)[][];
};

export type BSState = {
  phase: 'setup' | 'playing' | 'finished';
  turn: Player;
  seats: { A?: string; B?: string };
  fleets: { A: FleetState; B: FleetState };
  winner: Player | null;
  lastShot: {
    shooter: Player;
    row: number;
    col: number;
    result: ShotResult;
    shipName?: string;
  } | null;
};

export type BSPayload =
  | { type: 'place';   shipId: number; row: number; col: number; orientation: Orientation }
  | { type: 'remove';  shipId: number }
  | { type: 'auto' }
  | { type: 'reset' }
  | { type: 'ready' }
  | { type: 'unready' }
  | { type: 'fire';    row: number; col: number };

function newFleet(): FleetState {
  return {
    ships: SHIP_SIZES.map((size, id) => ({ id, size, placed: false })),
    ready: false,
    shots: Array.from({ length: SIZE }, () => Array<ShotResult | null>(SIZE).fill(null)),
  };
}

export function initialState(): BSState {
  return {
    phase: 'setup',
    turn: 'A',
    seats: {},
    fleets: { A: newFleet(), B: newFleet() },
    winner: null,
    lastShot: null,
  };
}

function inBounds(r: number, c: number) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

/** All cells a ship would occupy at (row, col, orientation). */
export function shipCells(row: number, col: number, size: number, orientation: Orientation): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i < size; i++) {
    cells.push(orientation === 'h' ? [row, col + i] : [row + i, col]);
  }
  return cells;
}

/** Set of cells occupied by all placed ships in this fleet. */
function occupiedCells(fleet: FleetState): Set<string> {
  const set = new Set<string>();
  for (const s of fleet.ships) {
    if (!s.placed || s.row === undefined || s.col === undefined || !s.orientation) continue;
    for (const [r, c] of shipCells(s.row, s.col, s.size, s.orientation)) {
      set.add(`${r},${c}`);
    }
  }
  return set;
}

/** Would placing this ship at (row,col,orientation) fit and avoid other placed ships? */
function canPlace(fleet: FleetState, shipId: number, row: number, col: number, orientation: Orientation): boolean {
  const ship = fleet.ships[shipId];
  if (!ship) return false;
  const cells = shipCells(row, col, ship.size, orientation);
  for (const [r, c] of cells) if (!inBounds(r, c)) return false;
  // Exclude this ship from the occupied set so re-placing it is allowed
  const others = fleet.ships.filter(s => s.id !== shipId);
  const occ = occupiedCells({ ...fleet, ships: others });
  for (const [r, c] of cells) if (occ.has(`${r},${c}`)) return false;
  return true;
}

/** Random valid placement of all 5 ships. Used by the "Auto-place" button. */
function autoPlace(fleet: FleetState): FleetState {
  const ships: Ship[] = SHIP_SIZES.map((size, id) => ({ id, size, placed: false }));
  const placedFleet: FleetState = { ...fleet, ships, ready: false };
  for (let id = 0; id < NUM_SHIPS; id++) {
    const ship = ships[id];
    for (let attempt = 0; attempt < 1000; attempt++) {
      const orientation: Orientation = Math.random() < 0.5 ? 'h' : 'v';
      const maxR = orientation === 'v' ? SIZE - ship.size : SIZE - 1;
      const maxC = orientation === 'h' ? SIZE - ship.size : SIZE - 1;
      const row = Math.floor(Math.random() * (maxR + 1));
      const col = Math.floor(Math.random() * (maxC + 1));
      if (canPlace(placedFleet, id, row, col, orientation)) {
        ships[id] = { ...ship, placed: true, row, col, orientation };
        break;
      }
    }
  }
  return placedFleet;
}

/** Which cell of which ship (if any) does this fleet have at (row, col)? */
function shipAt(fleet: FleetState, row: number, col: number): Ship | null {
  for (const s of fleet.ships) {
    if (!s.placed || s.row === undefined || s.col === undefined || !s.orientation) continue;
    for (const [r, c] of shipCells(s.row, s.col, s.size, s.orientation)) {
      if (r === row && c === col) return s;
    }
  }
  return null;
}

/** Has every cell of `ship` been hit on `fleet.shots`? */
function isShipSunk(fleet: FleetState, ship: Ship): boolean {
  if (!ship.placed || ship.row === undefined || ship.col === undefined || !ship.orientation) return false;
  for (const [r, c] of shipCells(ship.row, ship.col, ship.size, ship.orientation)) {
    if (fleet.shots[r][c] !== 'hit' && fleet.shots[r][c] !== 'sunk') return false;
  }
  return true;
}

/** Has every ship in `fleet` been sunk? Used for win check. */
function allShipsSunk(fleet: FleetState): boolean {
  for (const s of fleet.ships) {
    if (!s.placed) return false;
    if (!isShipSunk(fleet, s)) return false;
  }
  return true;
}

function playerOf(state: BSState, playerId: string): Player | null {
  if (state.seats.A === playerId) return 'A';
  if (state.seats.B === playerId) return 'B';
  return null;
}

export function applyMove(state: BSState, playerId: string, payload: BSPayload): BSState | { error: string } {
  const me = playerOf(state, playerId);
  if (!me) return { error: 'Not a seated player' };

  // ---------- SETUP PHASE ----------
  if (state.phase === 'setup') {
    const fleet = state.fleets[me];
    if (payload.type === 'place') {
      if (fleet.ready) return { error: 'Already ready — unready first to edit your fleet' };
      const { shipId, row, col, orientation } = payload;
      if (!canPlace(fleet, shipId, row, col, orientation)) return { error: 'Invalid placement' };
      const ships = fleet.ships.map(s =>
        s.id === shipId ? { ...s, placed: true, row, col, orientation } : s,
      );
      return updateFleet(state, me, { ...fleet, ships });
    }
    if (payload.type === 'remove') {
      if (fleet.ready) return { error: 'Already ready — unready first' };
      const ships = fleet.ships.map(s =>
        s.id === payload.shipId
          ? { id: s.id, size: s.size, placed: false }
          : s,
      );
      return updateFleet(state, me, { ...fleet, ships });
    }
    if (payload.type === 'auto') {
      if (fleet.ready) return { error: 'Already ready — unready first' };
      return updateFleet(state, me, autoPlace(fleet));
    }
    if (payload.type === 'reset') {
      if (fleet.ready) return { error: 'Already ready — unready first' };
      return updateFleet(state, me, newFleet());
    }
    if (payload.type === 'ready') {
      if (!fleet.ships.every(s => s.placed)) return { error: 'Place all 5 ships first' };
      const newState = updateFleet(state, me, { ...fleet, ready: true });
      // Both ready → start battle
      if (newState.fleets.A.ready && newState.fleets.B.ready) {
        // Coin flip for who shoots first
        return { ...newState, phase: 'playing', turn: Math.random() < 0.5 ? 'A' : 'B' };
      }
      return newState;
    }
    if (payload.type === 'unready') {
      return updateFleet(state, me, { ...fleet, ready: false });
    }
    return { error: 'Setup phase: invalid action' };
  }

  // ---------- BATTLE PHASE ----------
  if (state.phase === 'playing') {
    if (payload.type !== 'fire') return { error: 'Battle phase: must fire a shot' };
    if (state.turn !== me) return { error: 'Not your turn' };
    const { row, col } = payload;
    if (!inBounds(row, col)) return { error: 'Out of bounds' };

    const oppKey: Player = me === 'A' ? 'B' : 'A';
    const oppFleet = state.fleets[oppKey];
    if (oppFleet.shots[row][col] !== null) return { error: 'Already fired at that cell' };

    const hitShip = shipAt(oppFleet, row, col);
    let result: ShotResult = hitShip ? 'hit' : 'miss';

    // Apply the shot
    const shots = oppFleet.shots.map(r => r.slice());
    shots[row][col] = result;
    let updatedFleet: FleetState = { ...oppFleet, shots };

    // If the hit ship is now sunk, upgrade the shot result + mark all its cells as 'sunk'
    let shipName: string | undefined;
    if (hitShip && isShipSunk(updatedFleet, hitShip)) {
      result = 'sunk';
      shipName = SHIP_NAMES[hitShip.id];
      const sunkShots = updatedFleet.shots.map(r => r.slice());
      for (const [r, c] of shipCells(hitShip.row!, hitShip.col!, hitShip.size, hitShip.orientation!)) {
        sunkShots[r][c] = 'sunk';
      }
      updatedFleet = { ...updatedFleet, shots: sunkShots };
    }

    const fleets = { ...state.fleets, [oppKey]: updatedFleet };

    // Win check
    let winner: Player | null = null;
    if (allShipsSunk(updatedFleet)) winner = me;

    return {
      ...state,
      fleets,
      lastShot: { shooter: me, row, col, result, shipName },
      turn: winner ? state.turn : oppKey, // strict turn alternation
      phase: winner ? 'finished' : 'playing',
      winner,
    };
  }

  return { error: 'Game over' };
}

function updateFleet(state: BSState, p: Player, fleet: FleetState): BSState {
  return { ...state, fleets: { ...state.fleets, [p]: fleet } };
}
