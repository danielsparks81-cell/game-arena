'use client';

// HeroQuest top-level board component — orchestrates the lobby, the in-game
// canvas + character sheet + dice + actions, and the finished screen. All
// real rendering lives in components/heroquest/* sub-components; this file
// is just wiring + the action bar.

import { useEffect, useRef, useState } from 'react';
import {
  type HQState,
  type HeroClass,
  type Coord,
  HERO_DEFAULTS,
  hasLineOfSight,
} from '@/lib/games/heroquest';
import HeroLobby from './heroquest/HeroLobby';
import HeroQuestBoardCanvas from './heroquest/Board';
import CharacterSheet from './heroquest/CharacterSheet';
import DicePanel, { DiceRollOverlay } from './heroquest/DicePanel';
import QuestBriefing from './heroquest/QuestBriefing';
import { HeartIcon, CoinIcon } from './heroquest/Art';
import { useNarration, speak } from './heroquest/narration';
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
  onMovePath: (path: Coord[]) => void;
  onOpenDoor: (doorId: string) => void;
  onAttack: (monsterId: string) => void;
  onSearchTreasure: () => void;
  onSearchTraps: () => void;
  onSearchSecrets: () => void;
  onDisarmTrap: (trapId: string) => void;
  onJumpTrap: (trapId: string) => void;
  onClimbPit: () => void;
  onCastSpell: (spellId: string, opts?: { targetMonsterId?: string; targetHeroIdx?: number }) => void;
  onEndTurn: () => void;
  /** Advance Zargon's turn by one monster (the host drives this on a timer). */
  onZargonStep: () => void;
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

  // Drive Zargon's turn one monster at a time. The HOST ticks zargon_step on a
  // timer; each step updates state (the next monster lights up), which re-runs
  // this effect to schedule the following step. ~800ms gives each monster its
  // moment. Non-host clients just watch the highlights move.
  useEffect(() => {
    if (state.phase !== 'zargon' || !props.isHost) return;
    const t = setTimeout(() => props.onZargonStep(), 1500); // slow enough to follow each monster
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.zargonActiveId, state.zargonQueue?.length, props.isHost]);

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
  onRollMove, onMoveTo, onMovePath, onOpenDoor, onAttack,
  onSearchTreasure, onSearchTraps, onSearchSecrets, onDisarmTrap, onJumpTrap, onClimbPit, onCastSpell, onEndTurn,
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

  // Narration: read the Quest-Book "special notes" aloud as their rooms reveal.
  const { enabled: narrate, setEnabled: setNarrate, supported: narrateSupported } = useNarration();
  const lastNoteSeq = useRef<number | null>(null);
  useEffect(() => {
    const notes = state.log.filter(e => e.tag === 'note');
    const maxSeq = notes.length ? notes[notes.length - 1].seq : -1;
    // On first render just remember where we are — don't replay old notes.
    if (lastNoteSeq.current === null) { lastNoteSeq.current = maxSeq; return; }
    const fresh = notes.filter(e => e.seq > (lastNoteSeq.current ?? -1));
    lastNoteSeq.current = maxSeq;
    if (narrate && fresh.length) speak(fresh.map(e => e.text).join(' '));
  }, [state.log, narrate]);

  const handleSpellClick = (spellId: string) => {
    const spell = focusHero?.spells.find(s => s.id === spellId);
    if (!spell) return;
    if (spell.target === 'area') { onCastSpell(spellId); return; }
    setPendingSpell({ id: spell.id, name: spell.name, target: spell.target });
  };

  // Valid targets for a hero-target spell: yourself, plus any living ally you
  // can actually see (line of sight). Unseen allies aren't offered, so you can
  // never waste a spell on a target you can't reach.
  const livingHeroes = state.heroes
    .map((h, idx) => ({ h, idx }))
    .filter(({ h }) =>
      h.body > 0 &&
      (h.seat === focusHero?.seat || (!!focusHero && hasLineOfSight(state, focusHero.at, h.at))),
    );

  // First monster orthogonally adjacent to the active hero — the Attack button's
  // target (you can still click any monster on the board directly).
  const adjacentMonsterId = (() => {
    if (!focusHero || focusHero.body <= 0) return null;
    const m = state.monsters.find(mo => mo.body > 0 &&
      Math.abs(mo.at.x - focusHero.at.x) + Math.abs(mo.at.y - focusHero.at.y) === 1);
    return m?.id ?? null;
  })();

  // Disarm target: a revealed, un-sprung trap orthogonally adjacent to the hero,
  // and only if the hero can actually disarm (a Dwarf, or carrying a Tool Kit).
  const canDisarm = !!focusHero && (focusHero.klass === 'dwarf' || focusHero.items.some(i => i.id === 'tool_kit'));
  const disarmableTrapId = (() => {
    if (!focusHero || !canDisarm) return null;
    const t = state.traps.find(tr => tr.revealed && !tr.triggered &&
      Math.abs(tr.at.x - focusHero.at.x) + Math.abs(tr.at.y - focusHero.at.y) === 1);
    return t?.id ?? null;
  })();

  // Jump target: a revealed trap orthogonally adjacent to the hero with a clear
  // landing square directly beyond it, given >=2 movement left. Jumping is part
  // of movement (not an action), so it isn't gated by hasActed. The engine is
  // authoritative; this is just whether to light up the button.
  const jumpableTrapId = (() => {
    if (!focusHero || !isMyTurn || focusHero.inPit || !focusHero.hasRolled || focusHero.moveLeft < 2) return null;
    for (const tr of state.traps) {
      if (!tr.revealed) continue;
      if (tr.triggered && tr.kind !== 'pit') continue; // sprung pits can still be jumped
      const dx = tr.at.x - focusHero.at.x, dy = tr.at.y - focusHero.at.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
      const lx = tr.at.x + dx, ly = tr.at.y + dy;
      const tile = state.tiles[ly]?.[lx];
      if (!tile || tile.kind === 'wall' || tile.kind === 'blocked') continue;
      if (state.monsters.some(m => m.body > 0 && m.at.x === lx && m.at.y === ly)) continue;
      if (tile.kind !== 'stairs' && state.heroes.some(o => o.seat !== focusHero.seat && o.body > 0 && o.at.x === lx && o.at.y === ly)) continue;
      return tr.id;
    }
    return null;
  })();

  return (
    // Left column: 6 action buttons then the 4 hero panels (scrolls internally
    // so the page never scrolls). Map fills the right. The whole grid is exactly
    // one screen tall.
    <div className="grid gap-3 lg:grid-cols-[24rem_minmax(0,1fr)]" style={{ height: 'calc(100dvh - 7rem)' }}>
      <div className="flex h-full min-h-0 flex-col gap-2 pr-1">
        {narrateSupported && (
          <button
            onClick={() => setNarrate(!narrate)}
            title={narrate ? 'Narration on — click to mute' : 'Narration off — click to enable'}
            className="self-start rounded border border-amber-700/50 bg-amber-900/30 px-2 py-1 text-[10px] uppercase tracking-wider text-amber-200 transition hover:bg-amber-800/40"
          >
            {narrate ? '🔊 Narration on' : '🔇 Narration off'}
          </button>
        )}
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
          disarmableTrapId={disarmableTrapId}
          onDisarmTrap={onDisarmTrap}
          jumpableTrapId={jumpableTrapId}
          onJumpTrap={onJumpTrap}
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

        {/* Dice panel sits right under the hero panels — always visible. The
            roll overlay flies here on exit (targeted by this id). */}
        <div id="hq-dice-panel">
          <DicePanel attack={state.lastRoll} defense={state.lastDefenseRoll} move={state.lastMoveRoll} />
        </div>

        {/* Chronicle takes the remaining height and scrolls internally so the
            buttons + hero panels + dice stay fixed and the page never scrolls. */}
        <div className="min-h-0 flex-1">
          <LogView state={state} />
        </div>
      </div>

      {/* Map fills the right column. The roll overlay pops up over it. */}
      <div className="relative min-h-0 min-w-0">
        <HeroQuestBoardCanvas
          state={state}
          currentUserId={currentUserId}
          disabled={disabled || !isMyTurn}
          onMoveTo={onMoveTo}
          onMovePath={onMovePath}
          onOpenDoor={onOpenDoor}
          onAttack={onAttack}
          spellTargetMonsters={pendingSpell?.target === 'monster'}
          onPickMonster={(monsterId) => { if (pendingSpell) { onCastSpell(pendingSpell.id, { targetMonsterId: monsterId }); setPendingSpell(null); } }}
        />
        <DiceRollOverlay attack={state.lastRoll} defense={state.lastDefenseRoll} move={state.lastMoveRoll} />
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
  disarmableTrapId, onDisarmTrap, jumpableTrapId, onJumpTrap,
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
  /** Adjacent revealed trap the Disarm button targets (null = none / can't disarm). */
  disarmableTrapId: string | null;
  onDisarmTrap: (trapId: string) => void;
  /** Adjacent revealed trap the hero could leap over (null = none / can't jump). */
  jumpableTrapId: string | null;
  onJumpTrap: (trapId: string) => void;
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
      <div className="grid grid-cols-2 gap-1.5">
        <ActionButton label={moveText} icon="🎲" onClick={onRollMove} disabled={!canAct || myHero.hasRolled || myHero.inPit} flavor="amber"
          tip="Roll 3d4 for movement, then drag your hero square by square (no diagonals). You don't have to use it all." />
        <ActionButton label="Attack" icon="⚔️" onClick={() => adjacentMonsterId && onAttack(adjacentMonsterId)} disabled={!canAct || acted || !adjacentMonsterId} flavor="rose"
          tip="Attack an adjacent monster with your weapon's dice. Each skull is a hit; the monster defends with its shields. One action per turn." />
        <ActionButton label="Search treasure" icon="💰" onClick={onSearchTreasure} disabled={!canAct || acted} flavor="emerald"
          tip="Search the room you're in for treasure — only if no monsters are in it, and once per hero per room." />
        <ActionButton label="Search traps" icon="🪤" onClick={onSearchTraps} disabled={!canAct || acted} flavor="orange"
          tip="Reveal any hidden traps in your room or corridor (only if no monsters are visible). Search before you loot a chest!" />
        <ActionButton label="Secret doors" icon="🚪" onClick={onSearchSecrets} disabled={!canAct || acted} flavor="indigo"
          tip="Search your room or corridor for hidden doors (only if no monsters are visible)." />
        <ActionButton label="Disarm trap" icon="🛠️" onClick={() => disarmableTrapId && onDisarmTrap(disarmableTrapId)} disabled={!canAct || acted || !disarmableTrapId} flavor="orange"
          tip="Disarm an adjacent discovered trap. The Dwarf is best at it; everyone else needs a Tool Kit." />
        {/* Jumping is part of movement, not an action — never gated by `acted`. */}
        <ActionButton label="Jump trap" icon="🤸" onClick={() => jumpableTrapId && onJumpTrap(jumpableTrapId)} disabled={!canAct || !jumpableTrapId} flavor="amber"
          tip="Leap over a discovered trap (needs 2+ movement and a clear landing). A shield clears it; a skull springs it. Not an action." />
        <div className="relative w-full">
          <ActionButton label="Cast spell" icon="✨" onClick={() => setSpellMenu(v => !v)} disabled={!canAct || acted || spells.length === 0} flavor="indigo"
            tip="Cast one of your spells (Elf/Wizard) at anything you can see. Each spell can be cast once per quest." />
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
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {myHero.inPit
          ? <ActionButton label="Climb out (-2)" icon="⬆️" onClick={onClimbPit} disabled={!canAct || myHero.moveLeft < 2} flavor="orange"
              tip="Climb out of the pit you fell into (costs 2 movement)." />
          : <div />}
        <ActionButton label="End turn" icon="▶" onClick={onEndTurn} disabled={!canAct} flavor="slate"
          tip="Finish your turn and pass to the next hero (then Zargon moves the monsters)." />
      </div>
    </div>
  );
}

