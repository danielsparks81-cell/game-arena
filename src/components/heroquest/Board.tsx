'use client';

// HeroQuest board canvas — stone tiles, torchlit fog of war, hero/monster
// tokens rendered as SVG portraits, click-to-move highlights.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  MONSTER_STATS,
  hasLineOfSight,
  type HQState,
  type Hero,
  type Monster,
  type Coord,
  type Door as HQDoor,
  type Furniture as HQFurniture,
} from '@/lib/games/heroquest';
import {
  FloorCell, StairsFan,
  HeroToken, MonsterToken,
  HQ_COLORS,
} from './Art';
import { FurnitureSvg } from './furnitureArt';
import { ROOM_FLOORS, CORRIDOR_FLOOR, assignRoomFloors } from './floors';
import { safeAccent } from '@/lib/accentColors';

export const TILE_PX = 36;

export type BoardCanvasProps = {
  state: HQState;
  currentUserId: string;
  disabled: boolean;
  onMoveTo: (at: Coord) => void;
  /** Drag movement: walk the traced square-by-square path. */
  onMovePath: (path: Coord[]) => void;
  onOpenDoor: (doorId: string) => void;
  onAttack: (monsterId: string) => void;
  /** When true, the board is in spell-targeting mode: every visible monster is
   *  clickable and routes to onPickMonster instead of the normal attack flow. */
  spellTargetMonsters?: boolean;
  onPickMonster?: (monsterId: string) => void;
};

