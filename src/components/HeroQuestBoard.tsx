'use client';

import { useMemo, useState } from 'react';
import {
  type HQState,
  type Hero,
  type HeroClass,
  type Monster,
  type Coord,
  type DieFace,
} from '@/lib/games/heroquest';
import { HERO_DEFAULTS, MONSTER_STATS } from '@/lib/games/heroquest';
import { safeAccent } from '@/lib/accentColors';

// ============================================================================
// Tile rendering constants
// ============================================================================

const TILE_PX = 28;

const TILE_COLORS: Record<string, string> = {
  wall:    '#1a1a1a',     // dark stone
  floor:   '#3b3a36',     // dungeon flagstone
  door_closed: '#7a5a2e', // wood
  door_open:   '#5b4318', // dark wood
  stairs:  '#444c5c',     // bluish stone
  unrevealed: '#000',     // fog
};

const HERO_ICON: Record<HeroClass, string> = {
  barbarian: '🪓',
  dwarf:     '⛏️',
  elf:       '🏹',
  wizard:    '🧙',
};

const MONSTER_ICON: Record<Monster['kind'], string> = {
  goblin:        '👺',
  orc:           '👹',
  fimir:         '🐊',
  skeleton:      '💀',
  zombie:        '🧟',
  mummy:         '🪦',
  chaos_warrior: '⚔️',
  gargoyle:      '🦇',
};

// ============================================================================
// Top-level component
// ============================================================================

export type HeroQuestBoardProps = {
  state: HQState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onSetClass: (klass: HeroClass) => void;
  onRandomClasses: () => void;
  onStart: () => void;
  onRollMove: () => void;
  onMoveTo: (at: Coord) => void;
  onOpenDoor: (doorId: string) => void;
  onAttack: (monsterId: string) => void;
  onSearchTreasure: () => void;
  onSearchTraps: () => void;
  onSearchSecrets: () => void;
  onClimbPit: () => void;
  onCastSpell: (spellId: string, opts?: { targetMonsterId?: string; targetHeroIdx?: number }) => void;
  onEndTurn: () => void;
};

export default function HeroQuestBoard(props: HeroQuestBoardProps) {
  const { state, isHost, currentUserId, disabled } = props;

  if (state.phase === 'lobby') {
    return <LobbyView {...props} />;
  }
  if (state.phase === 'finished') {
    return <FinishedView state={state} />;
  }
  return <PlayingView {...props} />;
}

// ============================================================================
// Lobby
// ============================================================================

