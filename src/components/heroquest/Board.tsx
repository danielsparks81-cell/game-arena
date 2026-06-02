'use client';

// HeroQuest board canvas — stone tiles, torchlit fog of war, hero/monster
// tokens rendered as SVG portraits, click-to-move highlights.

import { useMemo } from 'react';
import {
  type HQState,
  type Hero,
  type Monster,
  type Coord,
  type Door as HQDoor,
  type Furniture as HQFurniture,
} from '@/lib/games/heroquest';
import {
  WallTile, FloorTile, DoorTile, StairsTile,
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

  // ---- Indexes ----
  const doorByCell = useMemo(() => {
    const map = new Map<string, HQDoor>();
    for (const d of state.doors) {
      const mx = Math.round((d.a.x + d.b.x) / 2);
      const my = Math.round((d.a.y + d.b.y) / 2);
      map.set(`${mx},${my}`, d);
    }
    return map;
  }, [state.doors]);

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

  // ---- Movement highlight (one-step reachable cells from the active hero) ----
  const reachable = useMemo(() => {
    const out = new Set<string>();
    if (!isMyTurn || !myHero) return out;
    if (myHero.moveLeft <= 0 || myHero.inPit) return out;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = myHero.at.x + dx, ny = myHero.at.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const t = state.tiles[ny][nx];
      if (t.kind === 'wall' || t.kind === 'blocked') continue;
      if (t.kind === 'door') {
        const d = doorByCell.get(`${nx},${ny}`);
        if (!d || !d.open) continue;
      }
      if (monsterByCell.has(`${nx},${ny}`)) continue;
      if (heroByCell.has(`${nx},${ny}`)) continue;
      out.add(`${nx},${ny}`);
    }
    return out;
  }, [isMyTurn, myHero, state.tiles, doorByCell, monsterByCell, heroByCell, W, H]);

  // ---- Adjacent closed doors (clickable to open) ----
  const adjacentDoor = useMemo(() => {
    const out: Array<{ door: HQDoor; cell: Coord }> = [];
    if (!isMyTurn || !myHero) return out;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = myHero.at.x + dx, ny = myHero.at.y + dy;
      const d = doorByCell.get(`${nx},${ny}`);
      if (d && !d.open && (d.found || !d.secret)) out.push({ door: d, cell: { x: nx, y: ny } });
    }
    return out;
  }, [isMyTurn, myHero, doorByCell]);

  const adjacentDoorSet = useMemo(
    () => new Set(adjacentDoor.map(d => `${d.cell.x},${d.cell.y}`)),
    [adjacentDoor],
  );

  // ---- Tile variant stable per cell (so the floor doesn't shimmer on rerender) ----
  function floorVariant(x: number, y: number) {
    return (x * 7 + y * 13) % 3;
  }

  // ---- Determine door orientation (horizontal/vertical plank). ----
  function doorOrientation(d: HQDoor): boolean {
    // If the two regions a/b differ in y, the door is on a horizontal wall.
    return d.a.y !== d.b.y;
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
            const door = doorByCell.get(key);
            const level = lightLevel(x, y);
            const isReach = reachable.has(key);
            const isAdjDoor = adjacentDoorSet.has(key);
            const isClickable = isReach || isAdjDoor;
            // Render the appropriate sub-tile.
            let tileArt: React.ReactNode = null;
            if (tile.kind === 'wall' || tile.kind === 'blocked') {
              tileArt = <WallTile size={TILE_PX} />;
            } else if (tile.kind === 'door') {
              tileArt = <DoorTile size={TILE_PX} open={!!door?.open} horizontal={door ? doorOrientation(door) : true} />;
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
                  if (isReach)    onMoveTo({ x, y });
                  else if (isAdjDoor) {
                    const d = doorByCell.get(key);
                    if (d) onOpenDoor(d.id);
                  }
                }}
                title={
                  tile.revealed
                    ? `${tile.region} (${x},${y})${door ? door.open ? ' • open door' : ' • closed door' : ''}`
                    : 'Unexplored'
                }
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
                {/* Amber ring on an adjacent door */}
                {isAdjDoor && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      boxShadow: 'inset 0 0 0 2px rgba(255,150,30,0.85)',
                      animation: 'hq-pulse 1.5s ease-in-out infinite',
                    }}
                  />
                )}
              </div>
            );
          }),
        )}

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
              title={`${m.displayName ?? m.kind} — BP ${m.body}/${m.bodyMax}, Atk ${m.attack}, Def ${m.defense}`}
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
