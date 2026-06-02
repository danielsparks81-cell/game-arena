'use client';

// HeroQuest board canvas — stone tiles, torchlit fog of war, hero/monster
// tokens rendered as SVG portraits, click-to-move highlights.

import { useMemo, type CSSProperties } from 'react';
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
  WallTile, FloorTile, StairsTile,
  HeroToken, MonsterToken, FurnitureToken,
  HQ_COLORS,
} from './Art';
import { safeAccent } from '@/lib/accentColors';

export const TILE_PX = 36;

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

  // ---- Movement highlight: every cell reachable within the movement roll. ----
  // BFS that passes THROUGH friendly heroes (transit) but is blocked by
  // monsters, walls, move-blocking furniture, and closed doors. A friendly
  // hero's own square is reachable-for-transit but not a valid stopping cell,
  // so it isn't highlighted. Pass Through Rock ignores wall/furniture blockers.
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
        if (monsterByCell.has(key)) continue;       // monsters block
        dist.set(key, d + 1);
        queue.push({ x: nx, y: ny });
        if (!heroByCell.has(key)) out.add(key);      // can only STOP on an empty cell
      }
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

  // ---- Tile variant stable per cell (so the floor doesn't shimmer on rerender) ----
  function floorVariant(x: number, y: number) {
    return (x * 7 + y * 13) % 3;
  }

  // ---- Torchlight: which cells are *currently* lit (within Chebyshev 5 of
  // ANY living hero) vs revealed-but-dim vs unrevealed. Using "any hero" so
  // the whole party emits light — important for multi-hero parties where
  // someone's always close to the action. ----
  function lightLevel(x: number, y: number): 'lit' | 'dim' | 'fog' {
    const tile = state.tiles[y][x];
    if (!tile.revealed) return 'fog';
    for (const h of state.heroes) {
      if (h.body <= 0) continue;
      const cheb = Math.max(Math.abs(x - h.at.x), Math.abs(y - h.at.y));
      if (cheb <= 5) return 'lit';
    }
    return 'dim';
  }

  return (
    <div
      className="relative overflow-auto rounded-xl border-2 border-amber-900/70 bg-black p-3"
      style={{
        maxWidth: '100%',
        maxHeight: '78vh',
        background: 'radial-gradient(ellipse at center, #0a0805 0%, #000 100%)',
        boxShadow: 'inset 0 0 80px rgba(0,0,0,0.95)',
      }}
    >
      <div
        className="relative"
        style={{
          width: W * TILE_PX,
          height: H * TILE_PX,
          imageRendering: 'pixelated',
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
              tileArt = <WallTile size={TILE_PX} />;
            } else if (tile.kind === 'stairs') {
              tileArt = <StairsTile size={TILE_PX} />;
            } else {
              tileArt = <FloorTile size={TILE_PX} variant={floorVariant(x, y)} />;
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

// ============================================================================
// Wall + door overlay — walls and doors live on the LINES between cells.
// ============================================================================

function WallDoorOverlay({
  state, isWallEdge, doorAtEdge, openable, disabled, onOpenDoor,
}: {
  state: HQState;
  isWallEdge: (ax: number, ay: number, bx: number, by: number) => boolean;
  doorAtEdge: (ax: number, ay: number, bx: number, by: number) => HQDoor | undefined;
  openable: HQDoor[];
  disabled: boolean;
  onOpenDoor: (id: string) => void;
}) {
  const W = state.quest.width, H = state.quest.height;
  const openableIds = new Set(openable.map(d => d.id));
  const revealed = (x: number, y: number) => !!state.tiles[y]?.[x]?.revealed;
  const T = 3; // wall thickness (px)
  const segments: React.ReactNode[] = [];

  const wall = (key: string, style: CSSProperties) =>
    segments.push(<div key={key} className="pointer-events-none absolute" style={{ ...style, background: '#2a1410', zIndex: 2 }} />);

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
