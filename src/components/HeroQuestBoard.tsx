'use client';

// HeroQuest top-level board component — orchestrates the lobby, the in-game
// canvas + character sheet + dice + actions, and the finished screen. All
// real rendering lives in components/heroquest/* sub-components; this file
// is just wiring + the action bar.

import { useEffect, useRef, useState } from 'react';
import {
  type HQState,
  type Hero,
  type HeroClass,
  type Coord,
  type SpellElement,
  HERO_DEFAULTS,
  hasLineOfSight,
  SPELLS,
} from '@/lib/games/heroquest';
import HeroLobby from './heroquest/HeroLobby';
import HeroQuestBoardCanvas from './heroquest/Board';
import CharacterSheet from './heroquest/CharacterSheet';
import DicePanel, { DiceRollOverlay, calcBoardDelay } from './heroquest/DicePanel';
import { TreasureCardOverlay } from './heroquest/TreasureCardOverlay';
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
  onCastSpell: (spellId: string, opts?: { targetMonsterId?: string; targetHeroIdx?: number; targetDoorId?: string }) => void;
  onUsePotion: (potionId: string) => void;
  onPassPotion: (potionId: string, toHeroSeat: number) => void;
  onEndTurn: () => void;
  /** Advance Zargon's turn by one monster (the host drives this on a timer). */
  onZargonStep: () => void;
  /** Resolve a 0-BP death-save prompt. */
  onDeathSave: (choice: 'potion' | 'spell' | 'decline') => void;
  /** During the pre-quest spell draft, the current picker selects a school. */
  onPickSpellSchool: (school: 'air' | 'water' | 'fire' | 'earth') => void;
  /** Resolve the exit-dungeon prompt (hero reached the stairway with objective complete). */
  onExitDungeon: (confirm: boolean) => void;
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
    if (state.pendingDeathSave) return; // wait for the hero's player to resolve the save
    const t = setTimeout(() => props.onZargonStep(), 1500); // slow enough to follow each monster
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.zargonActiveId, state.zargonQueue?.length, props.isHost, state.pendingDeathSave]);

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

  if (state.phase === 'spell_draft' && state.spellDraft) {
    return (
      <SpellDraftView
        state={state}
        currentUserId={props.currentUserId}
        onPickSchool={props.onPickSpellSchool}
      />
    );
  }

  if (state.phase === 'finished') {
    return <FinishedView state={state} />;
  }

  const dyingHero = state.pendingDeathSave
    ? state.heroes[state.pendingDeathSave.heroIdx]
    : null;
  const isMyDeathSave = dyingHero?.playerId === props.currentUserId;

  const exitHero = state.pendingPrompt?.kind === 'exit_dungeon'
    ? state.heroes[state.pendingPrompt.heroIdx]
    : null;
  const isMyExit = exitHero?.playerId === props.currentUserId;

  return (
    <>
      {briefingOpen && (
        <QuestBriefing quest={state.quest} onClose={() => setBriefingOpen(false)} />
      )}
      {state.pendingDeathSave && dyingHero && (
        <DeathSaveModal
          hero={dyingHero}
          canPotion={state.pendingDeathSave.canPotion}
          canSpell={state.pendingDeathSave.canSpell}
          spellId={state.pendingDeathSave.spellId}
          isMyHero={isMyDeathSave}
          onChoice={props.onDeathSave}
        />
      )}
      {exitHero && (
        <ExitDungeonModal
          hero={exitHero}
          isMyHero={isMyExit}
          companions={state.heroes.filter(h => h.body > 0 && h.seat !== exitHero.seat)}
          onChoice={props.onExitDungeon}
        />
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
  onSearchTreasure, onSearchTraps, onSearchSecrets, onDisarmTrap, onJumpTrap, onClimbPit, onCastSpell, onUsePotion, onPassPotion, onEndTurn,
  onShowBriefing,
}: HeroQuestBoardProps & { onShowBriefing: () => void }) {
  // The sheet always shows the ACTIVE hero (whoever's up). Since players
  // can control multiple heroes, this matches whatever's happening on the
  // board — when it's your hero's turn you see your stats, when it's
  // another hero's turn (yours or someone else's) you see theirs.
  const active = state.heroes[state.turnIndex];
  const isMyTurn = active?.playerId === currentUserId;
  const focusHero = active;

  // Board display state — held at the pre-attack snapshot during dice animations
  // so monster HP / death isn't revealed on the map before the dice settle.
  // The dice panel and overlay always use the live `state`; only the board canvas
  // uses `boardState`. Non-combat state changes (movement, doors, turn changes)
  // apply immediately. Combat rolls are delayed to match the overlay duration.
  const [boardState, setBoardState] = useState<typeof state>(state);
  const latestStateRef = useRef(state);
  const combatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCombatSigRef = useRef('');
  useEffect(() => {
    latestStateRef.current = state;
    // Detect a new combat roll (attack/defense dice — not movement).
    const sig = (state.lastRoll?.faces ?? []).join(',') + '|' + (state.lastDefenseRoll?.faces ?? []).join(',');
    const isNewCombat = sig !== lastCombatSigRef.current && (state.lastRoll != null || state.lastDefenseRoll != null);
    if (isNewCombat) {
      lastCombatSigRef.current = sig;
      // Delay board update to match the one-die-at-a-time overlay animation.
      // calcBoardDelay handles attack-only, defense-only (Fire/Ball of Flame
      // save rolls), and two-beat (attack + defense) based on actual dice counts.
      const ms = calcBoardDelay(
        state.lastRoll?.faces.length ?? 0,
        state.lastDefenseRoll?.faces.length ?? 0,
      );
      if (combatTimerRef.current) clearTimeout(combatTimerRef.current);
      combatTimerRef.current = setTimeout(() => {
        setBoardState(latestStateRef.current);
        combatTimerRef.current = null;
      }, ms);
      // Don't update boardState now — keep showing the pre-attack board
    } else if (combatTimerRef.current === null) {
      // No animation in progress — apply state changes immediately
      setBoardState(state);
    }
    // If a timer IS running and a non-combat state update arrives (e.g. turn
    // advances automatically), latestStateRef is updated so the timer will
    // pick up the latest state when it fires.
  }, [state]);

  // Spell targeting: clicking a spell that needs a target parks it here until
  // the player picks a monster (on the board) or a hero (from the picker bar).
  // 'area' spells resolve immediately with no pick.
  // 'genie' spells show a mode-choice first (door vs monster); then mode becomes 'door' or 'monster'.
  const [pendingSpell, setPendingSpell] = useState<{ id: string; name: string; target: 'monster' | 'hero' | 'genie' | 'door' } | null>(null);

  // Drop any pending target selection the moment it's no longer actionable
  // (turn passed, hero already acted, etc.).
  useEffect(() => {
    if (pendingSpell && (!isMyTurn || !focusHero || focusHero.hasActed)) setPendingSpell(null);
  }, [pendingSpell, isMyTurn, focusHero]);

  // Potion pass mode: the player clicks 🤝 in the character sheet to start board-
  // select mode, then clicks a hero token on the board to complete the pass.
  // Esc cancels at any time; the mode also auto-clears when the turn ends.
  const [passingPotionId, setPassingPotionId] = useState<string | null>(null);
  useEffect(() => {
    if (passingPotionId && !isMyTurn) setPassingPotionId(null);
  }, [passingPotionId, isMyTurn]);
  useEffect(() => {
    if (!passingPotionId) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPassingPotionId(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [passingPotionId]);

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
    // 'genie' shows a mode chooser (open door vs attack); everything else goes straight to target-pick.
    setPendingSpell({ id: spell.id, name: spell.name, target: spell.target as 'monster' | 'hero' | 'genie' });
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

  // True when any living monster occupies the same room/region as the active hero.
  // Rulebook: you cannot search for treasure, traps, or secret doors while monsters
  // are in the room — all three search actions are blocked simultaneously.
  // We check BOTH the monster's physical tile region AND its roomId field.
  // A wandering monster may spawn on an adjacent corridor tile (if all room cells
  // are occupied) — its tile-region would differ from the hero's room, but its
  // roomId is always set to the triggering hero's room region at spawn time.
  const heroRegion = focusHero ? (state.tiles[focusHero.at.y]?.[focusHero.at.x]?.region ?? '') : '';
  const monstersInMyRoom = heroRegion.length > 0 && state.monsters.some(
    m => m.body > 0 && (
      (state.tiles[m.at.y]?.[m.at.x]?.region ?? '') === heroRegion ||
      m.roomId === heroRegion
    ),
  );

  // Track search exhaustion for buttons. Treasure is still per-hero (each hero
  // can search a room for treasure independently). Traps and secret doors are
  // party-wide — once any hero searches an area the search is done for everyone,
  // so we check across all heroes rather than just the active one.
  // The engine also enforces these server-side, but greying the button prevents
  // the "action appears consumed" UX bug (optimisticActed sticks when the engine
  // returns an error and hasActed never changes).
  const heroInRoom = heroRegion.startsWith('room_');
  const alreadySearchedTreasure = !heroInRoom || (focusHero?.searchedRooms ?? []).includes(heroRegion);
  const alreadySearchedTraps    = heroRegion.length > 0 && state.heroes.some(h => (h.searchedTraps   ?? []).includes(heroRegion));
  const alreadySearchedSecrets  = heroRegion.length > 0 && state.heroes.some(h => (h.searchedSecrets ?? []).includes(heroRegion));

  // Heroes the active hero can pass a potion to: alive, orthogonally adjacent
  // (Manhattan dist === 1), and no monster adjacent to EITHER party.
  // Computed once and passed down to the active hero's CharacterSheet so the
  // PotionRow can offer a "pass to" picker without needing full state access.
  const noMonsterAdjacentToPasser = focusHero ? !state.monsters.some(m => m.body > 0 &&
    Math.abs(m.at.x - focusHero.at.x) + Math.abs(m.at.y - focusHero.at.y) === 1) : false;
  const passTargets: Array<{ hero: (typeof state.heroes)[0]; blocked: boolean }> = !focusHero ? [] :
    state.heroes
      .filter(h => h.seat !== focusHero.seat && h.body > 0 &&
        Math.abs(h.at.x - focusHero.at.x) + Math.abs(h.at.y - focusHero.at.y) === 1)
      .map(h => ({
        hero: h,
        // Blocked if a monster is adjacent to the receiver, or to the passer.
        blocked: !noMonsterAdjacentToPasser || state.monsters.some(m => m.body > 0 &&
          Math.abs(m.at.x - h.at.x) + Math.abs(m.at.y - h.at.y) === 1),
      }));
  // Unblocked seats only — these are the hero tokens that glow on the board
  // during pass mode so the player can click them to complete the pass.
  const passTargetSeats = new Set(passTargets.filter(t => !t.blocked).map(t => t.hero.seat));

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
            ) : pendingSpell.target === 'door' ? (
              <span className="text-amber-200/90">click any closed door on the board to open it.</span>
            ) : pendingSpell.target === 'genie' ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-amber-200/90">choose the genie&apos;s task:</span>
                <button
                  type="button"
                  onClick={() => setPendingSpell(ps => ps ? { ...ps, target: 'door' } : null)}
                  className="rounded border border-amber-400/60 bg-neutral-900/60 px-2 py-0.5 text-xs font-medium text-amber-100 transition hover:border-amber-300 hover:bg-amber-500/20"
                >🚪 Open a door</button>
                <button
                  type="button"
                  onClick={() => setPendingSpell(ps => ps ? { ...ps, target: 'monster' } : null)}
                  className="rounded border border-amber-400/60 bg-neutral-900/60 px-2 py-0.5 text-xs font-medium text-amber-100 transition hover:border-amber-300 hover:bg-amber-500/20"
                >⚔️ Attack a monster</button>
              </span>
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
          monstersInMyRoom={monstersInMyRoom}
          alreadySearchedTreasure={alreadySearchedTreasure}
          alreadySearchedTraps={alreadySearchedTraps}
          alreadySearchedSecrets={alreadySearchedSecrets}
          deckSize={state.treasureDeck.length}
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

        {/* One panel per hero in the party (the active hero is highlighted).
            shrink-0 keeps each panel its natural size so the column is static. */}
        {state.heroes.map(h => (
          <div key={`${h.playerId}-${h.seat}`} className="shrink-0">
            <CharacterSheet
              compact
              hero={h}
              isActive={h.seat === active?.seat}
              isMyTurn={isMyTurn}
              isMine={h.playerId === currentUserId}
              onCastSpell={handleSpellClick}
              onUsePotion={onUsePotion}
              passTargets={h.seat === active?.seat ? passTargets : []}
              passingPotionId={h.seat === active?.seat ? passingPotionId : null}
              onStartPass={h.seat === active?.seat ? (id) => setPassingPotionId(id) : undefined}
            />
          </div>
        ))}

        {/* Dice panel sits right under the hero panels — always visible and a
            fixed size (shrink-0) so the column never jumps. The roll overlay
            flies here on exit (targeted by this id). */}
        <div id="hq-dice-panel" className="shrink-0">
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
          state={boardState}
          currentUserId={currentUserId}
          disabled={disabled || !isMyTurn}
          onMoveTo={onMoveTo}
          onMovePath={onMovePath}
          onOpenDoor={onOpenDoor}
          onAttack={onAttack}
          spellTargetMonsters={pendingSpell?.target === 'monster'}
          onPickMonster={(monsterId) => { if (pendingSpell) { onCastSpell(pendingSpell.id, { targetMonsterId: monsterId }); setPendingSpell(null); } }}
          spellTargetDoor={pendingSpell?.target === 'door'}
          onPickDoor={(doorId) => { if (pendingSpell) { onCastSpell(pendingSpell.id, { targetDoorId: doorId }); setPendingSpell(null); } }}
          passTargetSeats={passingPotionId ? passTargetSeats : undefined}
          onPassToHero={(seat) => { if (passingPotionId) { onPassPotion(passingPotionId, seat); setPassingPotionId(null); } }}
        />
        <DiceRollOverlay attack={state.lastRoll} defense={state.lastDefenseRoll} move={state.lastMoveRoll} />
        <TreasureCardOverlay fx={state.lastTreasureFx} />
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
  isMyTurn, myHero, disabled, monstersInMyRoom,
  alreadySearchedTreasure, alreadySearchedTraps, alreadySearchedSecrets,
  deckSize,
  onRollMove, onSearchTreasure, onSearchTraps, onSearchSecrets, onClimbPit, onEndTurn,
  adjacentMonsterId, onAttack, onCastSpellClick,
  disarmableTrapId, onDisarmTrap, jumpableTrapId, onJumpTrap,
}: {
  isMyTurn: boolean;
  myHero: ReturnType<HQState['heroes']['find']>;
  disabled: boolean;
  /** True when any living monster is in the same room/region — blocks all searches. */
  monstersInMyRoom: boolean;
  /** True when this hero has already searched for treasure in the current room. */
  alreadySearchedTreasure: boolean;
  /** True when this hero has already searched for traps in the current region. */
  alreadySearchedTraps: boolean;
  /** True when this hero has already searched for secret doors in the current region. */
  alreadySearchedSecrets: boolean;
  /** Current size of the treasure deck (drives the good-card % badge). */
  deckSize: number;
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
  // Optimistic "I've spent my action" flag. The game is server-authoritative,
  // so hero.hasActed only flips after the move round-trips through Supabase —
  // leaving a window where a player could fire a second action (e.g. click all
  // three searches) before the real state arrives. We grey the action buttons
  // immediately on click, and let the authoritative `acted` take over once it
  // lands. Reset whenever the turn or the confirmed acted-state changes.
  const [optimisticActed, setOptimisticActed] = useState(false);
  const acted = (myHero?.hasActed ?? false) || optimisticActed;
  useEffect(() => {
    // Drop the optimism when the server confirms the action (hasActed=true), a
    // new turn begins, or the turn passes to a DIFFERENT hero. Keying on the
    // hero's seat is essential: with one player controlling all four heroes,
    // hasActed (false→false) and isMyTurn (true→true) don't change as the turn
    // hands off, so without `seat` the flag would carry over and wrongly grey
    // out the next hero's actions.
    setOptimisticActed(false);
  }, [myHero?.seat, myHero?.hasActed, isMyTurn]);

  // For spectators / between-turns, render a quieter status line.
  if (!myHero) {
    return (
      <div className="rounded-lg border border-amber-900/40 bg-neutral-900 px-3 py-2 text-xs text-amber-200/60 text-center">
        Spectating · waiting for the heroes to act.
      </div>
    );
  }

  const canAct = isMyTurn && !disabled && myHero.body > 0;
  // Wrap an action-committing click so the whole action bar greys out at once.
  const act = (fn: () => void) => { setOptimisticActed(true); fn(); };
  const moveText = myHero.hasRolled ? `Move ${myHero.moveLeft}/${myHero.moveRolled}` : 'Roll movement';
  const spells = myHero.spells ?? [];

  // Treasure deck odds — shown as a badge on the Search Treasure button.
  // 24 cards total: 14 permanently-removable good cards (gold/gems/potions) +
  // 10 cycling cards (hazard + wandering monster) that always return to the deck.
  const DECK_GOOD_MAX = 14;
  const DECK_MIN      = 10; // cycling cards never leave
  const deckGood      = Math.max(0, deckSize - DECK_MIN);
  // % of the CURRENT deck that is good (i.e. your odds of drawing a reward)
  const deckGoodPct   = deckSize > 0 ? Math.round(deckGood / deckSize * 100) : 0;
  const deckBadge     = `${deckGoodPct}%`;

  return (
    <div className="shrink-0 rounded-lg border border-amber-900/50 bg-neutral-900/70 p-2">
      {/* Icon-only action grid — labels live in the tooltip / screen-reader text.
          The roll die carries a small badge with movement remaining once rolled. */}
      {/* Row 1: movement + combat + spell + treasure */}
      <div className="grid grid-cols-4 gap-2">
        <ActionButton label={moveText} icon="🎲" onClick={onRollMove} disabled={!canAct || myHero.hasRolled || myHero.inPit} flavor="amber"
          badge={myHero.hasRolled ? `${myHero.moveLeft}/${myHero.moveRolled}` : undefined}
          tip="Roll 3d4 for movement, then drag your hero square by square (no diagonals). You don't have to use it all." />
        <ActionButton label="Attack" icon="⚔️" onClick={() => adjacentMonsterId && act(() => onAttack(adjacentMonsterId))} disabled={!canAct || acted || !adjacentMonsterId} flavor="rose"
          tip="Attack an adjacent monster with your weapon's dice. Each skull is a hit; the monster defends with its shields. One action per turn." />
        {/* Cast spell — dropdown anchors left so it doesn't clip the right edge */}
        <div className="relative">
          <ActionButton label="Cast spell" icon="✨" onClick={() => setSpellMenu(v => !v)} disabled={!canAct || acted || spells.length === 0} flavor="indigo"
            tip="Cast one of your spells (Elf/Wizard) at anything you can see. Each spell can be cast once per quest." />
          {spellMenu && spells.length > 0 && (
            <div className="absolute left-0 z-30 mt-1 w-52 rounded-md border border-amber-700/60 bg-neutral-900 p-1 shadow-xl">
              {spells.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (s.target === 'area') setOptimisticActed(true);
                    onCastSpellClick(s.id);
                    setSpellMenu(false);
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-amber-100 transition hover:bg-amber-800/40"
                >
                  <span className="font-semibold">{s.name}</span>
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-300/70">{s.element}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <ActionButton label="Search treasure" icon="💰" onClick={() => act(onSearchTreasure)}
          disabled={!canAct || acted || monstersInMyRoom || alreadySearchedTreasure} flavor="emerald"
          badge={deckBadge}
          tip={monstersInMyRoom ? 'Cannot search — monsters are in the room!'
            : alreadySearchedTreasure ? 'You have already searched this room for treasure.'
            : `Search for treasure — ${deckGood} of ${DECK_GOOD_MAX} good cards remain (${deckGoodPct}% chance of a reward). Once per hero per room.`} />
      </div>
      {/* Row 2: searches + disarm + jump */}
      <div className="mt-2 grid grid-cols-4 gap-2">
        <ActionButton label="Secret doors" icon="🚪" onClick={() => act(onSearchSecrets)}
          disabled={!canAct || acted || monstersInMyRoom || alreadySearchedSecrets} flavor="indigo"
          tip={monstersInMyRoom ? 'Cannot search — monsters are in the room!'
            : alreadySearchedSecrets ? 'This area has already been searched for secret doors.'
            : 'Search your room or corridor for hidden doors.'} />
        <ActionButton label="Search traps" icon="🪤" onClick={() => act(onSearchTraps)}
          disabled={!canAct || acted || monstersInMyRoom || alreadySearchedTraps} flavor="orange"
          tip={monstersInMyRoom ? 'Cannot search — monsters are in the room!'
            : alreadySearchedTraps ? 'This area has already been searched for traps.'
            : 'Reveal any hidden traps in your room or corridor. Search before you loot a chest!'} />
        <ActionButton label="Disarm trap" icon="🛠️" onClick={() => disarmableTrapId && act(() => onDisarmTrap(disarmableTrapId))} disabled={!canAct || acted || !disarmableTrapId} flavor="orange"
          tip="Disarm an adjacent discovered trap. The Dwarf is best at it; everyone else needs a Tool Kit." />
        {/* Jumping is part of movement, not an action — never gated by `acted`. */}
        <ActionButton label="Jump trap" icon="🤸" onClick={() => jumpableTrapId && onJumpTrap(jumpableTrapId)} disabled={!canAct || !jumpableTrapId} flavor="amber"
          tip="Leap over a discovered trap (needs 2+ movement and a clear landing). A shield clears it; a skull springs it. Not an action." />
      </div>
      {/* Climb (only when in a pit) + End Turn — End Turn spans the rest. */}
      <div className="mt-2 grid grid-cols-4 gap-2">
        {myHero.inPit && (
          <ActionButton wide label="Climb out (costs 2 movement)" icon="⬆️" onClick={onClimbPit} disabled={!canAct || myHero.moveLeft < 2} flavor="orange"
            tip="Climb out of the pit you fell into (costs 2 movement)." />
        )}
        <div className={myHero.inPit ? 'col-span-3' : 'col-span-4'}>
          <ActionButton wide label="End turn" icon="⏭️" onClick={onEndTurn} disabled={!canAct} flavor="slate"
            tip="Finish your turn and pass to the next hero (then Zargon moves the monsters)." />
        </div>
      </div>
    </div>
  );
}

const ACTION_FLAVORS: Record<'amber' | 'emerald' | 'rose' | 'indigo' | 'orange' | 'slate', { from: string; to: string; border: string }> = {
  amber:   { from: '#8a5a08', to: '#3a2408', border: '#d4a043' },
  emerald: { from: '#1a5a3a', to: '#0a2a1a', border: '#43c084' },
  rose:    { from: '#7a1a3a', to: '#3a0a18', border: '#d04a6a' },
  indigo:  { from: '#1a2a7a', to: '#0a103a', border: '#4a60d0' },
  orange:  { from: '#8a4a08', to: '#3a2008', border: '#d4783a' },
  slate:   { from: '#3a3a3a', to: '#1a1a1a', border: '#7a7a7a' },
};

/** Large icon-only action button. The label lives only in the tooltip + an
 *  sr-only span (kept for accessibility); an optional corner badge surfaces a
 *  live number such as movement remaining. `wide` stretches it (End Turn). */
function ActionButton({ label, icon, onClick, disabled, flavor, tip, badge, wide = false }: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled: boolean;
  flavor: 'amber' | 'emerald' | 'rose' | 'indigo' | 'orange' | 'slate';
  /** Hover tooltip explaining what the action does (for new players). */
  tip?: string;
  /** Small corner badge (e.g. movement squares left). */
  badge?: string;
  /** Stretch full width + shorter (used for End Turn). */
  wide?: boolean;
}) {
  const f = ACTION_FLAVORS[flavor];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tip ?? label}
      aria-label={label}
      className={`relative flex w-full items-center justify-center rounded-lg border-2 transition disabled:cursor-not-allowed disabled:opacity-30 hover:-translate-y-0.5 hover:shadow-lg ${
        wide ? 'h-11' : 'h-16'
      }`}
      style={{
        background: `linear-gradient(180deg, ${f.from} 0%, ${f.to} 100%)`,
        borderColor: f.border,
        color: '#fff7e0',
        textShadow: '0 1px 2px rgba(0,0,0,0.7)',
      }}
    >
      <span className={wide ? 'text-2xl leading-none' : 'text-3xl leading-none'}>{icon}</span>
      {badge && (
        <span className="absolute bottom-0.5 right-1 rounded bg-black/75 px-1 text-[11px] font-bold leading-tight text-amber-100">
          {badge}
        </span>
      )}
      <span className="sr-only">{label}</span>
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

// ============================================================================
// Spell draft screen (#73)
// ============================================================================

const ELEMENT_LABEL: Record<SpellElement, string> = {
  air:   '💨 Air',
  water: '💧 Water',
  fire:  '🔥 Fire',
  earth: '🌿 Earth',
};
const ELEMENT_COLOR: Record<SpellElement, string> = {
  air:   '#93c5fd', // blue-300
  water: '#67e8f9', // cyan-300
  fire:  '#fb923c', // orange-400
  earth: '#86efac', // green-300
};

function SpellDraftView({
  state,
  currentUserId,
  onPickSchool,
}: {
  state: HQState;
  currentUserId: string;
  onPickSchool: (school: SpellElement) => void;
}) {
  const draft = state.spellDraft!;
  const isWizardStep = draft.step === 'wizard';
  const pickerClass  = isWizardStep ? 'wizard' : 'elf';
  const pickerHero   = state.heroes.find(h => h.klass === pickerClass);
  const isMyTurn     = pickerHero?.playerId === currentUserId;

  // All 12 spells grouped by element, for display
  const grouped = (['air', 'water', 'fire', 'earth'] as SpellElement[]).map(el => ({
    el,
    spells: SPELLS.filter(sp => sp.element === el),
  }));

  return (
    <div
      className="min-h-0 flex flex-col items-center gap-4 p-4 overflow-y-auto"
      style={{ background: 'radial-gradient(ellipse at top, #1a0a00 0%, #0a0400 100%)', color: '#fde7c0', fontFamily: 'Georgia, serif' }}
    >
      <div className="text-center">
        <div className="text-2xl font-bold uppercase tracking-widest mb-1" style={{ color: '#d4a043' }}>
          ✦ Spell School Draft ✦
        </div>
        <div className="text-sm text-amber-200/70 max-w-md">
          {isMyTurn
            ? `You are the ${HERO_DEFAULTS[pickerClass].name}. Choose one school of magic — those three spells will be yours.`
            : `The ${HERO_DEFAULTS[pickerClass].name} is choosing their spell school…`}
          {isWizardStep && <span className="block mt-1 text-amber-200/50 text-xs">The Wizard picks first; the Elf picks next; the Wizard receives all remaining schools.</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
        {grouped.map(({ el, spells }) => {
          const available = draft.remaining.includes(el);
          const color = ELEMENT_COLOR[el];
          return (
            <button
              key={el}
              disabled={!isMyTurn || !available}
              onClick={() => onPickSchool(el)}
              className="rounded-xl border-2 p-3 text-left transition"
              style={{
                borderColor: available ? color : '#3a3028',
                background: available
                  ? `linear-gradient(135deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.5) 100%)`
                  : 'rgba(0,0,0,0.3)',
                opacity: available ? 1 : 0.4,
                cursor: available && isMyTurn ? 'pointer' : 'default',
                boxShadow: available && isMyTurn ? `0 0 12px ${color}44` : 'none',
              }}
            >
              <div className="font-bold text-base mb-2" style={{ color: available ? color : '#6b5a40' }}>
                {ELEMENT_LABEL[el]}
                {!available && <span className="ml-2 text-xs text-rose-400/70">(taken)</span>}
              </div>
              <ul className="space-y-1">
                {spells.map(sp => (
                  <li key={sp.id} className="text-xs" style={{ color: '#d6c4a0' }}>
                    <span className="font-semibold" style={{ color: available ? color : '#6b5a40' }}>{sp.name}</span>
                    <span className="ml-1 text-amber-200/60">— {sp.text}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {!isMyTurn && (
        <div className="text-sm text-amber-200/50 mt-2">
          Waiting for <strong style={{ color: '#d4a043' }}>{pickerHero?.username ?? HERO_DEFAULTS[pickerClass].name}</strong> to pick…
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Death-save modal
// ============================================================================

function DeathSaveModal({
  hero, canPotion, canSpell, spellId, isMyHero, onChoice,
}: {
  hero: Hero;
  canPotion: boolean;
  canSpell: boolean;
  spellId: string | null;
  isMyHero: boolean;
  onChoice: (choice: 'potion' | 'spell' | 'decline') => void;
}) {
  const heroName = HERO_DEFAULTS[hero.klass].name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)' }}
    >
      <div
        className="mx-4 max-w-sm w-full rounded-2xl border-4 p-6 text-center shadow-2xl"
        style={{
          borderColor: '#8a1010',
          background: 'radial-gradient(ellipse at top, #4a0808 0%, #150202 100%)',
          color: '#fda4af',
          fontFamily: 'Georgia, serif',
        }}
      >
        <div className="text-3xl mb-2">💀</div>
        <div className="text-xl font-bold uppercase tracking-widest mb-1" style={{ color: '#ff6666', textShadow: '0 2px 4px rgba(0,0,0,0.7)' }}>
          {heroName} has fallen!
        </div>
        <div className="text-sm mb-4 text-rose-200/80">
          {isMyHero
            ? 'You are at 0 Body Points. Spend a resource to survive?'
            : `${heroName} is at death's door — waiting for their player to decide…`}
        </div>

        {isMyHero && (
          <div className="flex flex-col gap-2">
            {canPotion && (
              <button
                className="rounded-lg border border-amber-600/60 bg-amber-900/50 px-4 py-2 text-sm text-amber-200 transition hover:bg-amber-800/70 active:scale-95"
                onClick={() => onChoice('potion')}
              >
                🧪 Drink Potion of Healing (restore 1–6 BP)
              </button>
            )}
            {canSpell && (
              <button
                className="rounded-lg border border-sky-600/60 bg-sky-900/50 px-4 py-2 text-sm text-sky-200 transition hover:bg-sky-800/70 active:scale-95"
                onClick={() => onChoice('spell')}
              >
                ✨ Cast healing spell
                {spellId === 'water_heal' ? ' (+2 BP)' : ' (+4 BP)'}
              </button>
            )}
            <button
              className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-2 text-sm text-rose-400/70 transition hover:bg-rose-900/40 active:scale-95"
              onClick={() => onChoice('decline')}
            >
              Accept fate — perish
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Exit-dungeon modal
// ============================================================================

function ExitDungeonModal({
  hero, isMyHero, companions, onChoice,
}: {
  hero: Hero;
  isMyHero: boolean;
  companions: Hero[];
  onChoice: (confirm: boolean) => void;
}) {
  const heroName = HERO_DEFAULTS[hero.klass].name;
  const companionNames = companions.map(h => HERO_DEFAULTS[h.klass].name).join(', ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.80)' }}
    >
      <div
        className="mx-4 max-w-sm w-full rounded-2xl border-4 p-6 text-center shadow-2xl"
        style={{
          borderColor: '#a07830',
          background: 'radial-gradient(ellipse at top, #2a1f08 0%, #0e0a02 100%)',
          color: '#e8d4a0',
          fontFamily: 'Georgia, serif',
        }}
      >
        <div className="text-3xl mb-2">🪜</div>
        <div
          className="text-xl font-bold uppercase tracking-widest mb-1"
          style={{ color: '#f0c060', textShadow: '0 2px 8px rgba(200,140,0,0.5)' }}
        >
          The way out!
        </div>

        {isMyHero ? (
          <>
            <div className="text-sm mb-3" style={{ color: '#c8a870' }}>
              <strong style={{ color: '#f0c060' }}>{heroName}</strong> stands at the stairway.
              Leaving now ends the quest for the entire party.
            </div>

            {companions.length > 0 && (
              <div
                className="rounded-lg border px-3 py-2 mb-4 text-xs"
                style={{ borderColor: '#8a6020', background: 'rgba(80,50,0,0.4)', color: '#c8a060' }}
              >
                ⚠️ <strong>Warning:</strong> {companionNames}{' '}
                {companions.length === 1 ? 'is' : 'are'} still in the dungeon.
                {' '}Heroes left behind cannot return — if they die before you leave,
                they lose all their equipment, items and gold.
              </div>
            )}

            <div className="flex flex-col gap-2 mt-2">
              <button
                className="rounded-lg border px-4 py-2 text-sm font-semibold transition active:scale-95"
                style={{
                  borderColor: '#a07830',
                  background: 'linear-gradient(135deg, #6b4e10, #3a2a04)',
                  color: '#f0d080',
                }}
                onClick={() => onChoice(true)}
              >
                Leave the dungeon — quest complete!
              </button>
              <button
                className="rounded-lg border px-4 py-2 text-sm transition active:scale-95"
                style={{
                  borderColor: '#554030',
                  background: 'rgba(40,25,5,0.6)',
                  color: '#a08060',
                }}
                onClick={() => onChoice(false)}
              >
                Wait for companions
              </button>
            </div>
          </>
        ) : (
          <div className="text-sm" style={{ color: '#c8a870' }}>
            <strong style={{ color: '#f0c060' }}>{heroName}</strong> has reached the stairway —
            waiting for them to decide whether to leave…
          </div>
        )}
      </div>
    </div>
  );
}
