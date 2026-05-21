'use client';

import { useId, useMemo, useState } from 'react';
import {
  SIZE, SHIP_NAMES, SHIP_SIZES, NUM_SHIPS, shipCells,
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
  const shipCellSet = useMemo(() => {
    const s = new Set<string>();
    for (const sh of fleet.ships) {
      if (!sh.placed || sh.row === undefined || sh.col === undefined || !sh.orientation) continue;
      for (const [r, c] of shipCells(sh.row, sh.col, sh.size, sh.orientation)) s.add(`${r},${c}`);
    }
    return s;
  }, [fleet.ships]);

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-lg border-2 border-sky-800 bg-sky-950 shadow-lg"
      style={{ width: 'min(100%, 480px)' }}
    >
      <ShipOverlay ships={fleet.ships} shotsHidingShip={null} />
      <div
        className="relative grid"
        style={{ gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: SIZE }).map((_, r) =>
          Array.from({ length: SIZE }).map((__, c) => {
            const hasShip = shipCellSet.has(`${r},${c}`);
            const isPreview = previewCells.has(`${r},${c}`);
            return (
              <button
                key={`${r}-${c}`}
                disabled={disabled}
                onMouseEnter={() => onCellEnter(r, c)}
                onMouseLeave={onCellLeave}
                onClick={() => onCellClick(r, c)}
                className={`relative aspect-square w-full border border-sky-900/40 transition ${
                  isPreview
                    ? previewValid ? 'bg-emerald-500/40' : 'bg-red-500/40'
                    : hasShip
                      ? 'bg-transparent hover:bg-white/5'
                      : 'bg-sky-900/30 hover:bg-sky-800/40'
                }`}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

/**
 * Renders all placed ships as SVG hulls positioned absolutely over the board.
 * Lives BELOW the cell grid (no z-index needed — earlier in DOM) so that shot
 * cells (opaque rose paint) cover the ship when it gets hit. Unshot ship cells
 * are transparent in the grid, letting the SVG ship show through.
 *
 * `shotsHidingShip` is a 2D `ShotResult|null` array for the same fleet, used in
 * the battle phase to mask hull segments that have been hit — we still want the
 * fire/sink overlay (drawn by the cell button) to be the dominant signal.
 */
function ShipOverlay({
  ships, shotsHidingShip,
}: {
  ships: BSState['fleets']['A']['ships'];
  shotsHidingShip: (ShotResult | null)[][] | null;
}) {
  const placed = ships.filter(s => s.placed && s.row !== undefined && s.col !== undefined && s.orientation);
  return (
    <div className="pointer-events-none absolute inset-0">
      {placed.map(s => {
        // Skip rendering an SVG entirely if every cell of this ship is already
        // shot — the cell paint covers it and the SVG would only smear edges.
        if (shotsHidingShip) {
          const allShot = shipCells(s.row!, s.col!, s.size, s.orientation!)
            .every(([r, c]) => shotsHidingShip[r][c] !== null);
          if (allShot) return null;
        }
        const isH = s.orientation === 'h';
        const left = (s.col! / SIZE) * 100;
        const top  = (s.row! / SIZE) * 100;
        const width  = (isH ? s.size : 1) * (100 / SIZE);
        const height = (isH ? 1 : s.size) * (100 / SIZE);
        return (
          <div
            key={s.id}
            className="absolute"
            style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
          >
            <ShipSVG shipId={s.id} orientation={s.orientation!} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Top-down silhouette of a warship, scaled to fit its container exactly. Each
 * ship class (Carrier / Battleship / Cruiser / Submarine / Destroyer) gets its
 * own superstructure so the fleet reads at a glance: long flat deck w/ island
 * for the Carrier, twin turrets for the Battleship, sleek hull + sail for the
 * Submarine, etc.
 */
function ShipSVG({ shipId, orientation }: { shipId: number; orientation: Orientation }) {
  const reactId = useId();
  const size = SHIP_SIZES[shipId];
  const isH = orientation === 'h';
  const long = size * 10;
  const short = 10;
  const vb = isH ? `0 0 ${long} ${short}` : `0 0 ${short} ${long}`;
  // Map (longPos, shortPos) → (x, y) coords.
  const X = (lp: number, sp: number) => (isH ? lp : sp);
  const Y = (lp: number, sp: number) => (isH ? sp : lp);
  const xy = (lp: number, sp: number) => `${X(lp, sp)},${Y(lp, sp)}`;

  // ----- Hull silhouettes -----
  // Surface ship: bow pointed, stern flat.
  const hullPath =
    `M ${xy(0, 5)} ` +
    `Q ${xy(0.3, 1.8)} ${xy(2, 1.5)} ` +
    `L ${xy(long - 0.5, 1.5)} L ${xy(long, 2.4)} ` +
    `L ${xy(long, 7.6)} L ${xy(long - 0.5, 8.5)} ` +
    `L ${xy(2, 8.5)} Q ${xy(0.3, 8.2)} ${xy(0, 5)} Z`;
  // Submarine: rounded both ends (cylindrical from above).
  const subHullPath =
    `M ${xy(0, 5)} ` +
    `Q ${xy(0.5, 2.5)} ${xy(2, 2.5)} L ${xy(long - 2, 2.5)} ` +
    `Q ${xy(long - 0.5, 2.5)} ${xy(long, 5)} ` +
    `Q ${xy(long - 0.5, 7.5)} ${xy(long - 2, 7.5)} ` +
    `L ${xy(2, 7.5)} Q ${xy(0.5, 7.5)} ${xy(0, 5)} Z`;
  // Carrier: flat-edged rectangular deck (no pointed bow on the deck shape).
  const carrierHullPath =
    `M ${xy(0.5, 1.5)} L ${xy(long - 0.5, 1.5)} ` +
    `Q ${xy(long, 1.5)} ${xy(long, 2.5)} ` +
    `L ${xy(long, 7.5)} Q ${xy(long, 8.5)} ${xy(long - 0.5, 8.5)} ` +
    `L ${xy(0.5, 8.5)} Q ${xy(0, 8.5)} ${xy(0, 7.5)} ` +
    `L ${xy(0, 2.5)} Q ${xy(0, 1.5)} ${xy(0.5, 1.5)} Z`;

  const usedHull = shipId === 0 ? carrierHullPath : shipId === 3 ? subHullPath : hullPath;

  // ----- Helpers for orientation-aware shapes -----
  const Rect = ({ lp, sp, lpW, spW, ...rest }: {
    lp: number; sp: number; lpW: number; spW: number;
  } & React.SVGProps<SVGRectElement>) => (
    <rect
      x={isH ? lp : sp}
      y={isH ? sp : lp}
      width={isH ? lpW : spW}
      height={isH ? spW : lpW}
      {...rest}
    />
  );
  const Circle = ({ lp, sp, r, ...rest }: {
    lp: number; sp: number; r: number;
  } & React.SVGProps<SVGCircleElement>) => (
    <circle cx={isH ? lp : sp} cy={isH ? sp : lp} r={r} {...rest} />
  );

  // ----- Superstructure per ship class -----
  let supers: React.ReactNode = null;
  switch (shipId) {
    case 0: // Carrier — flat deck, offset island, helipad rings
      supers = (
        <>
          {/* Deck stripe down the centerline */}
          <path
            d={`M ${xy(0.8, 5)} L ${xy(long - 0.8, 5)}`}
            stroke="#d4d4d4" strokeWidth="0.3" strokeDasharray="1.2,0.6" opacity="0.6"
          />
          {/* Island superstructure offset to starboard, two-thirds aft */}
          <Rect lp={long * 0.55} sp={7.3} lpW={long * 0.18} spW={1.7}
                fill="#e5e7eb" stroke="#171717" strokeWidth="0.25" rx={0.3} />
          {/* Smokestack on the island */}
          <Circle lp={long * 0.62} sp={8.15} r={0.55} fill="#1f1f1f" />
          {/* Helipad bullseyes */}
          <Circle lp={long * 0.2} sp={4.5} r={1.3} fill="none" stroke="#e5e7eb" strokeWidth="0.25" />
          <Circle lp={long * 0.2} sp={4.5} r={0.6} fill="none" stroke="#e5e7eb" strokeWidth="0.2" />
          <Circle lp={long * 0.36} sp={4.5} r={1.1} fill="none" stroke="#e5e7eb" strokeWidth="0.2" />
        </>
      );
      break;
    case 1: // Battleship — large bridge, smokestack, twin turrets fore/aft
      supers = (
        <>
          <Rect lp={long * 0.4} sp={3.4} lpW={long * 0.2} spW={3.2}
                fill="#d4d4d4" stroke="#171717" strokeWidth="0.25" rx={0.3} />
          {/* Smokestack */}
          <Circle lp={long * 0.62} sp={5} r={1} fill="#171717" />
          <Circle lp={long * 0.62} sp={5} r={0.5} fill="#525252" />
          {/* Fore turret */}
          <Circle lp={long * 0.18} sp={5} r={1.5} fill="#171717" stroke="#0a0a0a" strokeWidth="0.2" />
          <Rect lp={long * 0.18 - 0.5} sp={4.6} lpW={long * 0.08} spW={0.8}
                fill="#171717" />
          {/* Aft turret */}
          <Circle lp={long * 0.85} sp={5} r={1.4} fill="#171717" stroke="#0a0a0a" strokeWidth="0.2" />
          <Rect lp={long * 0.85 + 0.4} sp={4.6} lpW={long * 0.06} spW={0.8}
                fill="#171717" />
        </>
      );
      break;
    case 2: // Cruiser — bridge + single turret + smokestack
      supers = (
        <>
          <Rect lp={long * 0.32} sp={3.5} lpW={long * 0.28} spW={3}
                fill="#d4d4d4" stroke="#171717" strokeWidth="0.25" rx={0.3} />
          <Circle lp={long * 0.65} sp={5} r={0.8} fill="#171717" />
          <Circle lp={long * 0.15} sp={5} r={1.3} fill="#171717" stroke="#0a0a0a" strokeWidth="0.2" />
          <Rect lp={long * 0.15 - 0.4} sp={4.65} lpW={long * 0.07} spW={0.7}
                fill="#171717" />
        </>
      );
      break;
    case 3: // Submarine — conning tower (sail) + periscope
      supers = (
        <>
          <Rect lp={long * 0.4} sp={3.6} lpW={long * 0.22} spW={2.8}
                fill="#404040" stroke="#0a0a0a" strokeWidth="0.25" rx={0.8} />
          {/* Periscope */}
          <Circle lp={long * 0.51} sp={4.4} r={0.35} fill="#171717" />
          <Rect lp={long * 0.5} sp={2.4} lpW={0.25} spW={1.4} fill="#171717" />
        </>
      );
      break;
    case 4: // Destroyer — small bridge + small aft gun
    default:
      supers = (
        <>
          <Rect lp={long * 0.32} sp={3.6} lpW={long * 0.36} spW={2.8}
                fill="#d4d4d4" stroke="#171717" strokeWidth="0.25" rx={0.3} />
          <Circle lp={long * 0.82} sp={5} r={0.9} fill="#171717" />
          <Rect lp={long * 0.82 + 0.3} sp={4.7} lpW={long * 0.07} spW={0.6} fill="#171717" />
        </>
      );
      break;
  }

  const gradId = `hullGrad-${reactId.replace(/:/g, '')}-${shipId}`;
  return (
    <svg viewBox={vb} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId}
          x1={isH ? '0' : '0'} y1={isH ? '0' : '0'}
          x2={isH ? '0' : '1'} y2={isH ? '1' : '0'}
        >
          <stop offset="0%"   stopColor="#1f1f1f" />
          <stop offset="25%"  stopColor="#525252" />
          <stop offset="50%"  stopColor="#a3a3a3" />
          <stop offset="75%"  stopColor="#525252" />
          <stop offset="100%" stopColor="#171717" />
        </linearGradient>
      </defs>
      <path d={usedHull} fill={`url(#${gradId})`} stroke="#0a0a0a" strokeWidth="0.3" />
      {supers}
    </svg>
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
  const shipCellSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of ships) {
      if (!s.placed || s.row === undefined || s.col === undefined || !s.orientation) continue;
      for (const [r, c] of shipCells(s.row, s.col, s.size, s.orientation)) set.add(`${r},${c}`);
    }
    return set;
  }, [ships]);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">{title}</div>
      <div
        className="relative mx-auto overflow-hidden rounded-md border-2 border-sky-800 bg-sky-950 shadow"
        style={{ width: 'min(100%, 360px)' }}
      >
        {/* Ship hulls drawn beneath the cell grid. Shot cells are opaque, so the
            ship "disappears" under fire/sink paint automatically. */}
        <ShipOverlay ships={ships} shotsHidingShip={shots} />
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: SIZE }).map((_, r) =>
            Array.from({ length: SIZE }).map((__, c) => {
              const shot = shots[r][c];
              const hasShip = shipCellSet.has(`${r},${c}`);
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
                    : hasShip ? 'bg-transparent'
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
