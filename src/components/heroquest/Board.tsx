'use client';

// HeroQuest board canvas — stone tiles, torchlit fog of war, hero/monster
// tokens rendered as SVG portraits, click-to-move highlights.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  MONSTER_STATS,
  type HQState,
  type Hero,
  type Monster,
  type Coord,
  type Door as HQDoor,
  type Furniture as HQFurniture,
} from '@/lib/games/heroquest';
import {
  FloorCell, StairsTile,
  HeroToken, MonsterToken, FurnitureToken,
  HQ_COLORS,
  type FloorStyle,
} from './Art';
import { safeAccent } from '@/lib/accentColors';

export const TILE_PX = 36;

// Light grey "broken slate" flooring for the hallways/corridors.
const CORRIDOR_FLOOR: { tl: string; br: string; style: FloorStyle } = { tl: '#9c9c98', br: '#6c6c68', style: 'slate' };
// A varied set of (color, pattern) floor looks for rooms. The room coloring
// spreads these across the board (and keeps touching rooms distinct), so the
// dungeon reads like the printed board rather than one repeated tile.
const ROOM_FLOORS: { tl: string; br: string; style: FloorStyle }[] = [
  { tl: '#7a6147', br: '#4c3d2c', style: 'flag' },        // warm tan flagstone
  { tl: '#4e5e72', br: '#2e3b47', style: 'checker' },     // slate-blue checker
  { tl: '#566b4a', br: '#384630', style: 'brick' },       // moss-green brick
  { tl: '#7a4c4c', br: '#472e2e', style: 'flag' },        // dusty red flag
  { tl: '#5d4a6b', br: '#3c2f48', style: 'cobble' },      // purple cobble
  { tl: '#7a7050', br: '#474230', style: 'diag' },        // olive diagonal
  { tl: '#487a70', br: '#2e4844', style: 'flag' },        // teal flag
  { tl: '#7a5650', br: '#473934', style: 'checker' },     // brown-rose checker
  { tl: '#4f566b', br: '#333848', style: 'brick' },       // indigo brick
  { tl: '#6f7a48', br: '#42472e', style: 'cobble' },      // yellow-green cobble
  { tl: '#3f6b7a', br: '#2a4450', style: 'diag' },        // cyan diagonal
  { tl: '#7a5a3a', br: '#4a3622', style: 'plank' },       // oak plank
  { tl: '#6b4a5e', br: '#45303c', style: 'herringbone' }, // magenta herringbone
  { tl: '#5a6b5a', br: '#384538', style: 'slate' },       // grey-green slate
];

export type BoardCanvasProps = {
  state: HQState;
  currentUserId: string;
  disabled: boolean;
  onMoveTo: (at: Coord) => void;
  onOpenDoor: (doorId: string) => void;
  onAttack: (monsterId: string) => void;
  /** When true, the board is in spell-targeting mode: every visible monster is
   *  clickable and routes to onPickMonster instead of the normal attack flow. */
  spellTargetMonsters?: boolean;
  onPickMonster?: (monsterId: string) => void;
};

