'use client';

import { useMemo, useState } from 'react';
import {
  SIZE, SHIP_NAMES, NUM_SHIPS, shipCells,
  type BSState, type BSPayload, type Player, type Orientation, type ShotResult,
} from '@/lib/games/battleship';

export default function BattleshipBoard({
  state, currentUserId, disabled, onMove,
}: {
  state: BSState;
  currentUserId: string;
  disabled: boolean;
  onMove: (payload: BSPayload) => void;
}) {
  const me: Player | null =
    state.seats.A === currentUserId ? 'A'
    : state.seats.B === currentUserId ? 'B'
    : null;

  const opp: Player | null = me ? (me === 'A' ? 'B' : 'A') : null;
  const myFleet = me ? state.fleets[me] : null;
  const oppFleet = opp ? state.fleets[opp] : null;
  const yourTurn = !!me && state.turn === me && state.phase === 'playing' && !disabled;

  if (!me) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
        Spectator view — wait for the players to finish their game.
      </div>
    );
  }

  // ---------- SETUP PHASE ----------
  if (state.phase === 'setup') {
    return <SetupView state={state} me={me} disabled={disabled} onMove={onMove} />;
  }

  // ---------- BATTLE / FINISHED ----------
  return (
    <div className="space-y-3">
      <StatusBar state={state} me={me} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Opponent fleet — click to fire */}
        <FleetView
          title="Opponent waters"
          shots={oppFleet!.shots}
          ships={[]}                    /* hide opponent ship positions */
          highlightLastShot={state.lastShot?.shooter === me ? state.lastShot : null}
          interactive={yourTurn}
          onCellClick={(row, col) => onMove({ type: 'fire', row, col })}
        />
        {/* My fleet — show ships + opponent's shots taken on me */}
        <FleetView
          title="Your fleet"
          shots={myFleet!.shots}
          ships={myFleet!.ships}
          highlightLastShot={state.lastShot?.shooter === opp ? state.lastShot : null}
          interactive={false}
        />
      </div>

      <FleetSummary myFleet={myFleet!} oppFleet={oppFleet!} />
    </div>
  );
}

// =====================================================================
// Setup phase
// =====================================================================

