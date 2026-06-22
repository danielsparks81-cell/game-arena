'use client';

// Central registry of per-game board renderers. Keeps the giant if/else out
// of RoomClient and gives each game one self-contained place to define how
// its board surfaces in the room.
//
// Every callback funnels through the single `gameMove(roomId, action)` server
// action (registerGame Phase C), so adding a new game means: register the
// board renderer here AND add the matching `action.kind` to GameAction in
// actions.ts. No more importing 17 individual server actions per board.
//
// Board components are loaded LAZILY via next/dynamic. A player who's in a
// Tic-Tac-Toe room never downloads Long Shot's 2400-line board or Boggle's
// 178k-word dictionary. Critical for scaling the catalog past ~20 games.

import type React from 'react';
import dynamic from 'next/dynamic';
import { unlockAudio as _unlockAudio } from '@/lib/sounds';

// Lightweight placeholder shown while a board's chunk is downloading. Stays
// minimal so the rest of the room UI (members panel, top bar) renders first.
const BoardLoading = () => (
  <div className="mx-auto flex h-64 max-w-md items-center justify-center text-sm text-neutral-500">
    Loading board…
  </div>
);

const TicTacToeBoard       = dynamic(() => import('@/components/TicTacToeBoard'),       { loading: BoardLoading, ssr: false });
const ConnectFourBoard     = dynamic(() => import('@/components/ConnectFourBoard'),     { loading: BoardLoading, ssr: false });
const CheckersBoard        = dynamic(() => import('@/components/CheckersBoard'),        { loading: BoardLoading, ssr: false });
const BattleshipBoard      = dynamic(() => import('@/components/BattleshipBoard'),      { loading: BoardLoading, ssr: false });
const BoggleBoard          = dynamic(() => import('@/components/BoggleBoard'),          { loading: BoardLoading, ssr: false });
const LiarsDiceBoard       = dynamic(() => import('@/components/LiarsDiceBoard'),       { loading: BoardLoading, ssr: false });
const YahtzeeBoard         = dynamic(() => import('@/components/YahtzeeBoard'),         { loading: BoardLoading, ssr: false });
const LongShotBoard        = dynamic(() => import('@/components/LongShotBoard'),        { loading: BoardLoading, ssr: false });
const LongShotPlaceholder  = dynamic(() => import('@/components/LongShotPlaceholder'),  { loading: BoardLoading, ssr: false });
const RpsBoard             = dynamic(() => import('@/components/RpsBoard'),             { loading: BoardLoading, ssr: false });
const SpellduelBoard       = dynamic(() => import('@/components/SpellduelBoard'),       { loading: BoardLoading, ssr: false });
const LegendaryBoard       = dynamic(() => import('@/components/LegendaryBoard'),       { loading: BoardLoading, ssr: false });
const HeroQuestBoard       = dynamic(() => import('@/components/HeroQuestBoard'),       { loading: BoardLoading, ssr: false });
const HeroScapeBoard       = dynamic(() => import('@/components/HeroScapeBoard'),       { loading: BoardLoading, ssr: false });

import type { TTTState } from './tictactoe';
import type { C4State } from './connect4';
import type { CheckersState } from './checkers';
import type { BSState, BSPayload } from './battleship';
import type { BoggleState, BoggleGameMode } from './boggle';
import type { LDState } from './liarsdice';
import type { YState, Category as YCategory } from './yahtzee';
import type { LSState, ActionPayload } from './longshot';
import type { RPSState, RPSChoice } from './rps';
import type { SDState, ResolvedTarget as SDResolvedTarget } from './spellduel';
import type { LegendaryState } from './legendary';
import type { HQState, HeroClass as HQHeroClass, Coord as HQCoord } from './heroquest';
import type { HSState, HexKey as HSHexKey, OrderMarkerValue as HSOrderMarkerValue, HSChoiceResolution, HSMode, HSEdition } from './heroscape';

import { gameMove } from '@/app/rooms/[id]/actions';

/**
 * Everything a board renderer needs from RoomClient. We pass the whole room
 * because some games (Long Shot) toggle between waiting and playing UI based
 * on the room status, not just the engine state.
 */
export type BoardRenderProps = {
  roomId: string;
  currentUserId: string;
  isHost: boolean;
  status: string;
  state: unknown;
  maxPlayers: number;
  playerCount: number;
  pending: boolean;
  /** React 18+ startTransition — wraps server-action calls so the UI stays
      responsive while the move is in flight. */
  startTransition: (fn: () => void) => void;
};

type Renderer = (p: BoardRenderProps) => React.ReactNode;

// Sound unlock + transition wrapper used by every "this is a move" callback.
function unlockAndRun(
  startTransition: (fn: () => void) => void,
  fn: () => void,
): void {
  _unlockAudio();
  startTransition(fn);
}