export default function HeroQuestBoardCanvas({
  state, currentUserId, disabled, onMoveTo, onOpenDoor, onAttack,
  spellTargetMonsters = false, onPickMonster,
}: BoardCanvasProps) {
  const W = state.quest.width;
  const H = state.quest.height;

  // Active hero (turn-holder). With players controlling multiple heroes,
  // "my hero" for the purpose of movement / attack highlights is whichever
  // of my heroes is currently UP. (If it's another player's turn, we draw
  // no movement highlights at all.)
  const activeHero = state.heroes[state.turnIndex];
  const isMyTurn = activeHero?.playerId === currentUserId;
  const myHero = isMyTurn && activeHero?.body > 0 ? activeHero : undefined;

  // ---- Edge helpers: walls & doors live on the LINES between cells ----
  const regionAt = (x: number, y: number) => state.tiles[y]?.[x]?.region ?? '';
  const isWallEdge = (ax: number, ay: number, bx: number, by: number) => {
    const ra = regionAt(ax, ay), rb = regionAt(bx, by);
    if (ra === rb) return false;
    return ra.startsWith('room_') || rb.startsWith('room_');
  };
  const eKey = (ax: number, ay: number, bx: number, by: number) =>
    (ay < by || (ay === by && ax < bx)) ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`;
  const doorByEdge = useMemo(() => {
    const m = new Map<string, HQDoor>();
    for (const d of state.doors) for (const c of d.crossings) m.set(eKey(c.a.x, c.a.y, c.b.x, c.b.y), d);
    return m;
  }, [state.doors]);
  const doorAtEdge = (ax: number, ay: number, bx: number, by: number) => doorByEdge.get(eKey(ax, ay, bx, by));
  const edgeBlocksMove = (ax: number, ay: number, bx: number, by: number, phaseWalls: boolean) => {
    if (phaseWalls) return false;
    if (!isWallEdge(ax, ay, bx, by)) return false;
    const d = doorAtEdge(ax, ay, bx, by);
    if (d) return (d.secret && !d.found) ? true : !d.open;
    return true;
  };

  // ---- Indexes ----
  const monsterByCell = useMemo(() => {
    const map = new Map<string, Monster>();
    for (const m of state.monsters) map.set(`${m.at.x},${m.at.y}`, m);
    return map;
  }, [state.monsters]);

  const heroByCell = useMemo(() => {
    const map = new Map<string, Hero>();
    for (const h of state.heroes) if (h.body > 0) map.set(`${h.at.x},${h.at.y}`, h);
    return map;
  }, [state.heroes]);

  const furnByCell = useMemo(() => {
    const map = new Map<string, HQFurniture>();
    for (const f of state.furniture) for (const c of f.cells) map.set(`${c.x},${c.y}`, f);
    return map;
  }, [state.furniture]);

  // ---- Movement highlight: ONLY the orthogonally-adjacent squares the hero can
  // step into right now. Movement is step-by-step (one square per click, never
  // diagonal) so each step is deliberate and triggers any trap on that square. ----
  const reachable = useMemo(() => {
    const out = new Set<string>();
    if (!isMyTurn || !myHero) return out;
    if (myHero.moveLeft <= 0 || myHero.inPit) return out;
    const phaseWalls = !!myHero.phaseWalls;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = myHero.at.x + dx, ny = myHero.at.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const key = `${nx},${ny}`;
      const t = state.tiles[ny][nx];
      if (!phaseWalls) {
        if (t.kind === 'wall' || t.kind === 'blocked') continue;
        if (furnByCell.get(key)?.blocksMove) continue;
      }
      if (edgeBlocksMove(myHero.at.x, myHero.at.y, nx, ny, phaseWalls)) continue; // wall / closed door
      if (monsterByCell.has(key)) continue;  // monsters block
      if (heroByCell.has(key)) continue;     // can't step onto another hero
      out.add(key);
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, myHero, state.tiles, doorByEdge, monsterByCell, heroByCell, furnByCell, W, H]);

  // ---- Doors the active hero can open: a closed, visible door with the hero
  // standing on one of its squares (the doorway). ----
  const openableDoors = useMemo(() => {
    const out: HQDoor[] = [];
    if (!isMyTurn || !myHero) return out;
    for (const d of state.doors) {
      if (d.open || (d.secret && !d.found)) continue;
      const onDoorway = d.crossings.some(c =>
        (c.a.x === myHero.at.x && c.a.y === myHero.at.y) ||
        (c.b.x === myHero.at.x && c.b.y === myHero.at.y));
      if (onDoorway) out.push(d);
    }
    return out;
  }, [isMyTurn, myHero, state.doors]);

  // ---- Per-room flooring: greedy graph-coloring so that no two rooms that
  // touch (orthogonally or diagonally) share the same shade. ----
  const roomColorIdx = useMemo(() => {
    const reg = (x: number, y: number) => state.tiles[y]?.[x]?.region ?? '';
    const adj = new Map<string, Set<string>>();
    const rooms = new Set<string>();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = reg(x, y);
      if (!r.startsWith('room_')) continue;
      rooms.add(r);
      if (!adj.has(r)) adj.set(r, new Set());
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nr = reg(x + dx, y + dy);
        if (nr.startsWith('room_') && nr !== r) adj.get(r)!.add(nr);
      }
    }
    const num = (r: string) => parseInt(r.slice('room_'.length), 10) || 0;
    const order = [...rooms].sort((a, b) => num(a) - num(b));
    const color = new Map<string, number>();
    const N = ROOM_FLOORS.length;
    const usage = new Array(N).fill(0);
    for (const r of order) {
      const taken = new Set<number>();
      for (const nb of adj.get(r) ?? []) { const c = color.get(nb); if (c !== undefined) taken.add(c); }
      // Pick the LEAST-used floor not used by a neighbor — spreads all the
      // looks across the board while keeping touching rooms distinct.
      let best = 0, bestUse = Infinity;
      for (let i = 0; i < N; i++) {
        if (taken.has(i)) continue;
        if (usage[i] < bestUse) { bestUse = usage[i]; best = i; }
      }
      color.set(r, best);
      usage[best]++;
    }
    return color;
  }, [state.tiles, W, H]);

  // Debug: illuminate the whole map (ignores fog + torchlight) so the full
  // layout is visible while building/testing. Toggled by the ☀ button.
  const [litAll, setLitAll] = useState(false);

  // ---- Torchlight: which cells are *currently* lit (within Chebyshev 5 of
  // ANY living hero) vs revealed-but-dim vs unrevealed. Using "any hero" so
  // the whole party emits light — important for multi-hero parties where
  // someone's always close to the action. ----
  function lightLevel(x: number, y: number): 'lit' | 'dim' | 'fog' {
    if (litAll) return 'lit';
    const tile = state.tiles[y][x];
    if (!tile.revealed) return 'fog';
    for (const h of state.heroes) {
      if (h.body <= 0) continue;
      const cheb = Math.max(Math.abs(x - h.at.x), Math.abs(y - h.at.y));
      if (cheb <= 5) return 'lit';
    }
    return 'dim';
  }

  // ---- Zoom / fit-to-screen ----
  // The board can be large (e.g. 32×23). Default to a "fit" zoom that shows the
  // whole board with no scrolling; the +/− buttons let you zoom in to inspect.
  const boardW = W * TILE_PX, boardH = H * TILE_PX;
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const [userZoom, setUserZoom] = useState<number | null>(null); // null = follow fit
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      // Subtract the container padding (p-1 = 4px each side) so the fully-laid
      // board fits inside without triggering the scrollbar.
      const availW = el.clientWidth - 8;
      const availH = el.clientHeight - 8;
      // *0.96 leaves a small border area around the board.
      setFitZoom(Math.max(0.2, Math.min(availW / boardW, availH / boardH, 2.5) * 0.96));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [boardW, boardH]);
  const zoom = userZoom ?? fitZoom;
  const fitMode = userZoom === null;
  const stepZoom = (factor: number) => setUserZoom(z => Math.max(0.25, Math.min(2.5, (z ?? fitZoom) * factor)));

  return (
    <div
      ref={containerRef}
      className="relative overflow-auto bg-black p-1"
      style={{
        maxWidth: '100%',
        // Fills its grid column (one screen tall). Actions/character panels live
        // in the right column now, so nothing sits below the board to scroll.
        height: '100%',
        background: 'radial-gradient(ellipse at center, #0a0805 0%, #000 100%)',
        boxShadow: 'inset 0 0 80px rgba(0,0,0,0.95)',
        // Center the board in the area (with the *0.96 fit it has a small border);
        // `safe` keeps it scroll-reachable rather than clipped when zoomed in.
        display: 'flex',
        alignItems: 'safe center',
        justifyContent: 'safe center',
      }}
    >
      {/* Zoom controls — absolutely positioned so they overlay the board corner
          instead of consuming board height. */}
      <div className="absolute top-2 right-2 z-20 flex gap-1">
        <ZoomBtn onClick={() => stepZoom(1 / 1.2)} title="Zoom out">−</ZoomBtn>
        <ZoomBtn onClick={() => setUserZoom(null)} title="Fit to screen" active={fitMode}>⤢</ZoomBtn>
        <ZoomBtn onClick={() => stepZoom(1.2)} title="Zoom in">+</ZoomBtn>
        <ZoomBtn onClick={() => setLitAll(v => !v)} title="Illuminate entire map (debug)" active={litAll}>☀</ZoomBtn>
      </div>

      {/* Size-reserving wrapper so the scroll area matches the scaled board. */}
      <div style={{ width: boardW * zoom, height: boardH * zoom, flexShrink: 0 }}>
      <div
        className="relative"
        style={{
          width: W * TILE_PX,
          height: H * TILE_PX,
          imageRendering: 'pixelated',
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
        }}
      >
        {/* Tile layer */}
        {state.tiles.flatMap((row, y) =>
          row.map((tile, x) => {
            const key = `${x},${y}`;
            const level = lightLevel(x, y);
            const isReach = reachable.has(key);
            const isClickable = isReach;
            // Render the appropriate sub-tile (doors/walls are drawn as an
            // overlay on the cell boundaries, not as tiles).
            let tileArt: React.ReactNode = null;
            if (tile.kind === 'wall' || tile.kind === 'blocked') {
              // Solid rock renders as nothing (the dark board shows through), so
              // the hallways form the outer border — no surrounding brick.
              tileArt = null;
            } else if (tile.kind === 'stairs') {
              tileArt = <StairsTile size={TILE_PX} />;
            } else if (tile.region.startsWith('room_')) {
              // Each room a distinct (color, pattern), spread so neighbors differ.
              const f = ROOM_FLOORS[(roomColorIdx.get(tile.region) ?? 0) % ROOM_FLOORS.length];
              tileArt = <FloorCell size={TILE_PX} gx={x} gy={y} style={f.style} tl={f.tl} br={f.br} />;
            } else {
              // Corridors / stairway floor → light grey broken slate.
              tileArt = <FloorCell size={TILE_PX} gx={x} gy={y} style={CORRIDOR_FLOOR.style} tl={CORRIDOR_FLOOR.tl} br={CORRIDOR_FLOOR.br} />;
            }
            return (
              <div
                key={key}
                className="absolute"
                style={{
                  left: x * TILE_PX,
                  top:  y * TILE_PX,
                  width: TILE_PX,
                  height: TILE_PX,
                  cursor: !disabled && isClickable ? 'pointer' : 'default',
                  zIndex: 1,
                }}
                onClick={() => {
                  if (disabled) return;
                  if (isReach) onMoveTo({ x, y });
                }}
                title={tile.revealed ? `${tile.region} (${x},${y})` : 'Unexplored'}
              >
                {tileArt}
                {/* Lighting overlay */}
                {level === 'fog' && (
                  <div className="absolute inset-0" style={{ background: HQ_COLORS.fog }} />
                )}
                {level === 'dim' && (
                  <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.55)' }} />
                )}
                {/* Yellow ring on a reachable cell */}
                {isReach && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      boxShadow: 'inset 0 0 0 2px rgba(255,200,30,0.85), 0 0 14px rgba(255,200,30,0.4)',
                    }}
                  />
                )}
              </div>
            );
          }),
        )}

        {/* Wall + door overlay — drawn on the LINES between cells. */}
        <WallDoorOverlay
          state={state}
          isWallEdge={isWallEdge}
          doorAtEdge={doorAtEdge}
          openable={openableDoors}
          disabled={disabled}
          onOpenDoor={onOpenDoor}
          revealAll={litAll}
        />

        {/* Furniture layer */}
        {state.furniture.map(f =>
          f.cells.map((c, i) => {
            const tile = state.tiles[c.y]?.[c.x];
            if (!tile?.revealed) return null;
            const level = lightLevel(c.x, c.y);
            return (
              <div
                key={`${f.id}-${i}`}
                className="pointer-events-none absolute"
                style={{
                  left: c.x * TILE_PX, top: c.y * TILE_PX,
                  width: TILE_PX, height: TILE_PX,
                  zIndex: 3,
                  filter: level === 'dim' ? 'brightness(0.55)' : undefined,
                }}
              >
                <FurnitureToken kind={f.kind} size={TILE_PX} searched={f.searched} />
              </div>
            );
          }),
        )}

        {/* Trap layer */}
        {state.traps.map(t => {
          const tile = state.tiles[t.at.y]?.[t.at.x];
          if (!tile?.revealed || !t.revealed) return null;
          return (
            <div
              key={t.id}
              className="pointer-events-none absolute flex items-center justify-center"
              style={{ left: t.at.x * TILE_PX, top: t.at.y * TILE_PX, width: TILE_PX, height: TILE_PX, zIndex: 3 }}
            >
              <span style={{ fontSize: TILE_PX * 0.7 }}>
                {t.kind === 'pit' ? '🕳️' : t.kind === 'spear' ? '🗡️' : '🧱'}
              </span>
            </div>
          );
        })}

        {/* Monsters */}
        {state.monsters.map(m => {
          const tile = state.tiles[m.at.y]?.[m.at.x];
          if (!tile?.revealed) return null;
          const level = lightLevel(m.at.x, m.at.y);
          const adj = myHero && Math.abs(myHero.at.x - m.at.x) + Math.abs(myHero.at.y - m.at.y) === 1;
          // In spell-targeting mode every visible monster is selectable;
          // otherwise only an adjacent monster is attackable.
          const spellPick = spellTargetMonsters && isMyTurn && !!myHero;
          const targetable = spellPick || (isMyTurn && myHero && !myHero.hasActed && adj);
          return (
            <div
              key={m.id}
              className="absolute"
              style={{
                left: m.at.x * TILE_PX,
                top:  m.at.y * TILE_PX,
                width: TILE_PX,
                height: TILE_PX,
                zIndex: 5,
                cursor: targetable && !disabled ? 'pointer' : 'default',
                filter: level === 'dim' ? 'brightness(0.6)' : undefined,
                transition: 'left 0.25s ease-out, top 0.25s ease-out',
              }}
              onClick={() => {
                if (!targetable || disabled) return;
                if (spellPick) onPickMonster?.(m.id);
                else onAttack(m.id);
              }}
              title={`${m.displayName ?? MONSTER_STATS[m.kind]?.displayName ?? m.kind} — BP ${m.body}/${m.bodyMax}, Atk ${m.attack}, Def ${m.defense}, Move ${MONSTER_STATS[m.kind]?.move ?? m.move}, Mind ${MONSTER_STATS[m.kind]?.mind ?? 0}`}
            >
              <MonsterToken kind={m.kind} size={TILE_PX} />
              {targetable && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    boxShadow: '0 0 0 2px rgba(214,16,16,0.95), 0 0 14px rgba(214,16,16,0.6)',
                    borderRadius: '50%',
                    animation: 'hq-pulse 1s ease-in-out infinite',
                  }}
                />
              )}
              <div
                className="absolute -bottom-1 left-0 right-0 text-center font-bold"
                style={{ fontSize: 10, color: '#fff', textShadow: '0 0 3px #000, 0 0 3px #000' }}
              >
                {m.body}
              </div>
            </div>
          );
        })}

        {/* Heroes */}
        {state.heroes.map(h => {
          if (h.body <= 0) return null;
          const isActive = activeHero?.playerId === h.playerId;
          return (
            <div
              key={h.playerId}
              className="absolute"
              style={{
                left: h.at.x * TILE_PX,
                top:  h.at.y * TILE_PX,
                width: TILE_PX,
                height: TILE_PX,
                zIndex: 6,
                transition: 'left 0.18s ease-out, top 0.18s ease-out',
              }}
              title={`${h.username} — BP ${h.body}/${h.bodyMax}`}
            >
              <HeroToken
                klass={h.klass}
                size={TILE_PX}
                color={safeAccent(h.accent_color)}
                ring={isActive ? safeAccent(h.accent_color) : undefined}
              />
              {isActive && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    boxShadow: `0 0 0 2px ${safeAccent(h.accent_color)}, 0 0 18px ${safeAccent(h.accent_color)}`,
                    borderRadius: '50%',
                  }}
                />
              )}
              <div
                className="absolute -bottom-1 left-0 right-0 text-center font-bold"
                style={{ fontSize: 10, color: '#fff', textShadow: '0 0 3px #000, 0 0 3px #000' }}
              >
                {h.body}
              </div>
            </div>
          );
        })}

        {/* Torch halo overlay on every living hero (mixes naturally where
            two heroes are near each other). */}
        {state.heroes.filter(h => h.body > 0).map(h => (
          <div
            key={`torch-${h.seat}`}
            className="pointer-events-none absolute"
            style={{
              left: h.at.x * TILE_PX + TILE_PX / 2 - TILE_PX * 5,
              top:  h.at.y * TILE_PX + TILE_PX / 2 - TILE_PX * 5,
              width: TILE_PX * 10,
              height: TILE_PX * 10,
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(255,184,77,0.18) 0%, rgba(255,184,77,0.08) 30%, rgba(0,0,0,0) 70%)`,
              mixBlendMode: 'screen',
              zIndex: 4,
            }}
          />
        ))}
      </div>
      </div>

      {/* Inline keyframes — kept here so the board chunk owns its CSS. */}
      <style>{`
        @keyframes hq-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}

function ZoomBtn({ onClick, title, active, children }: {
  onClick: () => void; title: string; active?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded border text-sm font-bold transition ${
        active
          ? 'border-amber-400 bg-amber-500/30 text-amber-100'
          : 'border-amber-900/70 bg-black/70 text-amber-200 hover:border-amber-400 hover:bg-amber-500/20'
      }`}
    >{children}</button>
  );
}