function ActionButton({ label, icon, onClick, disabled, flavor, tip }: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled: boolean;
  flavor: 'amber' | 'emerald' | 'rose' | 'indigo' | 'orange' | 'slate';
  /** Hover tooltip explaining what the action does (for new players). */
  tip?: string;
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
      title={tip}
      className="flex w-full items-center justify-center gap-1 rounded border px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-30 hover:shadow-md"
      style={{
        background: `linear-gradient(180deg, ${f.from} 0%, ${f.to} 100%)`,
        borderColor: f.border,
        color: '#fff7e0',
        fontFamily: 'Georgia, serif',
        textShadow: '0 1px 1px rgba(0,0,0,0.6)',
      }}
    >
      <span className="text-sm leading-none">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// ============================================================================
// Log
// ============================================================================

function LogView({ state }: { state: HQState }) {
  // The chronicle keeps the FULL history of the quest — every roll, move,
  // attack, search, spell, reveal and Zargon action — not just the tail. The
  // list scrolls inside its panel and auto-pins to the newest entry.
  const endRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [state.log.length]);
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-amber-900/40 bg-black/70 p-2">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <span className="text-[10px] uppercase tracking-widest text-amber-200/60" style={{ fontFamily: 'serif' }}>
          Chronicle
        </span>
        <span className="text-[9px] text-amber-200/30">{state.log.length} entries</span>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 text-xs">
        {state.log.map(e => (
          <li
            key={e.seq}
            className={e.tag === 'note' ? 'italic' : undefined}
            style={{
              color:
                e.tag === 'combat' ? '#fda4af' :
                e.tag === 'death' ? '#ef4444' :
                e.tag === 'search' ? '#86efac' :
                e.tag === 'spell' ? '#c4b5fd' :
                e.tag === 'reveal' ? '#fbbf24' :
                e.tag === 'zargon' ? '#fb7185' :
                e.tag === 'spawn' ? '#f0abfc' :
                e.tag === 'trap' ? '#fdba74' :
                e.tag === 'note' ? '#fcd34d' :
                e.tag === 'move' ? '#cbd5e1' :
                '#e5e5e5',
            }}
          >
            {e.text}
          </li>
        ))}
        <li ref={endRef} aria-hidden className="h-0" />
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