export const BOARD_RENDERERS: Record<string, Renderer> = {
  tictactoe: ({ roomId, currentUserId, state, pending, status, startTransition }) => (
    <TicTacToeBoard
      state={state as TTTState}
      currentUserId={currentUserId}
      disabled={pending || status !== 'playing'}
      onMove={(cell) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'tictactoe', kind: 'move', cell }); })}
    />
  ),

  connect4: ({ roomId, currentUserId, state, pending, status, startTransition }) => (
    <ConnectFourBoard
      state={state as C4State}
      currentUserId={currentUserId}
      disabled={pending || status !== 'playing'}
      onMove={(col) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'connect4', kind: 'move', col }); })}
    />
  ),

  checkers: ({ roomId, currentUserId, state, pending, status, startTransition }) => (
    <CheckersBoard
      state={state as CheckersState}
      currentUserId={currentUserId}
      disabled={pending || status !== 'playing'}
      onMove={(from, to) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'checkers', kind: 'move', from, to }); })}
    />
  ),

  battleship: ({ roomId, currentUserId, state, pending, status, startTransition }) => (
    <BattleshipBoard
      state={state as BSState}
      currentUserId={currentUserId}
      // Setup phase is interactive even though status==='playing' only flips
      // after both fleets are ready, so we keep enabled until finished.
      disabled={pending || status === 'finished'}
      onMove={(payload: BSPayload) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'battleship', kind: 'move', payload }); })}
    />
  ),

  boggle: ({ roomId, currentUserId, isHost, state, pending, startTransition }) => (
    <BoggleBoard
      state={state as BoggleState}
      currentUserId={currentUserId}
      isHost={isHost}
      disabled={pending}
      onStart={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'boggle', kind: 'startGame' }); })}
      onSetMode={(mode: BoggleGameMode) => startTransition(() => { gameMove(roomId, { game: 'boggle', kind: 'setMode', mode }); })}
      onNextRound={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'boggle', kind: 'nextRound' }); })}
      onSubmitWord={(word: string) =>
        // gameMove returns Promise<unknown>; the underlying submitWordBoggle
        // resolves with the rich {ok, word} | {ok, error} shape BoggleBoard expects.
        gameMove(roomId, { game: 'boggle', kind: 'submitWord', word }) as Promise<{ ok: true; word: string } | { ok: false; error: string }>
      }
      onFinalize={async () => { await gameMove(roomId, { game: 'boggle', kind: 'finalize' }); }}
    />
  ),

  liarsdice: ({ roomId, currentUserId, isHost, state, pending, startTransition }) => (
    <LiarsDiceBoard
      state={state as LDState}
      currentUserId={currentUserId}
      isHost={isHost}
      disabled={pending}
      onStart={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'liarsdice', kind: 'startGame' }); })}
      onBid={(quantity: number, face: number) => startTransition(() => { gameMove(roomId, { game: 'liarsdice', kind: 'bid', quantity, face }); })}
      onCallLiar={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'liarsdice', kind: 'callLiar' }); })}
      onNextRound={() => startTransition(() => { gameMove(roomId, { game: 'liarsdice', kind: 'nextRound' }); })}
    />
  ),

  yahtzee: ({ roomId, currentUserId, isHost, state, pending, startTransition }) => (
    <YahtzeeBoard
      state={state as YState}
      currentUserId={currentUserId}
      isHost={isHost}
      disabled={pending}
      onStart={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'yahtzee', kind: 'startGame' }); })}
      onRoll={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'yahtzee', kind: 'roll' }); })}
      onToggleHold={(idx: number) => startTransition(() => { gameMove(roomId, { game: 'yahtzee', kind: 'toggleHold', idx }); })}
      onScore={(category: YCategory) => startTransition(() => { gameMove(roomId, { game: 'yahtzee', kind: 'commitScore', category }); })}
    />
  ),

  rps: ({ roomId, currentUserId, state, pending, status, startTransition }) => (
    <RpsBoard
      state={state as RPSState}
      currentUserId={currentUserId}
      disabled={pending || status === 'finished'}
      onMove={(choice: RPSChoice) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'rps', kind: 'move', choice }); })}
    />
  ),

  spellduel: ({ roomId, currentUserId, state, pending, status, startTransition }) => (
    <SpellduelBoard
      state={state as SDState}
      currentUserId={currentUserId}
      disabled={pending || status === 'finished'}
      onDraftPick={(cardId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'spellduel', kind: 'draft_pick', cardId }); })}
      onPlay={(cardIdx, targets?: SDResolvedTarget[]) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'spellduel', kind: 'play', cardIdx, targets }); })}
      onReact={(cardIdx) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'spellduel', kind: 'play_reaction', cardIdx }); })}
      onPassReaction={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'spellduel', kind: 'pass_reaction' }); })}
      onEndTurn={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'spellduel', kind: 'end_turn' }); })}
    />
  ),

  legendary: ({ roomId, currentUserId, isHost, state, pending, startTransition }) => (
    <LegendaryBoard
      state={state as LegendaryState}
      currentUserId={currentUserId}
      isHost={isHost}
      disabled={pending}
      onStart={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'startGame' }); })}
      onSetMastermind={(mastermindId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'set_mastermind', mastermindId }); })}
      onSetScheme={(schemeId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'set_scheme', schemeId }); })}
      onSetHeroClasses={(classNames) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'set_hero_classes', classNames }); })}
      onRandomizeHeroes={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'randomize_heroes' }); })}
      onSetVillainGroups={(groupIds) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'set_villain_groups', groupIds }); })}
      onSetHenchmanGroups={(groupIds) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'set_henchman_groups', groupIds }); })}
      onRandomizeVillains={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'randomize_villains' }); })}
      onRandomizeHenchmen={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'randomize_henchmen' }); })}
      onPlay={(instanceId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'play_card', instanceId }); })}
      onRecruit={(slot) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'recruit_hero', slot }); })}
      onRecruitSidekick={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'recruit_sidekick' }); })}
      onRecruitOfficer={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'recruit_officer' }); })}
      onFightCity={(slot) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'fight_city', slot }); })}
      onFightMastermind={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'fight_mastermind' }); })}
      onResolveChoice={(instanceId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'resolve_choice', instanceId }); })}
      onSkipChoice={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'skip_choice' }); })}
      onAcceptChoice={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'accept_choice' }); })}
      onEndTurn={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'end_turn' }); })}
      onRevealFirstVillain={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'reveal_first_villain' }); })}
      onWoundHeal={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'legendary', kind: 'play_wound_healing' }); })}
    />
  ),

  heroquest: ({ roomId, currentUserId, isHost, state, pending, startTransition }) => (
    <HeroQuestBoard
      state={state as HQState}
      currentUserId={currentUserId}
      isHost={isHost}
      disabled={pending}
      onClaimHero={(seat: number) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'claim_hero', seat }); })}
      onSetClass={(klass: HQHeroClass) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'set_class', classKlass: klass }); })}
      onRandomClasses={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'random_classes' }); })}
      onStart={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'start_game' }); })}
      onRollMove={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'roll_move' }); })}
      onMoveTo={(at: HQCoord) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'move_to', at }); })}
      onMovePath={(path: HQCoord[]) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'move_path', path }); })}
      onOpenDoor={(doorId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'open_door', doorId }); })}
      onAttack={(monsterId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'attack', monsterId }); })}
      onSearchTreasure={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'search_treasure' }); })}
      onSearchTraps={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'search_traps' }); })}
      onSearchSecrets={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'search_secrets' }); })}
      onDisarmTrap={(trapId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'disarm_trap', trapId }); })}
      onJumpTrap={(trapId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'jump_trap', trapId }); })}
      onClimbPit={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'climb_pit' }); })}
      onCastSpell={(spellId, opts) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'cast_spell', spellId, targetMonsterId: opts?.targetMonsterId, targetHeroIdx: opts?.targetHeroIdx, targetDoorId: opts?.targetDoorId }); })}
      onUsePotion={(potionId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'use_potion', potionId }); })}
      onPassPotion={(potionId, toHeroSeat) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'pass_potion', potionId, toHeroSeat }); })}
      onEndTurn={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'end_turn' }); })}
      onZargonStep={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'zargon_step' }); })}
      onDeathSave={(choice) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'death_save', choice }); })}
      onPickSpellSchool={(school) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'pick_spell_school', school }); })}
      onExitDungeon={(confirm) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'exit_dungeon', confirm }); })}
      onFallingBlockMove={(at) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'falling_block_move', at }); })}
      onBuyItem={(heroSeat, itemId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'buy_item', heroSeat, itemId }); })}
      onPassItem={(heroSeat, itemId, toHeroSeat) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'pass_item', heroSeat, itemId, toHeroSeat }); })}
      onPassPotionIntermission={(heroSeat, potionId, toHeroSeat) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'pass_potion_intermission', heroSeat, potionId, toHeroSeat }); })}
      onSellItem={(heroSeat, itemId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'sell_item', heroSeat, itemId }); })}
      onSellPotion={(heroSeat, potionId) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'sell_potion', heroSeat, potionId }); })}
      onGiftGold={(fromSeat, toSeat, amount) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'gift_gold', fromSeat, toSeat, amount }); })}
      onIntermissionReady={(ready) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroquest', kind: 'intermission_ready', ready }); })}
    />
  ),

  heroscape: ({ roomId, currentUserId, isHost, state, pending, startTransition }) => (
    <HeroScapeBoard
      state={state as HSState}
      currentUserId={currentUserId}
      isHost={isHost}
      disabled={pending}
      onStart={(mapId?: string, pointBudget?: number, mode?: HSMode) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'start_game', mapId, pointBudget, mode }); })}
      onSetLobbyConfig={(cfg: { mapId?: string; pointBudget?: number; mode?: HSMode; edition?: HSEdition; teams?: Record<number, number>; teamBudgets?: Record<number, number> }) => startTransition(() => { gameMove(roomId, { game: 'heroscape', kind: 'set_lobby_config', ...cfg }); })}
      onAddBot={(team?: number) => startTransition(() => { gameMove(roomId, { game: 'heroscape', kind: 'add_bot', team }); })}
      onRemoveBot={(seat: number) => startTransition(() => { gameMove(roomId, { game: 'heroscape', kind: 'remove_bot', seat }); })}
      onAiStep={() => { gameMove(roomId, { game: 'heroscape', kind: 'ai_step' }); }}
      onPlaceMarkers={(assignments: { marker: HSOrderMarkerValue; cardUid: string }[]) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'place_markers', assignments }); })}
      onMoveFigure={(figureId: string, to: HSHexKey) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'move_figure', figureId, to }); })}
      onMoveStep={(figureId: string, to: HSHexKey) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'move_step', figureId, to }); })}
      onGrappleMove={(figureId: string, to: HSHexKey) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'grapple_move', figureId, to }); })}
      onFireLine={(attackerId: string, dir: number) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'fire_line', attackerId, dir }); })}
      onExplosion={(attackerId: string, targetId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'explosion', attackerId, targetId }); })}
      onOrient={(figureId: string, dir: number) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'orient_figure', figureId, dir }); })}
      onAttack={(attackerId: string, targetId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'attack', attackerId, targetId }); })}
      onBerserkerCharge={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'berserker_charge' }); })}
      onWaterClone={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'water_clone' }); })}
      onMindShackle={(targetId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'mind_shackle', targetId }); })}
      onChomp={(targetId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'chomp', targetId }); })}
      onGrenade={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'grenade' }); })}
      onGrenadeThrow={(targetId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'grenade_throw', targetId }); })}
      onIceShard={(attackerId: string, targetId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'ice_shard', attackerId, targetId }); })}
      onQueglix={(attackerId: string, targetId: string, dice: 1 | 2 | 3) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'queglix', attackerId, targetId, dice }); })}
      onWildSwing={(attackerId: string, targetId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'wild_swing', attackerId, targetId }); })}
      onAcidBreath={(attackerId: string, targetIds: string[]) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'acid_breath', attackerId, targetIds }); })}
      onThrow={(attackerId: string, targetId: string, to: HSHexKey) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'throw_figure', attackerId, targetId, to }); })}
      onCarry={(figureId: string, to: HSHexKey, passengerId: string, passengerTo: HSHexKey) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'carry_move', figureId, to, passengerId, passengerTo }); })}
      onTheDrop={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'the_drop' }); })}
      onResolveChoice={(choice: HSChoiceResolution) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'resolve_choice', choice }); })}
      onUndoMove={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'undo_move' }); })}
      onEndMove={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'end_move' }); })}
      onEndTurn={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'end_turn' }); })}
      onDraftCard={(cardId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'draft_card', cardId }); })}
      onDraftPass={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'draft_pass' }); })}
      onPlaceFigure={(figureId: string, to: HSHexKey) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'place_figure', figureId, to }); })}
      onUnplaceFigure={(figureId: string) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'unplace_figure', figureId }); })}
      onPlacementReady={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'heroscape', kind: 'placement_ready' }); })}
    />
  ),

  longshot: ({ roomId, currentUserId, isHost, state, pending, status, maxPlayers, playerCount, startTransition }) => (
    status === 'waiting' ? (
      <LongShotPlaceholder
        status={status}
        maxPlayers={maxPlayers}
        playerCount={playerCount}
        isHost={isHost}
        pending={pending}
        onStart={() => startTransition(() => { gameMove(roomId, { game: 'longshot', kind: 'startGame' }); })}
      />
    ) : (
      <LongShotBoard
        state={state as LSState}
        currentUserId={currentUserId}
        disabled={pending}
        onRoll={() => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'longshot', kind: 'roll' }); })}
        onAction={(payload: ActionPayload) => unlockAndRun(startTransition, () => { gameMove(roomId, { game: 'longshot', kind: 'action', payload }); })}
      />
    )
  ),
};