export default function HeroQuestBoardCanvas({
  state, currentUserId, disabled, onMoveTo, onMovePath, onOpenDoor, onAttack,
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

  // ---- Movement highlight: every square reachable within the movement roll. ----
  // BFS along orthogonal steps that passes THROUGH friendly heroes (transit, per
  // the rules) but is blocked by monsters, walls, move-blocking furniture, and
  // closed doors. A friendly hero's own square is transit-only, not a valid
  // stopping cell, so it isn't highlighted. (You can also click an adjacent cell
  // to move one square at a time when you want to pick your exact path.) ----
  const reachable = useMemo(() => {
    const out = new Set<string>();
    if (!isMyTurn || !myHero) return out;
    if (myHero.moveLeft <= 0 || myHero.inPit) return out;
    const phaseWalls = !!myHero.phaseWalls;
    const startKey = `${myHero.at.x},${myHero.at.y}`;
    const dist = new Map<string, number>([[startKey, 0]]);
    const queue: Coord[] = [{ ...myHero.at }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = dist.get(`${cur.x},${cur.y}`)!;
      if (d >= myHero.moveLeft) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const key = `${nx},${ny}`;
        if (dist.has(key)) continue;
        const t = state.tiles[ny][nx];
        if (!phaseWalls) {
          if (t.kind === 'wall' || t.kind === 'blocked') continue;
          if (furnByCell.get(key)?.blocksMove) continue;
        }
        if (edgeBlocksMove(cur.x, cur.y, nx, ny, phaseWalls)) continue;  // walls / closed doors
        if (monsterByCell.has(key)) continue;        // monsters block
        dist.set(key, d + 1);
        queue.push({ x: nx, y: ny });
        if (!heroByCell.has(key)) out.add(key);      // can only STOP on an empty cell
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, myHero, state.tiles, doorByEdge, monsterByCell, heroByCell, furnByCell, W, H]);

  // ---- Drag movement: press on your hero and drag over squares to trace a path
  // (one orthogonal step per square). Release to walk it — the engine stops the
  // hero the moment it springs a trap or a new area comes into view. ----
  const canDrag = isMyTurn && !disabled && !!myHero && myHero.hasRolled && myHero.moveLeft > 0 && !myHero.inPit && !spellTargetMonsters;
  const [dragging, setDragging] = useState(false);
  const [dragPath, setDragPath] = useState<Coord[]>([]);
  const dragPathRef = useRef<Coord[]>([]);
  useEffect(() => { dragPathRef.current = dragPath; }, [dragPath]);

  const canStep = (from: Coord, to: Coord): boolean => {
    if (!myHero) return false;
    const phaseWalls = !!myHero.phaseWalls;
    if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) !== 1) return false;
    if (to.x < 0 || to.y < 0 || to.x >= W || to.y >= H) return false;
    const key = `${to.x},${to.y}`;
    if (!phaseWalls) {
      const t = state.tiles[to.y][to.x];
      if (t.kind === 'wall' || t.kind === 'blocked') return false;
      if (furnByCell.get(key)?.blocksMove) return false;
    }
    if (edgeBlocksMove(from.x, from.y, to.x, to.y, phaseWalls)) return false;
    if (monsterByCell.has(key)) return false; // monsters block (friendly heroes are transit)
    return true;
  };

  const dragStepOf = (x: number, y: number) => dragPath.findIndex(p => p.x === x && p.y === y);

  // While dragging, follow the pointer/finger across cells (works for mouse and
  // touch via elementFromPoint) and commit the path on release.
  useEffect(() => {
    if (!dragging || !myHero) return;
    const start = myHero.at;
    const cellAt = (e: PointerEvent): Coord | null => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const cellEl = el?.closest('[data-hqcell]') as HTMLElement | null;
      if (!cellEl?.dataset.hqcell) return null;
      const [x, y] = cellEl.dataset.hqcell.split(',').map(Number);
      return { x, y };
    };
    const onMove = (e: PointerEvent) => {
      const cell = cellAt(e);
      if (!cell) return;
      setDragPath(prev => {
        const last = prev.length ? prev[prev.length - 1] : start;
        if (last.x === cell.x && last.y === cell.y) return prev;
        // Backtrack: dragging onto the previous square removes the last step.
        const beforeLast = prev.length > 1 ? prev[prev.length - 2] : start;
        if (cell.x === beforeLast.x && cell.y === beforeLast.y) return prev.slice(0, -1);
        if (prev.length >= myHero.moveLeft) return prev;        // out of movement
        if (prev.some(p => p.x === cell.x && p.y === cell.y)) return prev; // no loops
        if (!canStep(last, cell)) return prev;
        return [...prev, cell];
      });
    };
    const onUp = () => {
      setDragging(false);
      const p = dragPathRef.current;
      setDragPath([]);
      if (p.length > 0) onMovePath(p);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

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

  // ---- Per-room flooring: every room gets its OWN (colour, pattern), so no two
  // rooms ever render the same tiles. Rooms are assigned in room-number order
  // straight down the palette; if a quest somehow has more rooms than palette
  // entries, the extras get a deterministic muted variation (shifted shade +
  // rotated pattern) so they stay unique rather than wrapping back to a repeat. ----
  const roomFloor = useMemo(() => {
    const reg = (x: number, y: number) => state.tiles[y]?.[x]?.region ?? '';
    const rooms = new Set<string>();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = reg(x, y);
      if (r.startsWith('room_')) rooms.add(r);
    }
    const num = (r: string) => parseInt(r.slice('room_'.length), 10) || 0;
    return assignRoomFloors([...rooms].sort((a, b) => num(a) - num(b)));
  }, [state.tiles, W, H]);

  // Staircase footprint(s): each connected block of stair tiles is drawn as ONE
  // classic fan (a 2×2 staircase reads as a single staircase). `revealed` gates
  // it behind the fog like everything else.
  const stairGroups = useMemo(() => {
    const seen = state.tiles.map(r => r.map(() => false));
    const groups: { x: number; y: number; w: number; h: number; revealed: boolean }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (state.tiles[y][x].kind !== 'stairs' || seen[y][x]) continue;
      let minX = x, maxX = x, minY = y, maxY = y, revealed = false;
      const stack: [number, number][] = [[x, y]]; seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        if (state.tiles[cy][cx].revealed) revealed = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen[ny][nx] && state.tiles[ny][nx].kind === 'stairs') { seen[ny][nx] = true; stack.push([nx, ny]); }
        }
      }
      groups.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, revealed });
    }
    return groups;
  }, [state.tiles, W, H]);

  // Debug: illuminate the whole map (ignores fog + torchlight) so the full
  // layout is visible while building/testing. Toggled by the ☀ button.
  const [litAll, setLitAll] = useState(false);

  // ---- Visibility: in HeroQuest a tile is either explored (placed on the board
  // and fully visible) or not yet seen (fog). What gets REVEALED is driven by
  // line of sight in the engine ("looking"); once revealed it stays visible, so
  // there's no torch-dimming here. ----
  function lightLevel(x: number, y: number): 'lit' | 'fog' {
    if (litAll) return 'lit';
    return state.tiles[y][x].revealed ? 'lit' : 'fog';
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
      className="relative bg-black p-1"
      style={{
        // In fit mode the board always fits, so never show a scrollbar; only
        // allow scrolling/panning when the user has manually zoomed in.
        overflow: fitMode ? 'hidden' : 'auto',
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
        className="relative select-none"
        onDragStart={(e) => e.preventDefault()}
        style={{
          width: W * TILE_PX,
          height: H * TILE_PX,
          imageRendering: 'pixelated',
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          // @ts-expect-error - vendor prop to stop native image dragging on press
          WebkitUserDrag: 'none',
          touchAction: 'none',
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
              // Plain stone base; the staircase fan is drawn as one overlay below.
              tileArt = <div style={{ width: TILE_PX, height: TILE_PX, background: '#5b636e' }} />;
            } else if (tile.region.startsWith('room_')) {
              // Each room a UNIQUE (color, pattern) — no two rooms share tiles.
              const f = roomFloor.get(tile.region) ?? ROOM_FLOORS[0];
              tileArt = <FloorCell size={TILE_PX} gx={x} gy={y} style={f.style} tl={f.tl} br={f.br} />;
            } else {
              // Corridors / stairway floor → light grey broken slate.
              tileArt = <FloorCell size={TILE_PX} gx={x} gy={y} style={CORRIDOR_FLOOR.style} tl={CORRIDOR_FLOOR.tl} br={CORRIDOR_FLOOR.br} />;
            }
            const isHeroCell = !!myHero && x === myHero.at.x && y === myHero.at.y;
            const dragStep = dragStepOf(x, y);
            return (
              <div
                key={key}
                data-hqcell={key}
                className="absolute"
                style={{
                  left: x * TILE_PX,
                  top:  y * TILE_PX,
                  width: TILE_PX,
                  height: TILE_PX,
                  cursor: canDrag && isHeroCell ? 'grab' : (!disabled && isClickable ? 'pointer' : 'default'),
                  touchAction: 'none',
                  zIndex: 1,
                }}
                onPointerDown={(e) => {
                  if (canDrag && isHeroCell) {
                    e.preventDefault();
                    setDragging(true);
                    setDragPath([]);
                  }
                }}
                onClick={() => {
                  if (disabled) return;
                  if (isReach) onMoveTo({ x, y });
                }}
                title={tile.revealed ? `${tile.region} (${x},${y})` : 'Unexplored'}
              >
                {tileArt}
                {/* Fog over unexplored tiles; explored tiles stay fully visible. */}
                {level === 'fog' && (
                  <div className="absolute inset-0" style={{ background: HQ_COLORS.fog }} />
                )}
                {/* Yellow ring on a reachable cell (hidden while dragging a path) */}
                {isReach && !dragging && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      boxShadow: 'inset 0 0 0 2px rgba(255,200,30,0.85), 0 0 14px rgba(255,200,30,0.4)',
                    }}
                  />
                )}
                {/* Drag path trail + step number */}
                {dragStep >= 0 && (
                  <div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    style={{ background: 'rgba(80,200,255,0.28)', boxShadow: 'inset 0 0 0 2px rgba(120,220,255,0.9)' }}
                  >
                    <span className="font-bold text-white" style={{ fontSize: TILE_PX * 0.4, textShadow: '0 1px 2px #000' }}>
                      {dragStep + 1}
                    </span>
                  </div>
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

        {/* Staircase fan(s) — one classic fan per connected stair block (fog-gated). */}
        {stairGroups.map((g, i) => (litAll || g.revealed) ? (
          <div
            key={`stairfan-${i}`}
            className="pointer-events-none absolute"
            style={{ left: g.x * TILE_PX, top: g.y * TILE_PX, width: g.w * TILE_PX, height: g.h * TILE_PX, zIndex: 2 }}
          >
            <StairsFan w={g.w * TILE_PX} h={g.h * TILE_PX} />
          </div>
        ) : null)}

        {/* Furniture layer — one piece across its whole footprint (flat top-down
            or oblique "table angle" per kind), shown once any cell is revealed. */}
        {state.furniture.map(f => {
          if (!litAll && !f.cells.some(c => state.tiles[c.y]?.[c.x]?.revealed)) return null;
          const xs = f.cells.map(c => c.x), ys = f.cells.map(c => c.y);
          const minX = Math.min(...xs), minY = Math.min(...ys);
          const fw = Math.max(...xs) - minX + 1, fh = Math.max(...ys) - minY + 1;
          return (
            <div
              key={f.id}
              className="pointer-events-none absolute"
              style={{ left: minX * TILE_PX, top: minY * TILE_PX, width: fw * TILE_PX, height: fh * TILE_PX, zIndex: 3, opacity: f.searched ? 0.6 : 1 }}
            >
              <FurnitureSvg kind={f.kind} w={fw} h={fh} rot={f.facing ?? 0} cell={TILE_PX} />
            </div>
          );
        })}

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
          // Attackable target: a melee weapon hits an adjacent monster (diagonal
          // too if the weapon allows); a ranged weapon hits any monster in line
          // of sight. Only those highlight, so you can't click an unreachable one.
          const dxm = myHero ? Math.abs(myHero.at.x - m.at.x) : 99;
          const dym = myHero ? Math.abs(myHero.at.y - m.at.y) : 99;
          const allowDiag = !!myHero?.items.some(i => i.diagonal);
          const allowRanged = !!myHero?.items.some(i => i.ranged);
          const meleeAdj = (dxm + dym === 1) || (allowDiag && dxm === 1 && dym === 1);
          const losToM = !!myHero && hasLineOfSight(state, myHero.at, m.at);
          const attackable = isMyTurn && !!myHero && !myHero.hasActed && (meleeAdj || (allowRanged && losToM));
          // Spell-targeting mode: only a monster the caster can SEE (line of
          // sight) is selectable — unseen monsters aren't targetable, so the
          // spell can't be wasted.
          const spellPick = spellTargetMonsters && isMyTurn && !!myHero && losToM;
          const targetable = spellPick || attackable;
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
              className="pointer-events-none absolute"
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