function SetupView({
  state, me, disabled, onMove,
}: {
  state: BSState; me: Player; disabled: boolean;
  onMove: (payload: BSPayload) => void;
}) {
  const myFleet = state.fleets[me];
  const oppFleet = state.fleets[me === 'A' ? 'B' : 'A'];

  const [selectedShipId, setSelectedShipId] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Orientation>('h');

  // Auto-select the next unplaced ship after one is placed
  const nextUnplaced = myFleet.ships.find(s => !s.placed)?.id ?? null;
  const activeShipId = selectedShipId !== null && !myFleet.ships[selectedShipId].placed
    ? selectedShipId
    : nextUnplaced;
  const activeShip = activeShipId !== null ? myFleet.ships[activeShipId] : null;

  // Compute the cells the selected ship would occupy at a given hover cell — for preview
  const [hover, setHover] = useState<[number, number] | null>(null);
  const previewCells = useMemo(() => {
    if (!activeShip || !hover) return new Set<string>();
    const [r, c] = hover;
    const cells = shipCells(r, c, activeShip.size, orientation);
    return new Set(cells.map(([cr, cc]) => `${cr},${cc}`));
  }, [activeShip, hover, orientation]);

  // Check if the preview would actually be valid (in-bounds and non-overlapping)
  const previewValid = useMemo(() => {
    if (!activeShip || !hover) return false;
    const [r, c] = hover;
    const cells = shipCells(r, c, activeShip.size, orientation);
    const occ = new Set<string>();
    for (const s of myFleet.ships) {
      if (s.id === activeShip.id || !s.placed || s.row === undefined || s.col === undefined || !s.orientation) continue;
      for (const [cr, cc] of shipCells(s.row, s.col, s.size, s.orientation)) occ.add(`${cr},${cc}`);
    }
    for (const [cr, cc] of cells) {
      if (cr < 0 || cr >= SIZE || cc < 0 || cc >= SIZE) return false;
      if (occ.has(`${cr},${cc}`)) return false;
    }
    return true;
  }, [activeShip, hover, orientation, myFleet.ships]);

  const onBoardClick = (r: number, c: number) => {
    if (myFleet.ready) return;
    if (activeShip && previewValid) {
      onMove({ type: 'place', shipId: activeShip.id, row: r, col: c, orientation });
    }
    // If clicking a placed ship cell, treat as remove
    const clickedShip = myFleet.ships.find(s =>
      s.placed && s.row !== undefined && s.col !== undefined && s.orientation &&
      shipCells(s.row, s.col, s.size, s.orientation).some(([cr, cc]) => cr === r && cc === c),
    );
    if (clickedShip && !activeShip) {
      onMove({ type: 'remove', shipId: clickedShip.id });
    }
  };

  const allPlaced = myFleet.ships.every(s => s.placed);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
        <p className="font-medium text-emerald-400">Setup — place your fleet</p>
        <p className="text-xs text-neutral-400">
          Pick a ship, choose orientation, then click on the board to place it. Click an already-placed
          ship to remove it. When all 5 are placed, hit <strong>Ready</strong>.
          {oppFleet.ready && <span className="ml-2 text-amber-300">(Opponent is ready, waiting on you.)</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
        {/* Setup board */}
        <SetupBoard
          fleet={myFleet}
          previewCells={previewCells}
          previewValid={previewValid}
          onCellEnter={(r, c) => setHover([r, c])}
          onCellLeave={() => setHover(null)}
          onCellClick={onBoardClick}
          disabled={disabled || myFleet.ready}
        />

        {/* Ship list + controls */}
        <div className="space-y-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-neutral-500">
              <span>Fleet</span>
              <button
                disabled={disabled || myFleet.ready}
                onClick={() => setOrientation(o => (o === 'h' ? 'v' : 'h'))}
                className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] hover:bg-neutral-800 disabled:opacity-40"
              >
                Orient: {orientation === 'h' ? 'Horizontal' : 'Vertical'}
              </button>
            </div>
            <ul className="space-y-1.5">
              {myFleet.ships.map(s => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelectedShipId(s.id)}
                    disabled={disabled || myFleet.ready || s.placed}
                    className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs transition disabled:cursor-not-allowed ${
                      activeShipId === s.id && !s.placed
                        ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200'
                        : s.placed
                          ? 'border-neutral-800 bg-neutral-950 text-neutral-500 line-through'
                          : 'border-neutral-700 bg-neutral-950 hover:bg-neutral-800'
                    }`}
                  >
                    <span>{SHIP_NAMES[s.id]}</span>
                    <span className="font-mono">{s.size}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={disabled || myFleet.ready}
              onClick={() => onMove({ type: 'auto' })}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs hover:bg-neutral-800 disabled:opacity-40"
            >
              Auto-place
            </button>
            <button
              disabled={disabled || myFleet.ready}
              onClick={() => onMove({ type: 'reset' })}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs hover:bg-neutral-800 disabled:opacity-40"
            >
              Reset
            </button>
          </div>

          {!myFleet.ready ? (
            <button
              disabled={disabled || !allPlaced}
              onClick={() => onMove({ type: 'ready' })}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-bold text-neutral-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              Ready
            </button>
          ) : (
            <button
              disabled={disabled}
              onClick={() => onMove({ type: 'unready' })}
              className="w-full rounded-md border border-amber-500 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20"
            >
              Unready (waiting on opponent)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SetupBoard({
  fleet, previewCells, previewValid, onCellEnter, onCellLeave, onCellClick, disabled,
}: {
  fleet: BSState['fleets']['A'];
  previewCells: Set<string>;
  previewValid: boolean;
  onCellEnter: (r: number, c: number) => void;
  onCellLeave: () => void;
  onCellClick: (r: number, c: number) => void;
  disabled: boolean;
}) {
  // Set of occupied cells (placed ships)
  const occ = new Set<string>();
  for (const s of fleet.ships) {
    if (!s.placed || s.row === undefined || s.col === undefined || !s.orientation) continue;
    for (const [r, c] of shipCells(s.row, s.col, s.size, s.orientation)) occ.add(`${r},${c}`);
  }
  return (
    <div
      className="mx-auto inline-grid overflow-hidden rounded-lg border-2 border-sky-800 bg-sky-950 shadow-lg"
      style={{ gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))`, width: 'min(100%, 480px)' }}
    >
      {Array.from({ length: SIZE }).map((_, r) =>
        Array.from({ length: SIZE }).map((__, c) => {
          const isOcc = occ.has(`${r},${c}`);
          const isPreview = previewCells.has(`${r},${c}`);
          return (
            <button
              key={`${r}-${c}`}
              disabled={disabled}
              onMouseEnter={() => onCellEnter(r, c)}
              onMouseLeave={onCellLeave}
              onClick={() => onCellClick(r, c)}
              className={`aspect-square w-full border border-sky-900/40 transition ${
                isOcc
                  ? 'bg-neutral-500'
                  : isPreview
                    ? previewValid ? 'bg-emerald-500/40' : 'bg-red-500/40'
                    : 'bg-sky-900/30 hover:bg-sky-800/40'
              }`}
            />
          );
        }),
      )}
    </div>
  );
}