function LobbyView(props: HeroQuestBoardProps) {
  const { state, isHost, currentUserId, disabled, onSetClass, onRandomClasses, onStart } = props;
  const myHero = state.heroes.find(h => h.playerId === currentUserId);
  const classesTaken = new Set(state.heroes.map(h => h.klass));
  const canStart = isHost && state.heroes.length >= 1;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-900/60 bg-gradient-to-br from-amber-950/40 to-neutral-900 p-4">
        <h2 className="text-xl font-bold text-amber-300">HeroQuest — {state.quest.name}</h2>
        <p className="mt-2 text-sm text-neutral-300">{state.quest.briefing}</p>
        <p className="mt-2 text-xs text-amber-200/80">
          Choose a hero class, then the host starts the quest. Automated Zargon runs all
          monsters and traps for you — bring 1 to 4 heroes.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Party</div>
          <div className="flex gap-2">
            {isHost && (
              <button
                onClick={onRandomClasses}
                disabled={disabled}
                className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-50"
              >
                Randomise classes
              </button>
            )}
          </div>
        </div>
        <ul className="space-y-2">
          {state.heroes.map(h => (
            <li key={h.playerId} className="flex items-center gap-3 rounded-md bg-neutral-800/60 p-2">
              <span className="text-xl">{HERO_ICON[h.klass]}</span>
              <span className="font-medium" style={{ color: safeAccent(h.accent_color) }}>{h.username}</span>
              <span className="ml-auto rounded-md bg-neutral-700/70 px-2 py-0.5 text-xs">
                {HERO_DEFAULTS[h.klass].name} ({h.bodyMax} BP / {h.mindMax} MP)
              </span>
            </li>
          ))}
        </ul>
      </div>

      {myHero && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-neutral-400">
            Pick your hero class
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['barbarian', 'dwarf', 'elf', 'wizard'] as HeroClass[]).map(klass => {
              const taken = classesTaken.has(klass) && myHero.klass !== klass;
              const me = myHero.klass === klass;
              const d = HERO_DEFAULTS[klass];
              return (
                <button
                  key={klass}
                  onClick={() => onSetClass(klass)}
                  disabled={disabled || taken}
                  className={`rounded-lg border p-2 text-left text-xs transition ${
                    me
                      ? 'border-amber-400 bg-amber-900/30 text-amber-100'
                      : taken
                      ? 'border-neutral-800 bg-neutral-900/40 opacity-40'
                      : 'border-neutral-700 bg-neutral-800 hover:border-amber-700/60 hover:bg-amber-900/20'
                  }`}
                >
                  <div className="text-2xl">{HERO_ICON[klass]}</div>
                  <div className="mt-1 font-semibold">{d.name}</div>
                  <div className="text-neutral-400">BP {d.bodyMax} • MP {d.mindMax}</div>
                  <div className="text-neutral-400">Atk {d.baseAttack} • Def {d.baseDefense}</div>
                  <div className="mt-1 text-[10px] text-neutral-500">{d.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isHost && (
        <button
          onClick={onStart}
          disabled={!canStart || disabled}
          className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {canStart ? 'Begin the quest' : 'Waiting for at least 1 hero…'}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Playing
// ============================================================================

function PlayingView(props: HeroQuestBoardProps) {
  const { state, currentUserId, disabled } = props;
  const myHero = state.heroes.find(h => h.playerId === currentUserId);
  const activeHero = state.heroes[state.turnIndex];
  const isMyTurn = activeHero?.playerId === currentUserId;

  const [selectedMonster, setSelectedMonster] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <TurnBanner state={state} myHeroPid={currentUserId} />
      <div className="grid gap-3 lg:grid-cols-[auto,18rem]">
        <BoardCanvas
          state={state}
          currentUserId={currentUserId}
          disabled={disabled || !isMyTurn}
          onMoveTo={props.onMoveTo}
          onOpenDoor={props.onOpenDoor}
          onAttack={(mid) => { setSelectedMonster(mid); props.onAttack(mid); }}
          selectedMonster={selectedMonster}
        />
        <SidePanel
          {...props}
          isMyTurn={isMyTurn}
          myHero={myHero}
        />
      </div>
      <LogView state={state} />
    </div>
  );
}

function TurnBanner({ state, myHeroPid }: { state: HQState; myHeroPid: string }) {
  const active = state.heroes[state.turnIndex];
  if (!active) return null;
  const isMe = active.playerId === myHeroPid;
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${
        isMe ? 'border-amber-500 bg-amber-900/30 text-amber-100' : 'border-neutral-800 bg-neutral-900 text-neutral-300'
      }`}
    >
      {isMe ? (
        <span><strong>Your turn.</strong> Roll movement, take one action, then end turn.</span>
      ) : (
        <span>
          <strong style={{ color: safeAccent(active.accent_color) }}>{active.username}</strong>
          {' '}is taking their turn ({HERO_DEFAULTS[active.klass].name}).
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Board canvas
// ============================================================================

function BoardCanvas({
  state, currentUserId, disabled, onMoveTo, onOpenDoor, onAttack, selectedMonster,
}: {
  state: HQState;
  currentUserId: string;
  disabled: boolean;
  onMoveTo: (at: Coord) => void;
  onOpenDoor: (doorId: string) => void;
  onAttack: (monsterId: string) => void;
  selectedMonster: string | null;
}) {
  const W = state.quest.width;
  const H = state.quest.height;
  const myHero = state.heroes.find(h => h.playerId === currentUserId && h.body > 0);
  const myTurnHero = state.heroes[state.turnIndex];
  const isMyTurn = myTurnHero?.playerId === currentUserId;

  // Pre-index doors/monsters/furniture by cell for cheap lookup.
  const doorByCell = useMemo(() => {
    const map = new Map<string, typeof state.doors[number]>();
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
    const map = new Map<string, typeof state.furniture[number]>();
    for (const f of state.furniture) for (const c of f.cells) map.set(`${c.x},${c.y}`, f);
    return map;
  }, [state.furniture]);

  const trapByCell = useMemo(() => {
    const map = new Map<string, typeof state.traps[number]>();
    for (const t of state.traps) map.set(`${t.at.x},${t.at.y}`, t);
    return map;
  }, [state.traps]);

  // Compute which cells the active hero can step to RIGHT NOW (1-orthogonal,
  // passable, has movement left).
  const reachableCells = useMemo(() => {
    const out = new Set<string>();
    if (!isMyTurn || !myHero) return out;
    if (myHero.moveLeft <= 0) return out;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = myHero.at.x + dx, ny = myHero.at.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const t = state.tiles[ny][nx];
      if (t.kind === 'wall' || t.kind === 'blocked') continue;
      if (t.kind === 'door') {
        const d = doorByCell.get(`${nx},${ny}`);
        if (!d || !d.open) continue;
      }
      // Don't allow stepping onto an occupied cell.
      if (monsterByCell.has(`${nx},${ny}`)) continue;
      if (heroByCell.has(`${nx},${ny}`)) continue;
      out.add(`${nx},${ny}`);
    }
    return out;
  }, [isMyTurn, myHero, state.tiles, doorByCell, monsterByCell, heroByCell, W, H]);

  // Adjacent doors for one-click open.
  const adjacentDoors = useMemo(() => {
    const out: Array<{ door: typeof state.doors[number]; cell: Coord }> = [];
    if (!myHero) return out;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = myHero.at.x + dx, ny = myHero.at.y + dy;
      const d = doorByCell.get(`${nx},${ny}`);
      if (d && !d.open && (d.found || !d.secret)) out.push({ door: d, cell: { x: nx, y: ny } });
    }
    return out;
  }, [myHero, doorByCell]);

  return (
    <div
      className="relative overflow-auto rounded-lg border border-neutral-800 bg-black p-2"
      style={{ maxWidth: '100%', maxHeight: '70vh' }}
    >
      <div
        className="relative"
        style={{
          width: W * TILE_PX,
          height: H * TILE_PX,
        }}
      >
        {/* Tiles */}
        {state.tiles.flatMap((row, y) =>
          row.map((tile, x) => {
            const key = `${x},${y}`;
            const door = doorByCell.get(key);
            const isRevealed = tile.revealed;
            let bg = TILE_COLORS.unrevealed;
            if (isRevealed) {
              if (tile.kind === 'wall' || tile.kind === 'blocked') bg = TILE_COLORS.wall;
              else if (tile.kind === 'door') bg = door?.open ? TILE_COLORS.door_open : TILE_COLORS.door_closed;
              else if (tile.kind === 'stairs') bg = TILE_COLORS.stairs;
              else bg = TILE_COLORS.floor;
            }
            const reachable = reachableCells.has(key);
            const adjacentDoor = adjacentDoors.find(d => d.cell.x === x && d.cell.y === y);

            return (
              <div
                key={key}
                className="absolute"
                style={{
                  left: x * TILE_PX,
                  top: y * TILE_PX,
                  width: TILE_PX,
                  height: TILE_PX,
                  background: bg,
                  outline: reachable ? '2px solid #facc15' : '1px solid #111',
                  outlineOffset: reachable ? '-2px' : '0',
                  zIndex: reachable ? 2 : 1,
                  cursor: !disabled && (reachable || adjacentDoor) ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (disabled) return;
                  if (reachable) onMoveTo({ x, y });
                  else if (adjacentDoor) onOpenDoor(adjacentDoor.door.id);
                }}
                title={
                  tile.region
                    ? `${tile.region} (${x},${y})${door ? door.open ? ' • open door' : ' • closed door' : ''}`
                    : `${x},${y}`
                }
              >
                {isRevealed && tile.kind === 'stairs' && (
                  <div className="flex h-full items-center justify-center text-[10px] text-amber-300">
                    ⇪
                  </div>
                )}
              </div>
            );
          }),
        )}

        {/* Furniture sprites (revealed cells only) */}
        {state.furniture.map(f =>
          f.cells.map((c, i) => {
            const tile = state.tiles[c.y]?.[c.x];
            if (!tile?.revealed) return null;
            return (
              <div
                key={`${f.id}-${i}`}
                className="pointer-events-none absolute flex items-center justify-center text-base"
                style={{ left: c.x * TILE_PX, top: c.y * TILE_PX, width: TILE_PX, height: TILE_PX, zIndex: 3 }}
              >
                {f.kind === 'chest' ? '📦' : f.kind === 'tomb' ? '⚰️' : f.kind === 'rack' ? '🗡️' : '🪑'}
              </div>
            );
          }),
        )}

        {/* Trap sprites (revealed only) */}
        {state.traps.map(t => {
          const tile = state.tiles[t.at.y]?.[t.at.x];
          if (!tile?.revealed || !t.revealed) return null;
          return (
            <div
              key={t.id}
              className="pointer-events-none absolute flex items-center justify-center text-base"
              style={{ left: t.at.x * TILE_PX, top: t.at.y * TILE_PX, width: TILE_PX, height: TILE_PX, zIndex: 3 }}
            >
              {t.kind === 'pit' ? '🕳️' : t.kind === 'spear' ? '🗡️' : '🧱'}
            </div>
          );
        })}

        {/* Monster sprites */}
        {state.monsters.map(m => {
          const tile = state.tiles[m.at.y]?.[m.at.x];
          if (!tile?.revealed) return null;
          const adjacent =
            myHero &&
            Math.abs(myHero.at.x - m.at.x) + Math.abs(myHero.at.y - m.at.y) === 1;
          const targetable = isMyTurn && myHero && !myHero.hasActed && adjacent;
          return (
            <div
              key={m.id}
              className={`absolute flex items-center justify-center text-lg ${
                selectedMonster === m.id ? 'ring-2 ring-rose-400' : ''
              }`}
              style={{
                left: m.at.x * TILE_PX,
                top: m.at.y * TILE_PX,
                width: TILE_PX,
                height: TILE_PX,
                zIndex: 5,
                background: 'rgba(120,30,30,0.4)',
                cursor: targetable && !disabled ? 'pointer' : 'default',
                outline: targetable ? '2px solid #f87171' : 'none',
                outlineOffset: '-2px',
              }}
              onClick={() => {
                if (!targetable || disabled) return;
                onAttack(m.id);
              }}
              title={`${m.displayName ?? m.kind} — BP ${m.body}/${m.bodyMax}, Atk ${m.attack}, Def ${m.defense}`}
            >
              {MONSTER_ICON[m.kind] ?? '?'}
              <div className="absolute -bottom-1 left-0 right-0 text-center text-[9px] text-white">
                {m.body}
              </div>
            </div>
          );
        })}

        {/* Hero sprites */}
        {state.heroes.map(h => {
          if (h.body <= 0) return null;
          const isActive = state.heroes[state.turnIndex]?.playerId === h.playerId;
          return (
            <div
              key={h.playerId}
              className="absolute flex items-center justify-center text-lg"
              style={{
                left: h.at.x * TILE_PX,
                top: h.at.y * TILE_PX,
                width: TILE_PX,
                height: TILE_PX,
                zIndex: 6,
                background: 'rgba(40,80,160,0.5)',
                outline: isActive ? '2px solid #38bdf8' : '1px solid #111',
                outlineOffset: '-2px',
              }}
              title={`${h.username} (${HERO_DEFAULTS[h.klass].name}) — BP ${h.body}/${h.bodyMax}`}
            >
              {HERO_ICON[h.klass]}
              <div
                className="absolute -bottom-1 left-0 right-0 text-center text-[9px]"
                style={{ color: safeAccent(h.accent_color) }}
              >
                {h.body}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Side panel — hero status + action buttons
// ============================================================================

function SidePanel({
  state, currentUserId, isMyTurn, myHero, disabled,
  onRollMove, onSearchTreasure, onSearchTraps, onSearchSecrets, onClimbPit, onCastSpell, onEndTurn,
}: HeroQuestBoardProps & { isMyTurn: boolean; myHero: Hero | undefined }) {
  if (!myHero) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
        You are spectating. Heroes:
        <ul className="mt-1 space-y-0.5">
          {state.heroes.map(h => (
            <li key={h.playerId} style={{ color: safeAccent(h.accent_color) }}>
              {HERO_ICON[h.klass]} {h.username} — BP {h.body}/{h.bodyMax}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* My hero card */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
        <div className="mb-1 flex items-center justify-between">
          <div>
            <span className="text-lg">{HERO_ICON[myHero.klass]}</span>{' '}
            <span className="font-semibold" style={{ color: safeAccent(myHero.accent_color) }}>
              {myHero.username}
            </span>
            <span className="ml-1 text-neutral-400">— {HERO_DEFAULTS[myHero.klass].name}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 text-xs text-neutral-300">
          <div>BP <span className="text-emerald-400">{myHero.body}</span>/{myHero.bodyMax}</div>
          <div>MP <span className="text-violet-400">{myHero.mind}</span>/{myHero.mindMax}</div>
          <div>Atk <span className="text-rose-300">{myHero.attack}</span></div>
          <div>Def <span className="text-sky-300">{myHero.defense}</span></div>
          <div className="col-span-2">Gold <span className="text-amber-300">{myHero.gold}</span></div>
          {myHero.hasRolled && (
            <div className="col-span-2 text-amber-200">
              Movement: {myHero.moveLeft} / {myHero.moveRolled}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-neutral-400">Actions</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onRollMove}
            disabled={disabled || !isMyTurn || myHero.hasRolled || myHero.inPit}
            className="rounded-md bg-amber-700 px-2 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-600 disabled:opacity-40"
          >
            🎲 Roll move
          </button>
          <button
            onClick={onSearchTreasure}
            disabled={disabled || !isMyTurn || myHero.hasActed}
            className="rounded-md bg-emerald-800 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-700 disabled:opacity-40"
          >
            💰 Search treasure
          </button>
          <button
            onClick={onSearchTraps}
            disabled={disabled || !isMyTurn || myHero.hasActed}
            className="rounded-md bg-rose-900 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-800 disabled:opacity-40"
          >
            🪤 Search traps
          </button>
          <button
            onClick={onSearchSecrets}
            disabled={disabled || !isMyTurn || myHero.hasActed}
            className="rounded-md bg-indigo-900 px-2 py-1 text-xs font-semibold text-indigo-100 hover:bg-indigo-800 disabled:opacity-40"
          >
            🚪 Search secrets
          </button>
          {myHero.inPit && (
            <button
              onClick={onClimbPit}
              disabled={disabled || !isMyTurn || myHero.moveLeft < 2}
              className="col-span-2 rounded-md bg-orange-800 px-2 py-1 text-xs font-semibold text-orange-100 hover:bg-orange-700 disabled:opacity-40"
            >
              ⬆️ Climb out of pit (-2 movement)
            </button>
          )}
          {myHero.spells.length > 0 && (
            <div className="col-span-2 mt-1">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">Spells</div>
              <div className="mt-1 grid grid-cols-1 gap-1">
                {myHero.spells.map(sp => {
                  const used = myHero.spellsCast.includes(sp.id);
                  return (
                    <button
                      key={sp.id}
                      onClick={() => onCastSpell(sp.id)}
                      disabled={disabled || !isMyTurn || used || myHero.hasActed}
                      className="rounded-md bg-violet-900 px-2 py-1 text-left text-[11px] text-violet-100 hover:bg-violet-800 disabled:opacity-30"
                      title={sp.text}
                    >
                      ✦ {sp.name} <span className="text-[9px] text-violet-300">({sp.element})</span>
                      {used && <span className="ml-1 text-[9px] text-neutral-500">(cast)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <button
            onClick={onEndTurn}
            disabled={disabled || !isMyTurn}
            className="col-span-2 mt-1 rounded-md bg-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 hover:bg-neutral-600 disabled:opacity-40"
          >
            End turn ▶
          </button>
        </div>
      </div>

      <DiceDisplay state={state} />

      {/* Other heroes */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs">
        <div className="mb-1 uppercase tracking-wide text-neutral-400">Party</div>
        <ul className="space-y-0.5">
          {state.heroes.map(h => (
            <li key={h.playerId} className={h.body <= 0 ? 'text-neutral-600 line-through' : ''}>
              {HERO_ICON[h.klass]}{' '}
              <span style={{ color: safeAccent(h.accent_color) }}>{h.username}</span>
              {' '}— BP {h.body}/{h.bodyMax}
              {h.gold > 0 && <span className="ml-2 text-amber-300">{h.gold}g</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DiceDisplay({ state }: { state: HQState }) {
  if (!state.lastRoll) return null;
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs">
      <div className="mb-1 uppercase tracking-wide text-neutral-400">Last roll ({state.lastRoll.rolledBy})</div>
      <div className="flex flex-wrap gap-1">
        {state.lastRoll.faces.map((f, i) => (
          <span
            key={i}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 text-lg"
            title={f}
          >
            {f === 'skull' ? '💀' : f === 'white_shield' ? '🛡️' : '🟦'}
          </span>
        ))}
      </div>
      <div className="mt-1 text-neutral-400">
        {state.lastRoll.skulls} skull(s), {state.lastRoll.blocks} block(s)
      </div>
    </div>
  );
}

// ============================================================================
// Log
// ============================================================================

function LogView({ state }: { state: HQState }) {
  const recent = state.log.slice(-10);
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-xs">
      <div className="mb-1 px-1 uppercase tracking-wide text-neutral-500">Log</div>
      <ul className="max-h-32 space-y-0.5 overflow-auto px-1">
        {recent.map(e => (
          <li
            key={e.seq}
            className={`${
              e.tag === 'combat' ? 'text-rose-300'
              : e.tag === 'death' ? 'text-red-400'
              : e.tag === 'search' ? 'text-emerald-300'
              : e.tag === 'spell' ? 'text-violet-300'
              : e.tag === 'reveal' ? 'text-amber-300'
              : e.tag === 'zargon' ? 'text-rose-400'
              : 'text-neutral-300'
            }`}
          >
            {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// Finished screen
// ============================================================================

function FinishedView({ state }: { state: HQState }) {
  const heroesWon = state.winner === 'heroes';
  return (
    <div className="space-y-3">
      <div
        className={`rounded-xl border p-4 text-center ${
          heroesWon
            ? 'border-amber-500/60 bg-gradient-to-br from-amber-900/40 to-neutral-900 text-amber-200'
            : 'border-rose-700/60 bg-gradient-to-br from-rose-950/60 to-neutral-900 text-rose-200'
        }`}
      >
        <div className="text-2xl font-bold">{heroesWon ? 'Victory!' : 'The Quest is Lost'}</div>
        <div className="mt-1 text-sm">
          {heroesWon
            ? `Verag is slain. The heroes return triumphant.`
            : `All heroes have fallen. Zargon takes the day.`}
        </div>
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs">
        <div className="mb-1 uppercase tracking-wide text-neutral-400">Final party</div>
        <ul className="space-y-0.5">
          {state.heroes.map(h => (
            <li key={h.playerId}>
              {HERO_ICON[h.klass]}{' '}
              <span style={{ color: safeAccent(h.accent_color) }}>{h.username}</span>
              {' '}({HERO_DEFAULTS[h.klass].name}) — BP {h.body}/{h.bodyMax} • {h.gold} gold
              {h.body <= 0 && <span className="ml-1 text-rose-500">[fallen]</span>}
            </li>
          ))}
        </ul>
      </div>
      <LogView state={state} />
    </div>
  );
}
