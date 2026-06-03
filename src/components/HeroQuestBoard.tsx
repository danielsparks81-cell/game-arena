'use client';

// HeroQuest top-level board component — orchestrates the lobby, the in-game
// canvas + character sheet + dice + actions, and the finished screen. All
// real rendering lives in components/heroquest/* sub-components; this file
// is just wiring + the action bar.

import { useEffect, useState } from 'react';
import {
  type HQState,
  type HeroClass,
  type Coord,
  HERO_DEFAULTS,
} from '@/lib/games/heroquest';
import HeroLobby from './heroquest/HeroLobby';
import HeroQuestBoardCanvas from './heroquest/Board';
import CharacterSheet from './heroquest/CharacterSheet';
import DicePanel from './heroquest/DicePanel';
import QuestBriefing from './heroquest/QuestBriefing';
import { HeartIcon, CoinIcon } from './heroquest/Art';
import { safeAccent } from '@/lib/accentColors';

export type HeroQuestBoardProps = {
  state: HQState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onClaimHero: (seat: number) => void;
  /** Legacy: kept for back-compat — older lobby builds passed a class instead
      of a seat. The engine routes both to the same claim handler. */
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
  const { state } = props;

  // Quest briefing modal: show on first entry to a quest. Local-state only —
  // not persisted (one show per page load).
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingShown, setBriefingShown] = useState(false);
  useEffect(() => {
    if (!briefingShown && state.phase !== 'lobby') {
      setBriefingOpen(true);
      setBriefingShown(true);
    }
  }, [state.phase, briefingShown]);

  if (state.phase === 'lobby') {
    return <HeroLobby
      state={state}
      currentUserId={props.currentUserId}
      isHost={props.isHost}
      disabled={props.disabled}
      onClaimHero={props.onClaimHero}
      onRandomClasses={props.onRandomClasses}
      onStart={props.onStart}
    />;
  }

  if (state.phase === 'finished') {
    return <FinishedView state={state} />;
  }

  return (
    <>
      {briefingOpen && (
        <QuestBriefing quest={state.quest} onClose={() => setBriefingOpen(false)} />
      )}
      <PlayingView {...props} onShowBriefing={() => setBriefingOpen(true)} />
    </>
  );
}

// ============================================================================
// Playing
// ============================================================================