// ============================================================================
// Wall + door overlay — walls and doors live on the LINES between cells.
// ============================================================================

function WallDoorOverlay({
  state, isWallEdge, doorAtEdge, openable, disabled, onOpenDoor, revealAll = false,
}: {
  state: HQState;
  isWallEdge: (ax: number, ay: number, bx: number, by: number) => boolean;
  doorAtEdge: (ax: number, ay: number, bx: number, by: number) => HQDoor | undefined;
  openable: HQDoor[];
  disabled: boolean;
  onOpenDoor: (id: string) => void;
  /** Debug blueprint mode: draw every wall/door regardless of fog. */
  revealAll?: boolean;
}) {
  const W = state.quest.width, H = state.quest.height;
  const openableIds = new Set(openable.map(d => d.id));
  const revealed = (x: number, y: number) => revealAll || !!state.tiles[y]?.[x]?.revealed;
  const T = 4; // wall thickness (px) — uniform on every wall so they're unmistakable
  const segments: React.ReactNode[] = [];

  // Solid near-black wall, clearly thicker than the per-space grid lines.
  const wall = (key: string, style: CSSProperties) =>
    segments.push(<div key={key} className="pointer-events-none absolute" style={{ ...style, background: '#140a06', borderRadius: 1, zIndex: 3 }} />);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // East edge: between (x,y) and (x+1,y) — a vertical line.
      if (x + 1 < W && (revealed(x, y) || revealed(x + 1, y))) {
        const door = doorAtEdge(x, y, x + 1, y);
        const hidden = door?.secret && !door.found;
        if (door && !hidden) {
          segments.push(<DoorSeg key={`d-e-${x}-${y}`} vertical left={(x + 1) * TILE_PX} top={y * TILE_PX}
            open={door.open} openable={openableIds.has(door.id)} disabled={disabled} onOpen={() => onOpenDoor(door.id)} />);
        } else if (isWallEdge(x, y, x + 1, y)) {
          wall(`w-e-${x}-${y}`, { left: (x + 1) * TILE_PX - T / 2, top: y * TILE_PX, width: T, height: TILE_PX });
        }
      }
      // South edge: between (x,y) and (x,y+1) — a horizontal line.
      if (y + 1 < H && (revealed(x, y) || revealed(x, y + 1))) {
        const door = doorAtEdge(x, y, x, y + 1);
        const hidden = door?.secret && !door.found;
        if (door && !hidden) {
          segments.push(<DoorSeg key={`d-s-${x}-${y}`} left={x * TILE_PX} top={(y + 1) * TILE_PX}
            open={door.open} openable={openableIds.has(door.id)} disabled={disabled} onOpen={() => onOpenDoor(door.id)} />);
        } else if (isWallEdge(x, y, x, y + 1)) {
          wall(`w-s-${x}-${y}`, { left: x * TILE_PX, top: (y + 1) * TILE_PX - T / 2, width: TILE_PX, height: T });
        }
      }
    }
  }
  return <>{segments}</>;
}

function DoorSeg({
  left, top, vertical = false, open, openable, disabled, onOpen,
}: {
  left: number; top: number; vertical?: boolean; open: boolean;
  openable: boolean; disabled: boolean; onOpen: () => void;
}) {
  const len = TILE_PX, thick = 8;
  const box: CSSProperties = vertical
    ? { left: left - thick / 2, top, width: thick, height: len }
    : { left, top: top - thick / 2, width: len, height: thick };
  return (
    <div
      className="absolute"
      style={{
        ...box,
        zIndex: 4,
        borderRadius: 2,
        background: open ? 'rgba(120,90,40,0.25)' : '#9a4a18',
        border: open ? '1px dashed rgba(180,140,80,0.6)' : '1.5px solid #4a2008',
        boxShadow: openable && !open ? '0 0 8px 2px rgba(255,160,40,0.9)' : undefined,
        cursor: openable && !disabled ? 'pointer' : 'default',
      }}
      onClick={() => { if (openable && !disabled) onOpen(); }}
      title={open ? 'Open doorway' : openable ? 'Closed door — click to open' : 'Closed door'}
    />
  );
}