// =====================================================================
// Battle phase
// =====================================================================

function StatusBar({ state, me }: { state: BSState; me: Player }) {
  if (state.winner) {
    return (
      <div className={`rounded-xl border p-3 text-center text-sm font-semibold ${
        state.winner === me
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      }`}>
        {state.winner === me ? '🏆 Victory! Their fleet is sunk.' : '💥 You were sunk! Better luck next time.'}
      </div>
    );
  }
  const myTurn = state.turn === me;
  const last = state.lastShot;
  const lastLine = last ? (
    <span className={`ml-2 text-xs ${last.result === 'sunk' ? 'text-amber-400' : last.result === 'hit' ? 'text-rose-400' : 'text-neutral-400'}`}>
      Last: {last.shooter === me ? 'You' : 'Opponent'} fired at ({last.row + 1},{last.col + 1}) — {last.result.toUpperCase()}
      {last.result === 'sunk' && last.shipName ? ` (${last.shipName})` : ''}
    </span>
  ) : null;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
      <span className={myTurn ? 'font-semibold text-emerald-400' : 'text-neutral-300'}>
        {myTurn ? 'Your shot — click a cell on Opponent waters' : 'Waiting on opponent…'}
      </span>
      {lastLine}
    </div>
  );
}

function FleetView({
  title, shots, ships, highlightLastShot, interactive, onCellClick,
}: {
  title: string;
  shots: (ShotResult | null)[][];
  ships: BSState['fleets']['A']['ships'];   // visible only for own fleet
  highlightLastShot: BSState['lastShot'];
  interactive: boolean;
  onCellClick?: (r: number, c: number) => void;
}) {
  // Map of (row,col) → owner ship id, so we can show our own ship outline.
  const shipMap = new Map<string, number>();
  for (const s of ships) {
    if (!s.placed || s.row === undefined || s.col === undefined || !s.orientation) continue;
    for (const [r, c] of shipCells(s.row, s.col, s.size, s.orientation)) shipMap.set(`${r},${c}`, s.id);
  }
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">{title}</div>
      <div
        className="mx-auto inline-grid overflow-hidden rounded-md border-2 border-sky-800 bg-sky-950 shadow"
        style={{ gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))`, width: 'min(100%, 360px)' }}
      >
        {Array.from({ length: SIZE }).map((_, r) =>
          Array.from({ length: SIZE }).map((__, c) => {
            const shot = shots[r][c];
            const hasShip = shipMap.has(`${r},${c}`);
            const isLast = highlightLastShot && highlightLastShot.row === r && highlightLastShot.col === c;
            return (
              <button
                key={`${r}-${c}`}
                disabled={!interactive || shot !== null}
                onClick={() => interactive && onCellClick?.(r, c)}
                className={`group relative aspect-square w-full border border-sky-900/40 transition ${
                  shot === 'miss' ? 'bg-sky-800/60'
                  : shot === 'hit' ? 'bg-rose-700/80'
                  : shot === 'sunk' ? 'bg-rose-900'
                  : hasShip ? 'bg-neutral-500'
                  : 'bg-sky-900/30'
                } ${interactive && shot === null ? 'hover:bg-sky-700/40' : ''} ${
                  isLast ? 'ring-2 ring-amber-300' : ''
                }`}
              >
                {shot === 'miss' && <span className="pointer-events-none absolute inset-0 m-auto block h-1.5 w-1.5 rounded-full bg-white/70" />}
                {(shot === 'hit' || shot === 'sunk') && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs">💥</span>
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

function FleetSummary({ myFleet, oppFleet }: { myFleet: BSState['fleets']['A']; oppFleet: BSState['fleets']['A'] }) {
  // Count of each side's ships still alive (any cell not yet 'sunk')
  const aliveCount = (fleet: BSState['fleets']['A']) =>
    fleet.ships.filter(s =>
      s.placed && s.row !== undefined && s.col !== undefined && s.orientation
      && shipCells(s.row, s.col, s.size, s.orientation).some(([r, c]) => fleet.shots[r][c] !== 'sunk'),
    ).length;
  return (
    <div className="grid grid-cols-2 gap-4 text-center text-sm">
      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-2">
        <div className="text-xs uppercase tracking-wider text-neutral-500">Opponent ships left</div>
        <div className="font-mono text-xl font-bold text-rose-400">{aliveCount(oppFleet)} / {NUM_SHIPS}</div>
      </div>
      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-2">
        <div className="text-xs uppercase tracking-wider text-neutral-500">Your ships left</div>
        <div className="font-mono text-xl font-bold text-emerald-400">{aliveCount(myFleet)} / {NUM_SHIPS}</div>
      </div>
    </div>
  );
}