function PlayingView({
  state, currentUserId, disabled,
  onRollMove, onMoveTo, onOpenDoor, onAttack,
  onSearchTreasure, onSearchTraps, onSearchSecrets, onClimbPit, onCastSpell, onEndTurn,
  onShowBriefing,
}: HeroQuestBoardProps & { onShowBriefing: () => void }) {
  // The sheet always shows the ACTIVE hero (whoever's up). Since players
  // can control multiple heroes, this matches whatever's happening on the
  // board — when it's your hero's turn you see your stats, when it's
  // another hero's turn (yours or someone else's) you see theirs.
  const active = state.heroes[state.turnIndex];
  const isMyTurn = active?.playerId === currentUserId;
  const focusHero = active;

  // Spell targeting: clicking a spell that needs a target parks it here until
  // the player picks a monster (on the board) or a hero (from the picker bar).
  // 'area' spells resolve immediately with no pick.
  const [pendingSpell, setPendingSpell] = useState<{ id: string; name: string; target: 'monster' | 'hero' } | null>(null);

  // Drop any pending target selection the moment it's no longer actionable
  // (turn passed, hero already acted, etc.).
  useEffect(() => {
    if (pendingSpell && (!isMyTurn || !focusHero || focusHero.hasActed)) setPendingSpell(null);
  }, [pendingSpell, isMyTurn, focusHero]);

  const handleSpellClick = (spellId: string) => {
    const spell = focusHero?.spells.find(s => s.id === spellId);
    if (!spell) return;
    if (spell.target === 'area') { onCastSpell(spellId); return; }
    setPendingSpell({ id: spell.id, name: spell.name, target: spell.target });
  };

  const livingHeroes = state.heroes
    .map((h, idx) => ({ h, idx }))
    .filter(({ h }) => h.body > 0);

  // First monster orthogonally adjacent to the active hero — the Attack button's
  // target (you can still click any monster on the board directly).
  const adjacentMonsterId = (() => {
    if (!focusHero || focusHero.body <= 0) return null;
    const m = state.monsters.find(mo => mo.body > 0 &&
      Math.abs(mo.at.x - focusHero.at.x) + Math.abs(mo.at.y - focusHero.at.y) === 1);
    return m?.id ?? null;
  })();

  return (
    // Left column: 6 action buttons then the 4 hero panels (scrolls internally
    // so the page never scrolls). Map fills the right. The whole grid is exactly
    // one screen tall.
    <div className="grid gap-3 lg:grid-cols-[24rem_minmax(0,1fr)]" style={{ height: 'calc(100dvh - 7rem)' }}>
      <div className="flex h-full min-h-0 flex-col gap-2 pr-1">
        {pendingSpell && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-amber-500/70 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <span className="font-semibold">Casting {pendingSpell.name}:</span>
            {pendingSpell.target === 'monster' ? (
              <span className="text-amber-200/90">click a monster on the board to target it.</span>
            ) : (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-amber-200/90">choose a hero —</span>
                {livingHeroes.map(({ h, idx }) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => { onCastSpell(pendingSpell.id, { targetHeroIdx: idx }); setPendingSpell(null); }}
                    className="rounded border border-amber-400/60 bg-neutral-900/60 px-2 py-0.5 text-xs font-medium text-amber-100 transition hover:border-amber-300 hover:bg-amber-500/20"
                  >
                    {h.playerId === currentUserId && h.seat === focusHero?.seat ? `${h.username} (self)` : h.username}
                  </button>
                ))}
              </span>
            )}
            <button
              type="button"
              onClick={() => setPendingSpell(null)}
              className="ml-auto rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-300 transition hover:border-rose-400 hover:text-rose-300"
            >
              Cancel
            </button>
          </div>
        )}

        <ActionPanel
          isMyTurn={isMyTurn}
          myHero={focusHero}
          disabled={disabled}
          onRollMove={onRollMove}
          onSearchTreasure={onSearchTreasure}
          onSearchTraps={onSearchTraps}
          onSearchSecrets={onSearchSecrets}
          onClimbPit={onClimbPit}
          onEndTurn={onEndTurn}
          adjacentMonsterId={adjacentMonsterId}
          onAttack={onAttack}
          onCastSpellClick={handleSpellClick}
        />

        {/* One panel per hero in the party (the active hero is highlighted). */}
        {state.heroes.map(h => (
          <CharacterSheet
            key={`${h.playerId}-${h.seat}`}
            compact
            hero={h}
            isActive={h.seat === active?.seat}
            isMyTurn={isMyTurn}
            isMine={h.playerId === currentUserId}
            onCastSpell={handleSpellClick}
          />
        ))}

        {/* Dice + chronicle take the remaining height and scroll internally so
            the buttons + hero panels stay fixed and the page never scrolls. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <DicePanel roll={state.lastRoll} />
          <LogView state={state} />
        </div>
      </div>

      {/* Map fills the right column. */}
      <div className="min-h-0 min-w-0">
        <HeroQuestBoardCanvas
          state={state}
          currentUserId={currentUserId}
          disabled={disabled || !isMyTurn}
          onMoveTo={onMoveTo}
          onOpenDoor={onOpenDoor}
          onAttack={onAttack}
          spellTargetMonsters={pendingSpell?.target === 'monster'}
          onPickMonster={(monsterId) => { if (pendingSpell) { onCastSpell(pendingSpell.id, { targetMonsterId: monsterId }); setPendingSpell(null); } }}
        />
      </div>
    </div>
  );
}

function TurnBanner({
  state, currentUserId, onShowBriefing,
}: {
  state: HQState;
  currentUserId: string;
  onShowBriefing: () => void;
}) {
  const active = state.heroes[state.turnIndex];
  if (!active) return null;
  const isMe = active.playerId === currentUserId;
  return (
    <div
      className="flex items-center gap-3 rounded-lg border-2 px-3 py-2 text-sm"
      style={{
        borderColor: isMe ? safeAccent(active.accent_color) : '#5a3a08',
        background: isMe
          ? `linear-gradient(180deg, ${safeAccent(active.accent_color)}33 0%, #1a1410 100%)`
          : 'linear-gradient(180deg, #1a1410 0%, #050505 100%)',
        color: '#e8d8b8',
        fontFamily: 'Georgia, serif',
      }}
    >
      <span className="text-lg">{isMe ? '⚔' : '⌛'}</span>
      <div className="flex-1">
        {isMe ? (
          <span><strong style={{ color: safeAccent(active.accent_color) }}>Your turn.</strong> Roll movement, take an action, then end turn.</span>
        ) : (
          <span>
            <strong style={{ color: safeAccent(active.accent_color) }}>{active.username}</strong>
            {' '}is in command of the {HERO_DEFAULTS[active.klass].name}…
          </span>
        )}
      </div>
      <button
        onClick={onShowBriefing}
        className="rounded border border-amber-700/50 bg-amber-900/30 px-2 py-1 text-[10px] uppercase tracking-wider text-amber-200 hover:bg-amber-800/40"
        title="Re-read Mentor's words"
      >
        📜 Quest
      </button>
    </div>
  );
}

