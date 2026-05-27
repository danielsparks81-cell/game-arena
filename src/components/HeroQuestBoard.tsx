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
import CharacterSheet, { PartyRoster } from './heroquest/CharacterSheet';
import DicePanel from './heroquest/DicePanel';
import QuestBriefing from './heroquest/QuestBriefing';
import { HeartIcon, CoinIcon } from './heroquest/Art';
import { safeAccent } from '@/lib/accentColors';

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
      onSetClass={props.onSetClass}
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
  const myHero = state.heroes.find(h => h.playerId === currentUserId);
  const active = state.heroes[state.turnIndex];
  const isMyTurn = active?.playerId === currentUserId;

  return (
    <div className="space-y-3">
      <TurnBanner state={state} currentUserId={currentUserId} onShowBriefing={onShowBriefing} />

      <div className="grid gap-3 lg:grid-cols-[1fr,20rem]">
        <div className="space-y-3">
          <HeroQuestBoardCanvas
            state={state}
            currentUserId={currentUserId}
            disabled={disabled || !isMyTurn}
            onMoveTo={onMoveTo}
            onOpenDoor={onOpenDoor}
            onAttack={onAttack}
          />

          {/* Action ribbon underneath the board */}
          <ActionRibbon
            state={state}
            isMyTurn={isMyTurn}
            myHero={myHero}
            disabled={disabled}
            onRollMove={onRollMove}
            onSearchTreasure={onSearchTreasure}
            onSearchTraps={onSearchTraps}
            onSearchSecrets={onSearchSecrets}
            onClimbPit={onClimbPit}
            onEndTurn={onEndTurn}
          />

          <DicePanel roll={state.lastRoll} />

          <LogView state={state} />
        </div>

        <div className="space-y-3">
          {myHero && (
            <CharacterSheet
              hero={myHero}
              isActive={active?.playerId === myHero.playerId}
              isMyTurn={isMyTurn}
              isMine
              onCastSpell={onCastSpell}
            />
          )}
          <PartyRoster state={state} currentUserId={currentUserId} />
        </div>
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
// Action ribbon (under the board)
// ============================================================================

function ActionRibbon({
  state, isMyTurn, myHero, disabled,
  onRollMove, onSearchTreasure, onSearchTraps, onSearchSecrets, onClimbPit, onEndTurn,
}: {
  state: HQState;
  isMyTurn: boolean;
  myHero: ReturnType<HQState['heroes']['find']>;
  disabled: boolean;
  onRollMove: () => void;
  onSearchTreasure: () => void;
  onSearchTraps: () => void;
  onSearchSecrets: () => void;
  onClimbPit: () => void;
  onEndTurn: () => void;
}) {
  // For spectators / between-turns, render a quieter status line.
  if (!myHero) {
    return (
      <div className="rounded-lg border border-amber-900/40 bg-neutral-900 px-3 py-2 text-xs text-amber-200/60 text-center">
        Spectating · waiting for the heroes to act.
      </div>
    );
  }

  const canAct = isMyTurn && !disabled;
  const moveText = myHero.hasRolled ? `${myHero.moveLeft}/${myHero.moveRolled} squares` : 'Roll movement';
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <ActionButton
        label={moveText}
        icon="🎲"
        onClick={onRollMove}
        disabled={!canAct || myHero.hasRolled || myHero.inPit}
        flavor="amber"
      />
      <ActionButton
        label="Search treasure"
        icon="💰"
        onClick={onSearchTreasure}
        disabled={!canAct || myHero.hasActed}
        flavor="emerald"
      />
      <ActionButton
        label="Search traps"
        icon="🪤"
        onClick={onSearchTraps}
        disabled={!canAct || myHero.hasActed}
        flavor="rose"
      />
      <ActionButton
        label="Secret doors"
        icon="🚪"
        onClick={onSearchSecrets}
        disabled={!canAct || myHero.hasActed}
        flavor="indigo"
      />
      {myHero.inPit ? (
        <ActionButton
          label="Climb out (-2)"
          icon="⬆️"
          onClick={onClimbPit}
          disabled={!canAct || myHero.moveLeft < 2}
          flavor="orange"
        />
      ) : (
        <div /> /* spacer */
      )}
      <ActionButton
        label="End turn"
        icon="▶"
        onClick={onEndTurn}
        disabled={!canAct}
        flavor="slate"
      />
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
      className="flex items-center justify-center gap-1 rounded-md border-2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-30 hover:shadow-md"
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