// ============================================================================
// Action panel (right column) — all 6 hero actions + End Turn
// ============================================================================

function ActionPanel({
  isMyTurn, myHero, disabled,
  onRollMove, onSearchTreasure, onSearchTraps, onSearchSecrets, onClimbPit, onEndTurn,
  adjacentMonsterId, onAttack, onCastSpellClick,
}: {
  isMyTurn: boolean;
  myHero: ReturnType<HQState['heroes']['find']>;
  disabled: boolean;
  onRollMove: () => void;
  onSearchTreasure: () => void;
  onSearchTraps: () => void;
  onSearchSecrets: () => void;
  onClimbPit: () => void;
  onEndTurn: () => void;
  /** Monster the Attack button targets (null = nothing adjacent). */
  adjacentMonsterId: string | null;
  onAttack: (monsterId: string) => void;
  onCastSpellClick: (spellId: string) => void;
}) {
  const [spellMenu, setSpellMenu] = useState(false);

  // For spectators / between-turns, render a quieter status line.
  if (!myHero) {
    return (
      <div className="rounded-lg border border-amber-900/40 bg-neutral-900 px-3 py-2 text-xs text-amber-200/60 text-center">
        Spectating · waiting for the heroes to act.
      </div>
    );
  }

  const canAct = isMyTurn && !disabled && myHero.body > 0;
  const acted = myHero.hasActed;
  const moveText = myHero.hasRolled ? `Move ${myHero.moveLeft}/${myHero.moveRolled}` : 'Roll movement';
  const spells = myHero.spells ?? [];

  return (
    <div className="rounded-lg border border-amber-900/50 bg-neutral-900/70 p-2">
      <div className="grid grid-cols-2 gap-2">
        <ActionButton label={moveText} icon="🎲" onClick={onRollMove} disabled={!canAct || myHero.hasRolled || myHero.inPit} flavor="amber" />
        <ActionButton label="Attack" icon="⚔️" onClick={() => adjacentMonsterId && onAttack(adjacentMonsterId)} disabled={!canAct || acted || !adjacentMonsterId} flavor="rose" />
        <ActionButton label="Search treasure" icon="💰" onClick={onSearchTreasure} disabled={!canAct || acted} flavor="emerald" />
        <ActionButton label="Search traps" icon="🪤" onClick={onSearchTraps} disabled={!canAct || acted} flavor="orange" />
        <ActionButton label="Secret doors" icon="🚪" onClick={onSearchSecrets} disabled={!canAct || acted} flavor="indigo" />
        <div className="relative w-full">
          <ActionButton label="Cast spell" icon="✨" onClick={() => setSpellMenu(v => !v)} disabled={!canAct || acted || spells.length === 0} flavor="indigo" />
          {spellMenu && spells.length > 0 && (
            <div className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-amber-700/60 bg-neutral-900 p-1 shadow-xl">
              {spells.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { onCastSpellClick(s.id); setSpellMenu(false); }}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-amber-100 transition hover:bg-amber-800/40"
                >
                  <span className="font-semibold">{s.name}</span>
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-300/70">{s.element}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {myHero.inPit
          ? <ActionButton label="Climb out (-2)" icon="⬆️" onClick={onClimbPit} disabled={!canAct || myHero.moveLeft < 2} flavor="orange" />
          : <div />}
        <ActionButton label="End turn" icon="▶" onClick={onEndTurn} disabled={!canAct} flavor="slate" />
      </div>
    </div>
  );
}

function ActionButton({ label, icon, onClick, disabled, flavor }: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled: boolean;
  flavor: 'amber' | 'emerald' | 'rose' | 'indigo' | 'orange' | 'slate';
}) {
  const FLAVORS: Record<typeof flavor, { from: string; to: string; border: string }> = {
    amber:   { from: '#8a5a08', to: '#3a2408', border: '#d4a043' },
    emerald: { from: '#1a5a3a', to: '#0a2a1a', border: '#43c084' },
    rose:    { from: '#7a1a3a', to: '#3a0a18', border: '#d04a6a' },
    indigo:  { from: '#1a2a7a', to: '#0a103a', border: '#4a60d0' },
    orange:  { from: '#8a4a08', to: '#3a2008', border: '#d4783a' },
    slate:   { from: '#3a3a3a', to: '#1a1a1a', border: '#7a7a7a' },
  };
  const f = FLAVORS[flavor];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-1 rounded-md border-2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-30 hover:shadow-md"
      style={{
        background: `linear-gradient(180deg, ${f.from} 0%, ${f.to} 100%)`,
        borderColor: f.border,
        color: '#fff7e0',
        fontFamily: 'Georgia, serif',
        textShadow: '0 1px 1px rgba(0,0,0,0.6)',
      }}
    >
      <span className="text-sm">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// ============================================================================
// Log
// ============================================================================

function LogView({ state }: { state: HQState }) {
  const recent = state.log.slice(-12);
  return (
    <div className="rounded-lg border border-amber-900/40 bg-black/70 p-2">
      <div className="mb-1 px-1 text-[10px] uppercase tracking-widest text-amber-200/60" style={{ fontFamily: 'serif' }}>
        Chronicle
      </div>
      <ul className="max-h-32 space-y-0.5 overflow-auto px-1 text-xs">
        {recent.map(e => (
          <li
            key={e.seq}
            style={{
              color:
                e.tag === 'combat' ? '#fda4af' :
                e.tag === 'death' ? '#ef4444' :
                e.tag === 'search' ? '#86efac' :
                e.tag === 'spell' ? '#c4b5fd' :
                e.tag === 'reveal' ? '#fbbf24' :
                e.tag === 'zargon' ? '#fb7185' :
                e.tag === 'move' ? '#cbd5e1' :
                '#e5e5e5',
            }}
          >
            {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// Finished
// ============================================================================

function FinishedView({ state }: { state: HQState }) {
  const heroesWon = state.winner === 'heroes';
  return (
    <div className="space-y-3">
      <div
        className="rounded-xl border-4 p-6 text-center shadow-2xl"
        style={{
          borderColor: heroesWon ? '#d4a043' : '#8a1010',
          background: heroesWon
            ? 'radial-gradient(ellipse, #5a3a08 0%, #1a0a00 100%)'
            : 'radial-gradient(ellipse, #4a0808 0%, #100404 100%)',
          color: heroesWon ? '#ffd84d' : '#fda4af',
        }}
      >
        <div className="text-4xl font-bold uppercase tracking-widest" style={{ fontFamily: 'Georgia, serif', textShadow: '0 2px 4px rgba(0,0,0,0.6)' }}>
          {heroesWon ? '★ Victory ★' : '✟ The Quest is Lost ✟'}
        </div>
        <div className="mt-2 text-sm" style={{ fontFamily: 'serif' }}>
          {heroesWon
            ? 'Verag the gargoyle lies in ruin. Mentor welcomes you home.'
            : 'The heroes have fallen. Zargon takes the day.'}
        </div>
      </div>
      <div className="rounded-lg border border-amber-900/40 bg-neutral-900 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-amber-200/70" style={{ fontFamily: 'serif' }}>
          Final standing
        </div>
        <ul className="space-y-1">
          {state.heroes.map(h => (
            <li key={h.playerId} className={`flex items-center gap-2 ${h.body <= 0 ? 'opacity-50' : ''}`}>
              <span className="text-sm" style={{ color: safeAccent(h.accent_color) }}>{h.username}</span>
              <span className="text-xs text-neutral-400">({HERO_DEFAULTS[h.klass].name})</span>
              <span className="ml-auto flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1"><HeartIcon size={12} filled={h.body > 0} />{h.body}/{h.bodyMax}</span>
                <span className="flex items-center gap-1"><CoinIcon size={12} />{h.gold}</span>
                {h.body <= 0 && <span className="text-rose-500">[fallen]</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <LogView state={state} />
    </div>
  );
}
