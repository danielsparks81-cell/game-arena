'use client';

// Legendary board — first pass.
//
// Layout (top-to-bottom):
//   • Mastermind banner + scheme threat meter
//   • City row (5 villain slots, leftmost = newest)
//   • HQ row (5 hero slots for sale)
//   • Resource bar (Attack / Recruit pools, Villain Deck count)
//   • Your hand (clickable to play)
//   • Recent log
//   • Players panel (sidebar style — turn indicator, VP totals)
//
// Per-card target/choice prompts (KO from hand, etc.) come in a later pass;
// right now MVP cards are stat-sticks + simple class/team synergies that
// don't require player decisions mid-resolution.

import React, { useEffect, useRef, useState } from 'react';
import { sounds } from '@/lib/sounds';
import {
  CARDS,
  getCard,
  HQ_SIZE,
  CITY_SIZE,
  SCHEMES,
  MASTERMINDS,
  HERO_CLASSES,
  VILLAIN_GROUPS,
  HENCHMAN_GROUPS,
  type CardId,
  type CardInstance,
  type HeroCardDef,
  type HeroClass,
  type LegendaryEvent,
  type LegendaryState,
  type PendingChoice,
  type PlayerState,
  type MastermindCardDef,
  type SchemeCardDef,
  type VillainCardDef,
  type HenchmanCardDef,
} from '@/lib/games/legendary';
import { SIDEKICK, OFFICER } from '@/lib/games/legendary/heroes/shield';
import { WOUND, teamDisplayName } from '@/lib/games/legendary/cards';
// Card render primitives. Extracted so the sandbox preview at
// /legendary-sandbox renders cards identically — no drift between author-time
// and play-time visuals.
import {
  CLASS_COLORS,
  CLASS_LABELS,
  ClassChips,
  CostBadge,
  CardText,
  useAutoFitFontSize,
  HeroCardArt,
  TeamChip,
  classBorderStyle,
  isShieldStarter,
} from '@/components/legendary/HeroCardArt';
import {
  VillainCardArt,
  HenchmanCardArt,
  TacticCardArt,
  SystemCardArt,
  StrikeIcon,
} from '@/components/legendary/SystemCardArt';
import { CARD_COPIES } from '@/lib/games/legendary';

type Floater = { key: number; seat: number; sign: '+' | '-'; amount: number; tone: 'damage' | 'heal' };

type RevealAnim = {
  key: number;
  cardId: string;
  kind: 'villain' | 'henchman' | 'master_strike' | 'scheme_twist' | 'bystander' | 'hero' | 'tactic' | 'hero_recruited' | 'wound';
  phase: 'entering' | 'showing' | 'exiting';
  /** Pixel offset from viewport center to destination (computed from DOM rects at trigger time). */
  exitX: number;
  exitY: number;
  /** Pixel offset from viewport center to source deck (so the card launches from the deck). */
  startX?: number;
  startY?: number;
  /** For hero reveals: which HQ slot index received the new card (used to hide it until landing). */
  hqSlot?: number;
  /** For master_strike: the active mastermind's strike ability text to show on the card. */
  strikeText?: string;
  /** For master_strike/tactic: the mastermind's name or tactic name shown as a type-label sub-row. */
  typeLabel?: string;
};

/** Extract "Master Strike: …" text from a mastermind def for display on the card. */
function getMasterStrikeText(mastermindId: string): string | undefined {
  const def = CARDS[mastermindId];
  if (!def || def.kind !== 'mastermind') return undefined;
  const text = (def as { text?: string }).text ?? '';
  const m = text.match(/Master Strike[:\s]+(.+)/i);
  return (m?.[1]?.trim()) || (text || undefined);
}

export default function LegendaryBoard({
  state, currentUserId, isHost, disabled,
  onStart, onSetMastermind, onSetScheme, onSetHeroClasses, onRandomizeHeroes,
  onSetVillainGroups, onSetHenchmanGroups, onRandomizeVillains, onRandomizeHenchmen,
  onPlay, onRecruit, onRecruitSidekick, onRecruitOfficer,
  onFightCity, onFightMastermind, onResolveChoice, onSkipChoice, onAcceptChoice, onEndTurn,
  onRevealFirstVillain, onWoundHeal,
}: {
  state: LegendaryState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onStart: () => void;
  /** Host-only lobby config callbacks. */
  onSetMastermind?: (mastermindId: string) => void;
  onSetScheme?: (schemeId: string) => void;
  onSetHeroClasses?: (classNames: string[]) => void;
  onRandomizeHeroes?: () => void;
  onSetVillainGroups?: (groupIds: string[]) => void;
  onSetHenchmanGroups?: (groupIds: string[]) => void;
  onRandomizeVillains?: () => void;
  onRandomizeHenchmen?: () => void;
  onPlay: (instanceId: string) => void;
  onRecruit: (slot: number) => void;
  onRecruitSidekick: () => void;
  onRecruitOfficer: () => void;
  onFightCity: (slot: number) => void;
  onFightMastermind: () => void;
  /** Resolve a pending ko_from_hand / discard_from_hand choice by selecting a card. */
  onResolveChoice: (instanceId: string) => void;
  /** Skip the pending choice (forfeit the bonus). */
  onSkipChoice: () => void;
  /** Accept a binary pending choice (Do-Over / Random Acts) without card selection. */
  onAcceptChoice: () => void;
  onEndTurn: () => void;
  /** Current player clicks "Game Begins" — reveals first villain via the engine. */
  onRevealFirstVillain?: () => void;
  /** Heal wounds: KO all Wounds from hand (only valid when not fought/recruited yet). */
  onWoundHeal?: () => void;
}) {
  const me = state.players.find(p => p.playerId === currentUserId);
  const mySeat = me?.seat ?? -1;
  const currentPlayer = state.players[state.currentPlayerIdx];
  const isMyTurn = state.phase === 'playing' && currentPlayer?.playerId === currentUserId;

  // Pending choice: the engine is waiting for the active player to pick a card
  // from their hand to KO or discard (from a card effect like Diving Block).
  const pendingChoice: PendingChoice | undefined = state.thisTurn.pendingChoice;
  // Choices that target the city, HQ, or deck-peek zone (not the hand) are excluded from hand-choice mode.
  const isChoiceMode = isMyTurn && !!pendingChoice &&
    pendingChoice.kind !== 'free_recruit_from_hq' &&
    pendingChoice.kind !== 'free_recruit_xmen_from_hq' &&
    pendingChoice.kind !== 'ko_up_to_from_discard' &&
    pendingChoice.kind !== 'em_bubble_select_hero' &&
    pendingChoice.kind !== 'solo_twist_tuck_hero' &&
    pendingChoice.kind !== 'escape_ko_hq_hero' &&
    pendingChoice.kind !== 'order_top_of_deck' &&
    pendingChoice.kind !== 'choose_city_villain_for_bystander' &&
    pendingChoice.kind !== 'look_top_two_ko_one_return_one';
  // Binary choices don't require card selection — the player just clicks
  // Accept or Skip in the banner (Deadpool Do-Over / Random Acts, Gambit Hypnotic Charm).
  const isBinaryChoice =
    pendingChoice?.kind === 'discard_hand_draw_four' ||
    pendingChoice?.kind === 'optional_gain_wound_pass_left' ||
    pendingChoice?.kind === 'optional_gain_card' ||
    pendingChoice?.kind === 'reveal_top_discard_or_return' ||
    pendingChoice?.kind === 'choose_others_draw_or_discard' ||
    pendingChoice?.kind === 'optional_return_sidekick_draw_two' ||
    pendingChoice?.kind === 'melter_decide_card';
  const isCopyHeroChoice              = pendingChoice?.kind === 'copy_played_hero';
  const isMoveVillainSelectVillain    = pendingChoice?.kind === 'move_villain_select_villain';
  const isMoveVillainSelectDest       = pendingChoice?.kind === 'move_villain_select_dest';
  const isFreeRecruitFromHQ           = isMyTurn && pendingChoice?.kind === 'free_recruit_from_hq';
  const isFreeRecruitXmenFromHQ       = isMyTurn && pendingChoice?.kind === 'free_recruit_xmen_from_hq';
  const isKoUpToFromDiscard           = isMyTurn && pendingChoice?.kind === 'ko_up_to_from_discard';
  const isEmBubbleSelectHero          = isMyTurn && pendingChoice?.kind === 'em_bubble_select_hero';
  const isSoloTwistTuck               = isMyTurn && pendingChoice?.kind === 'solo_twist_tuck_hero';
  const isEscapeKoHqHero              = isMyTurn && pendingChoice?.kind === 'escape_ko_hq_hero';
  const isChooseCityBystanderTarget   = isMyTurn && pendingChoice?.kind === 'choose_city_villain_for_bystander';
  const isLookTopTwoChoice            = isMyTurn && pendingChoice?.kind === 'look_top_two_ko_one_return_one';
  const isOrderTopOfDeck              = isMyTurn && pendingChoice?.kind === 'order_top_of_deck';
  // Wound healing: clicking a Wound KOs all wounds from hand, but only if the
  // player has not yet fought or recruited this turn (and no choice is pending).
  const woundHealingAvailable = isMyTurn && !state.thisTurn.foughtThisTurn && !state.thisTurn.recruitedThisTurn && !pendingChoice && state.phase !== 'finished';
  // After using the Healing action, the player can no longer recruit or fight
  // for the rest of the turn (the Wound card's rule). Gate the recruit/fight
  // UI affordances so they show as disabled instead of just erroring on click.
  const actionsLockedByHeal = !!state.thisTurn.healedThisTurn;

  // ----- Lobby phase: full setup screen -----
  if (state.phase === 'lobby') {
    return (
      <LegendarySetup
        state={state}
        isHost={isHost}
        disabled={disabled}
        onStart={onStart}
        onSetMastermind={onSetMastermind}
        onSetScheme={onSetScheme}
        onSetHeroClasses={onSetHeroClasses}
        onRandomizeHeroes={onRandomizeHeroes}
        onSetVillainGroups={onSetVillainGroups}
        onSetHenchmanGroups={onSetHenchmanGroups}
        onRandomizeVillains={onRandomizeVillains}
        onRandomizeHenchmen={onRandomizeHenchmen}
      />
    );
  }

  // ----- Floaters / sound on log delta (same pattern as Spellduel) -----
  const lastSeenIdx = useRef(state.log.length);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  useEffect(() => {
    const start = lastSeenIdx.current;
    if (state.log.length <= start) {
      lastSeenIdx.current = state.log.length;
      return;
    }
    const fresh = state.log.slice(start);
    lastSeenIdx.current = state.log.length;
    let key = Date.now();
    const newFloaters: Floater[] = [];
    for (const ev of fresh) {
      // The board has limited "where" anchors so we keep floaters seat-tagged
      // (mastermind hits, wound takes, villain defeats).
      sfx(ev, mySeat);
      const seatBumps = floaterFor(ev);
      for (const b of seatBumps) {
        newFloaters.push({ ...b, key: key++ });
      }
    }
    if (newFloaters.length > 0) {
      setFloaters(prev => [...prev, ...newFloaters]);
      const ids = new Set(newFloaters.map(f => f.key));
      window.setTimeout(() => setFloaters(prev => prev.filter(f => !ids.has(f.key))), 900);
    }
  }, [state.log, mySeat]);

  // ----- Villain / strike / twist reveal animation -----
  // Refs for the three destination zones — attached to real DOM elements so
  // the exit translation is computed from actual pixel positions, not estimates.
  const schemeRef     = useRef<HTMLDivElement>(null); // scheme zone box
  const strikesRef    = useRef<HTMLDivElement>(null); // strikes pile
  const sewersRef     = useRef<HTMLDivElement>(null); // sewers city slot (slot 0)
  const woundsRef     = useRef<HTMLDivElement>(null); // wounds pile box
  const mastermindRef = useRef<HTMLDivElement>(null); // mastermind zone (bystander fallback)
  const villainDeckRef = useRef<HTMLDivElement>(null); // villain deck pile (animation source)
  const heroDeckRef    = useRef<HTMLDivElement>(null); // hero deck pile (animation source)
  const myDiscardRef   = useRef<HTMLElement | null>(null); // active player's discard pile
  const myVpRef        = useRef<HTMLElement | null>(null); // active player's victory pile
  // One ref per HQ slot — used as exit destination for the hero reveal overlay.
  const hqSlotRefs = useRef<(HTMLElement | null)[]>([null, null, null, null, null]);

  const [revealAnim, setRevealAnim] = useState<RevealAnim | null>(null);
  // When handleStartAck fires the animation optimistically (immediate, from
  // the villain deck top card), this flag tells the log-watcher to skip the
  // matching villain_revealed event that arrives later from Supabase.
  const skipFirstVillainAnim = useRef(false);
  // Skip for a bystander captured as the very first villain-deck card.
  const skipFirstBystanderAnim = useRef(false);
  // Same pattern for handleEndTurn: when the active player ends their turn and
  // the top villain-deck card is a scheme_twist or master_strike, we fire the
  // animation immediately so there's no network-round-trip delay. This ref
  // names the event kind to skip when it arrives in the log.
  const skipNextEventAnim = useRef<'scheme_twist' | 'master_strike' | null>(null);

  // ---- Animation queue -------------------------------------------------------
  // Multiple reveal events can arrive in the same log batch (e.g. a scheme twist
  // that also plays 2 extra villain cards from Prison Breakout, or a fight effect
  // that peeks at 2 cards). We queue every animatable event and play them
  // sequentially so each one gets its full reveal overlay.
  const animQueueRef    = useRef<Array<Omit<RevealAnim, 'phase'>>>([]);
  const animPlayingRef  = useRef(false);
  // Ref to the play function so the recursive setTimeout callback always sees
  // the latest closure (avoids stale-closure issues with self-calls).
  const playNextRevealRef = useRef<() => void>(() => {});
  playNextRevealRef.current = () => {
    if (animPlayingRef.current || animQueueRef.current.length === 0) return;
    const next = animQueueRef.current.shift()!;
    animPlayingRef.current = true;
    setRevealAnim({ ...next, phase: 'entering' });
    window.setTimeout(() =>
      setRevealAnim(a => a?.key === next.key ? { ...a, phase: 'showing' } : a), 50);
    window.setTimeout(() =>
      setRevealAnim(a => a?.key === next.key ? { ...a, phase: 'exiting' } : a), 2200);
    window.setTimeout(() => {
      setRevealAnim(a => a?.key === next.key ? null : a);
      animPlayingRef.current = false;
      playNextRevealRef.current(); // play next item in queue
    }, 3000);
  };
  // startAcked: purely cosmetic — hides the "Game Begins" splash overlay.
  // The reveal animation is fully decoupled from this flag; it fires whenever
  // a new reveal event arrives in the log, regardless of overlay state.
  const [startAcked, setStartAcked] = useState(false);
  // cityPushing: true for ~400ms when a villain enters slot 0, animating
  // slots 1-4 sliding in from the right (pushed by the new entry).
  const [cityPushing, setCityPushing] = useState(false);

  // Animation cursor — tracked by event sequence number (not array index) so that
  // log rotation (LOG_MAX trim) never desynchronises it.
  //
  // Initialised to the highest seq already in the log at mount so that pre-existing
  // events (lobby history replayed on reconnect) are never re-animated.
  const lastAnimSeq = useRef(
    state.log.reduce((max, ev) => Math.max(max, (ev as { seq?: number }).seq ?? 0), 0)
  );

  useEffect(() => {
    // Filter for events whose seq stamp is newer than the last one we animated.
    const fresh = state.log.filter(ev => ((ev as { seq?: number }).seq ?? 0) > lastAnimSeq.current);
    if (fresh.length === 0) return;
    lastAnimSeq.current = Math.max(...fresh.map(ev => (ev as { seq?: number }).seq ?? 0));

    // City push: any villain_revealed means slot 0 just received a new card.
    if (fresh.some(ev => ev.kind === 'villain_revealed')) {
      setCityPushing(true);
      window.setTimeout(() => setCityPushing(false), 450);
    }

    // Shared geometry helpers
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const centerOf = (el: HTMLElement | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const deckCenter = centerOf(villainDeckRef.current);
    const defaultStartX = deckCenter ? deckCenter.x - cx : 400;
    const defaultStartY = deckCenter ? deckCenter.y - cy : 100;

    // Process events OLDEST-TO-NEWEST so animations play in chronological order.
    // All animatable events are pushed to the queue; they play sequentially.
    let newCount = 0;
    for (const ev of fresh) {
      let cardId = '';
      let kind: RevealAnim['kind'] | null = null;
      let strikeText: string | undefined;
      let typeLabel: string | undefined;
      let hqSlot = -1;
      let startX = defaultStartX, startY = defaultStartY;
      let bystanderDest: 'villain' | 'mastermind' = 'villain';

      if (ev.kind === 'villain_revealed') {
        if (skipFirstVillainAnim.current) { skipFirstVillainAnim.current = false; continue; }
        const def = getCard(ev.cardId);
        cardId = ev.cardId;
        kind = def.kind === 'henchman' ? 'henchman' : 'villain';
      } else if (ev.kind === 'master_strike') {
        if (skipNextEventAnim.current === 'master_strike') { skipNextEventAnim.current = null; continue; }
        cardId = 'master_strike'; kind = 'master_strike';
        strikeText = getMasterStrikeText(state.mastermindId);
        typeLabel  = MASTERMINDS.find(m => m.cardId === state.mastermindId)?.name;
      } else if (ev.kind === 'scheme_twist') {
        if (skipNextEventAnim.current === 'scheme_twist') { skipNextEventAnim.current = null; continue; }
        cardId = 'scheme_twist'; kind = 'scheme_twist';
      } else if (ev.kind === 'bystander_captured') {
        if (skipFirstBystanderAnim.current) { skipFirstBystanderAnim.current = false; continue; }
        cardId = 'bystander'; kind = 'bystander';
        bystanderDest = ev.capturedBy;
      } else if (ev.kind === 'hero_recruited' && ev.slot >= 0) {
        // Card flew from HQ slot → player's discard. Start from HQ slot.
        // Pool recruits (slot = -1) have no HQ origin so skip the animation.
        const slotEl = hqSlotRefs.current[ev.slot];
        const slotCenter = centerOf(slotEl);
        startX = slotCenter ? slotCenter.x - cx : 0;
        startY = slotCenter ? slotCenter.y - cy : -100;
        cardId = ev.cardId; kind = 'hero_recruited';
      } else if (ev.kind === 'hq_refilled') {
        const heroCenter = centerOf(heroDeckRef.current);
        startX = heroCenter ? heroCenter.x - cx : -400;
        startY = heroCenter ? heroCenter.y - cy : 100;
        cardId = ev.cardId; kind = 'hero'; hqSlot = ev.slot;
      } else if (ev.kind === 'mastermind_hit') {
        // Show the earned tactic card so all players can read it
        const mmCenter = centerOf(mastermindRef.current);
        startX = mmCenter ? mmCenter.x - cx : 0;
        startY = mmCenter ? mmCenter.y - cy : -200;
        cardId = ev.tacticCardId; kind = 'tactic';
        strikeText = ev.tacticText;
        typeLabel  = ev.tacticName;
      } else if (ev.kind === 'wound_taken') {
        // Wound revealed and flown to the receiving player's discard pile.
        // Only animate when it's the local player — non-local players' discard
        // isn't visible on this board, so skip those (the event still logs).
        if (ev.seat !== mySeat) continue;
        const woundsCenter = centerOf(woundsRef.current);
        startX = woundsCenter ? woundsCenter.x - cx : 0;
        startY = woundsCenter ? woundsCenter.y - cy : -150;
        cardId = 'wound'; kind = 'wound';
      }

      if (!kind) continue;

      let destEl: HTMLElement | null = null;
      if (kind === 'villain' || kind === 'henchman') destEl = sewersRef.current;
      else if (kind === 'master_strike')             destEl = strikesRef.current;
      else if (kind === 'scheme_twist')              destEl = schemeRef.current;
      else if (kind === 'bystander')                 destEl = bystanderDest === 'villain' ? sewersRef.current : mastermindRef.current;
      else if (kind === 'hero' && hqSlot >= 0)       destEl = hqSlotRefs.current[hqSlot];
      else if (kind === 'hero_recruited')             destEl = myDiscardRef.current;
      else if (kind === 'tactic')                     destEl = myVpRef.current;
      else if (kind === 'wound')                      destEl = myDiscardRef.current;

      const dest = centerOf(destEl);
      const exitX = dest ? dest.x - cx : (kind === 'villain' || kind === 'henchman' ? 340 : kind === 'master_strike' ? -380 : -200);
      const exitY = dest ? dest.y - cy : (kind === 'villain' || kind === 'henchman' ?  50 : kind === 'master_strike' ?   60 : -160);

      animQueueRef.current.push({
        key: Date.now() + newCount++,
        cardId, kind, exitX, exitY, startX, startY,
        hqSlot: kind === 'hero' && hqSlot >= 0 ? hqSlot : undefined,
        strikeText, typeLabel,
      });
    }

    if (newCount > 0) playNextRevealRef.current();
  }, [state.log]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Helpers shared by handleStartAck and handleEndTurn -----
  function enqueueRevealAnim(
    cardId: string,
    kind: RevealAnim['kind'],
    destEl: HTMLElement | null,
    fallbackX: number,
    fallbackY: number,
    strikeText?: string,
    typeLabel?: string,
  ) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    let exitX = fallbackX, exitY = fallbackY;
    if (destEl) {
      const r = destEl.getBoundingClientRect();
      exitX = r.left + r.width / 2 - cx;
      exitY = r.top  + r.height / 2 - cy;
    }
    const srcEl = villainDeckRef.current;
    let startX = 400, startY = 100;
    if (srcEl) {
      const sr = srcEl.getBoundingClientRect();
      startX = sr.left + sr.width / 2 - cx;
      startY = sr.top  + sr.height / 2 - cy;
    }
    animQueueRef.current.push({ key: Date.now(), cardId, kind, exitX, exitY, startX, startY, strikeText, typeLabel });
    playNextRevealRef.current();
  }

  // When the current player clicks "Game Begins":
  //   1. Immediately peek at the villain deck top card and fire the reveal
  //      animation — no network round-trip, instant response.
  //   2. Dispatch the reveal_first_villain engine action so the card is
  //      actually placed in state (async, via Supabase).
  //   3. skipFirstVillainAnim tells the log-watcher to ignore the matching
  //      villain_revealed event that arrives when the state propagates back,
  //      preventing a double-animation.
  // Non-current players just dismiss their local overlay.
  function handleStartAck() {
    setStartAcked(true);
    if (!isMyTurn) return;

    const nextCard = state.villainDeck[0] ?? null;
    // The villain deck is projected as hidden cards (cardId '__hidden__') on the
    // client — we cannot peek at the real card. Skip the preview animation; the
    // log-watcher fires the animation when the server response arrives.
    if (nextCard && nextCard.cardId !== '__hidden__') {
      const def = getCard(nextCard.cardId);

      if (def.kind === 'villain' || def.kind === 'henchman') {
        enqueueRevealAnim(nextCard.cardId, def.kind === 'henchman' ? 'henchman' : 'villain', sewersRef.current, 340, 50);
        skipFirstVillainAnim.current = true;
      } else if (def.kind === 'scheme_twist') {
        enqueueRevealAnim('scheme_twist', 'scheme_twist', schemeRef.current, -200, -160);
        skipNextEventAnim.current = 'scheme_twist';
      } else if (def.kind === 'master_strike') {
        enqueueRevealAnim('master_strike', 'master_strike', strikesRef.current, -380, 60,
          getMasterStrikeText(state.mastermindId),
          MASTERMINDS.find(m => m.cardId === state.mastermindId)?.name);
        skipNextEventAnim.current = 'master_strike';
      } else if (def.kind === 'bystander') {
        enqueueRevealAnim('bystander', 'bystander', sewersRef.current, 340, 50);
        skipFirstBystanderAnim.current = true;
      }
    }

    onRevealFirstVillain?.();
  }

  // When the active player clicks "End Turn", peek at the villain deck top
  // card and pre-fire the reveal animation for scheme twists / master strikes
  // so it plays instantly (no Supabase round-trip wait). Same pattern as
  // handleStartAck for the first villain.
  function handleEndTurn() {
    if (isMyTurn && state.villainDeck.length > 0) {
      const nextCard = state.villainDeck[0];
      // Villain deck cards are projected as hidden (cardId '__hidden__') on the
      // client — skip the preview peek; the log-watcher animates on server response.
      if (nextCard.cardId !== '__hidden__') {
        const def = getCard(nextCard.cardId);
        if (def.kind === 'scheme_twist') {
          enqueueRevealAnim('scheme_twist', 'scheme_twist', schemeRef.current, -200, -160);
          skipNextEventAnim.current = 'scheme_twist';
        } else if (def.kind === 'master_strike') {
          enqueueRevealAnim('master_strike', 'master_strike', strikesRef.current, -380, 60,
            getMasterStrikeText(state.mastermindId),
            MASTERMINDS.find(m => m.cardId === state.mastermindId)?.name);
          skipNextEventAnim.current = 'master_strike';
        }
      }
    }
    onEndTurn();
  }

  // ----- HQ slot refill animation -----
  // When a hero enters an empty HQ slot during gameplay (after a purchase or
  // after an escape KO), we animate it flipping face-up from the Hero Deck.
  // `animatingHqSlots` is the set of slot indices currently mid-animation.
  const lastHqRefillIdx = useRef(state.log.length);
  const [animatingHqSlots, setAnimatingHqSlots] = useState<Set<number>>(new Set());
  useEffect(() => {
    const start = lastHqRefillIdx.current;
    if (state.log.length <= start) {
      lastHqRefillIdx.current = state.log.length;
      return;
    }
    const fresh = state.log.slice(start);
    lastHqRefillIdx.current = state.log.length;
    const refillSlots: number[] = [];
    for (const ev of fresh) {
      if (ev.kind === 'hq_refilled') refillSlots.push(ev.slot);
    }
    if (refillSlots.length === 0) return;
    // Delay the slot flip-in to match the reveal overlay exit (2500ms) so the
    // hero card appears to "land" in the HQ slot as the overlay shrinks toward it.
    window.setTimeout(() => {
      setAnimatingHqSlots(prev => {
        const next = new Set(prev);
        for (const s of refillSlots) next.add(s);
        return next;
      });
      window.setTimeout(() => {
        setAnimatingHqSlots(prev => {
          const next = new Set(prev);
          for (const s of refillSlots) next.delete(s);
          return next;
        });
      }, 700);
    }, 2500);
  }, [state.log]);

  const mmDef = getCard(state.mastermindId);
  const schemeDef = getCard(state.schemeId);
  const banner = state.phase === 'finished'
    ? state.result === 'win'  ? `🏆 ${state.resultReason ?? 'Heroes Win!'}`
    : state.result === 'tie'  ? `🤝 ${state.resultReason ?? 'Tie — heroes survived!'}`
    :                           `💀 ${state.resultReason ?? 'Evil Wins.'}`
    : isMyTurn ? 'Your turn — play cards, then buy/fight, then End Turn.'
    : `${currentPlayer?.username ?? 'A player'}'s turn`;

  // Master Strikes get KO'd into state.ko after they fire; count them out
  // so the Strikes pile shows a real number.
  const strikesPlayed = state.ko.filter(c => c.cardId === 'master_strike').length;

  // KO pile: exclude master strikes and scheme twists — those have their own
  // dedicated pile/panel (Strikes / Twists). The hover list already filters
  // them; keep the count in sync so the number matches what you'd see on hover.
  const koCards = state.ko.filter(c => c.cardId !== 'master_strike' && c.cardId !== 'scheme_twist');

  // Bystanders live in multiple places: the draw deck, shuffled inside the
  // villain deck at game start, attached to city cards, and attached to the
  // mastermind. Sum them all so the Bystanders pile shows the real total.
  const totalBystanders =
    state.bystanderDeck.length +
    state.villainDeck.filter(c => c.cardId === 'bystander').length +
    Object.values(state.cityBystanders as Record<string, CardInstance[]>).reduce((s, arr) => s + arr.length, 0) +
    (state.mastermind.bystanders?.length ?? 0);
  const schemeIsScheme = schemeDef.kind === 'scheme';
  const mmIsMM = mmDef.kind === 'mastermind';

  // "Play Starters" — plays only S.H.I.E.L.D. starter cards (Agents + Troopers)
  // from the player's hand, leaving hero cards for manual play.
  const STARTER_IDS = new Set(['shield_agent', 'shield_trooper']);
  const handlePlayStarters = () => {
    if (!me || !isMyTurn || disabled) return;
    for (const card of me.hand) {
      if (STARTER_IDS.has(card.cardId)) onPlay(card.instanceId);
    }
  };
  const hasStarters = !!me?.hand.some(c => STARTER_IDS.has(c.cardId));

  return (
    <div className="flex w-full flex-col gap-3">
      {state.phase === 'finished' && (
        <>
          <div className="text-center text-sm text-neutral-300">{banner}</div>
          <FinalScoreboard players={state.players} />
        </>
      )}

      {/* ============================================================
          PLAYMAT — mirrors the standard Marvel Legendary playmat:
            Row 1: Twists · Scheme · Escape · Wounds · Bystanders
            Row 2: Strikes · Mastermind · (spacer) · Villain Deck
            Row 3: Sidekicks/Officers · 5 City slots · Hero Deck
            Row 4: HQ (5 slots, centered)
          ============================================================ */}
      <div className="flex flex-col gap-7 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">

        {/* ---- Top row: KO · Escape · Scheme · Mastermind · Wounds/Bystanders ----
             col-span-1 left  = KO pile (same col as Twists/Strikes below)
             col-span-10 mid  = grid-cols-5: [Escape(1)] [Scheme(2)] [Mastermind(2)]
             col-span-1 right = Wounds + Bystanders ---- */}
        <div className="grid grid-cols-12 gap-2">
          {/* KO pile — cards removed from the game (master strikes, KO'd player cards) */}
          <div className="group relative col-span-1 flex h-36 flex-col">
            <PileDisplay
              label="KO"
              count={koCards.length}
              tone="neutral"
              fill
              pileStyle={{ borderColor: '#404040', background: 'linear-gradient(135deg,rgba(40,40,40,.6),rgba(20,20,20,.6))' }}
            />
            <HoverCardList cards={koCards} heading="KO'd" placement="below" />
          </div>
          <div className="col-span-10 grid grid-cols-5 gap-2">
            {/* Escape — directly above Bridge city slot */}
            <div className="group relative col-span-1 flex h-36 flex-col">
              <PileDisplay
                label="Escape"
                count={state.escapedPile.length}
                topCardLabel={state.escapedPile.length > 0 ? labelOf(state.escapedPile[state.escapedPile.length - 1]) : '—'}
                tone="rose"
                fill
              />
              <HoverCardList cards={state.escapedPile} heading="Escaped" placement="below" />
            </div>
            {/* Scheme — spans 2 city-slot widths. ref used for animation targeting. */}
            <div className="col-span-2 h-36" ref={schemeRef}>
              <SchemeZone schemeDef={schemeDef} twistsRevealed={state.schemeTwistsRevealed} />
            </div>
            {/* Mastermind — spans 2 city-slot widths */}
            <div className="col-span-2 h-36" ref={mastermindRef}>
              <MastermindZone
                mmDef={mmDef}
                tacticsLeft={state.mastermind.tactics?.length ?? 0}
                attack={state.thisTurn.recruitAsAttackEnabled
                  ? state.thisTurn.attack + state.thisTurn.recruit
                  : state.thisTurn.attack}
                mastermindAttackDebuff={state.thisTurn.mastermindAttackDebuff}
                isMyTurn={isMyTurn}
                disabled={disabled || actionsLockedByHeal || state.phase === 'finished'}
                onFight={onFightMastermind}
                bystanderCount={state.mastermind.bystanders?.length ?? 0}
              />
            </div>
          </div>
          {/* Wounds + Bystanders — right of Mastermind, aligned with Villain/Hero Deck column */}
          <div className="col-span-1 flex h-36 flex-col gap-1">
            <div ref={woundsRef}>
              <PileDisplay label="Wounds"     count={state.woundDeck.length}      tone="neutral" fill
                pileStyle={{ borderColor: '#7a3030', background: 'linear-gradient(135deg,rgba(107,37,37,.45),rgba(90,30,30,.45))' }} />
            </div>
            <PileDisplay label="Bystanders" count={totalBystanders} tone="amber" fill infinite
              pileStyle={{ borderColor: '#c4a800', background: 'linear-gradient(135deg,rgba(196,168,0,.3),rgba(160,134,0,.3))' }} />
          </div>
        </div>

        {/* ---- Row 3: City row ---- */}
        {/* Left col: Twists + Strikes stacked. City renders slot4→0 (escape on left,
            entry on right next to Villain Deck). Villain Deck is full card height. */}
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-1 flex h-36 flex-col gap-1">
            <PileDisplay
              label="Twists"
              count={state.schemeTwistsRevealed}
              total={schemeIsScheme ? schemeDef.twists : undefined}
              tone="amber"
              fill
              pileStyle={{ borderColor: '#4a2880', background: 'linear-gradient(135deg,rgba(58,32,104,.45),rgba(45,24,85,.45))' }}
            />
            <div ref={strikesRef} className="flex flex-1 min-h-0 flex-col">
              <PileDisplay label="Strikes" count={strikesPlayed} total={5} tone="rose" fill
                pileStyle={{ borderColor: '#8a5800', background: 'linear-gradient(135deg,rgba(122,72,0,.45),rgba(92,54,0,.45))' }} />
            </div>
          </div>
          {/* City slots rendered right-to-left: Bridge(escape) on left, Sewers(entry) on right */}
          <div className="col-span-10 flex flex-col">
            <div className="grid grid-cols-5 gap-2">
              {([4, 3, 2, 1, 0] as const).map((slot) => {
                const card = state.city[slot];
                // Storm – Spinning Cyclone: effective fight attack with location debuff.
                const locationDebuff = (state.thisTurn.locationVillainDebuffs as Partial<Record<number, number>>)[slot] ?? 0;
                const effectiveAttack = state.thisTurn.recruitAsAttackEnabled
                  ? state.thisTurn.attack + state.thisTurn.recruit
                  : state.thisTurn.attack;
                // While the villain reveal overlay is entering/showing, hide slot 0 so the
                // card only "appears" when the overlay exits and lands at the Sewers.
                const hidingNewEntrant =
                  slot === 0 &&
                  revealAnim !== null &&
                  (revealAnim.kind === 'villain' || revealAnim.kind === 'henchman') &&
                  revealAnim.phase !== 'exiting';
                const visibleCard = hidingNewEntrant ? null : card;
                return (
                  <div key={slot} ref={slot === 0 ? sewersRef : null}>
                    {/* animate-city-push wraps ONLY the card — the chevron strip is a
                        flex sibling of this whole column grid, so it stays pinned
                        regardless of the push animation or fightable-card lift. */}
                    <div className={cityPushing && slot !== 0 ? 'animate-city-push' : ''}>
                      <CitySlot
                        card={visibleCard}
                        slot={slot}
                        isLast={slot === CITY_SIZE - 1}
                        attack={effectiveAttack}
                        locationDebuff={locationDebuff}
                        disabled={!isMyTurn || disabled || actionsLockedByHeal || state.phase === 'finished'}
                        onFight={() => onFightCity(slot)}
                        attachedBystanders={visibleCard ? state.cityBystanders[visibleCard.instanceId]?.length ?? 0 : 0}
                        attachedHeroName={(() => {
                          if (!visibleCard) return undefined;
                          const h = state.cityAttachedHeroes?.[visibleCard.instanceId];
                          if (!h) return undefined;
                          const hd = CARDS[h.cardId];
                          return hd?.kind === 'hero' ? hd.cardName : undefined;
                        })()}
                        attachedHeroCost={(() => {
                          if (!visibleCard) return undefined;
                          const h = state.cityAttachedHeroes?.[visibleCard.instanceId];
                          if (!h) return undefined;
                          const hd = CARDS[h.cardId];
                          return hd?.kind === 'hero' ? hd.cost : undefined;
                        })()}
                        killbotStrike={visibleCard?.cardId === 'killbot'
                          ? state.schemeTwistsRevealed
                          : undefined}
                        fightConditionMet={(() => {
                          if (!visibleCard || !me) return true;
                          const d = CARDS[visibleCard.cardId];
                          if (d?.kind !== 'villain' || !d.fightCondition) return true;
                          // Mirrors doFightCity's fightCondition check — hand
                          // OR played-this-turn must contain a matching Hero.
                          const heroes = [...me.hand, ...state.thisTurn.playedThisTurn];
                          if (d.fightCondition.requires === 'xmen_hero') {
                            return heroes.some(c => {
                              const hd = CARDS[c.cardId];
                              return hd?.kind === 'hero' && hd.teams.includes('x-men');
                            });
                          }
                          if (d.fightCondition.requires === 'covert_hero') {
                            return heroes.some(c => {
                              const hd = CARDS[c.cardId];
                              return hd?.kind === 'hero' && hd.classes.includes('covert');
                            });
                          }
                          return true;
                        })()}
                        freeBystanderFightAvailable={state.thisTurn.freeBystanderFightAvailable}
                        fightCityFreeAvailable={!!state.thisTurn.fightCityFreeAvailable}
                        // Storm move-villain support
                        onMoveSelect={isMoveVillainSelectVillain && visibleCard ? () => onResolveChoice(visibleCard.instanceId) : undefined}
                        onMoveDest={isMoveVillainSelectDest ? () => onResolveChoice(`slot:${slot}`) : undefined}
                        // Deadpool "Here, Hold This" — click a villain to assign the bystander
                        onBystanderSelect={isChooseCityBystanderTarget && visibleCard ? () => onResolveChoice(visibleCard.instanceId) : undefined}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Chevron location strip — single connected tab row, static flex
                sibling of the card grid so it never moves with card animations.
                bg-[#09090b] fills the parent so the city card's colored border
                above doesn't show through the CSS-triangle separator gaps. */}
            <div className="mt-[3px] flex items-stretch overflow-hidden rounded-sm" style={{ height: '20px', background: '#09090b' }}>
              {([4, 3, 2, 1, 0] as const).map((slot, renderIdx) => (
                <React.Fragment key={slot}>
                  <div
                    className="flex flex-1 items-center justify-center text-[8px] font-semibold uppercase tracking-widest"
                    style={{ background: CITY_CHEVRON_COLORS[slot], color: '#9a9a9a' }}
                  >
                    {CITY_LOCATIONS[slot]}
                  </div>
                  {renderIdx < 4 && (
                    /* CSS border-triangle separator pointing left (villains escape left).
                       Top/bottom use the board bg (#09090b) instead of transparent so
                       the active card's accent border above doesn't bleed through.
                       Uses a single neutral colour so the separators stay uniform
                       instead of inheriting each slot's tint. */
                    <div style={{
                      width: 0,
                      height: 0,
                      borderTop: '10px solid #09090b',
                      borderBottom: '10px solid #09090b',
                      borderRight: '8px solid #1a1a1a',
                      flexShrink: 0,
                      alignSelf: 'center',
                    }} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
          {/* Villain Deck — matches city slot height */}
          <div className="col-span-1 flex h-36 flex-col" ref={villainDeckRef}>
            <PileDisplay label="Villain Deck" count={state.villainDeck.length} tone="rose" backFace fill />
          </div>
        </div>

        {/* ---- Row 4: HQ row ---- */}
        {/* Left col: Sidekicks + Officers stacked (each half of h-32). Hero Deck full card height. */}
        <div className="grid grid-cols-12 gap-2">
          {/* Sidekick + Officer stacked. Each pile is wrapped in its own group/relative
              div so the hover preview is a SIBLING of the pile button — not its child.
              This is the permanent fix for the stacking-context issue: a button with
              transform creates its own stacking context, trapping z-index inside it.
              A sibling div with z-[500] participates in the root stacking context and
              reliably paints above the HQ card transforms. */}
          <div className="col-span-1 flex h-36 flex-col gap-1">
            {/* Sidekick pile */}
            <div className="group relative flex flex-col flex-1 min-h-0">
              <PileDisplay label={SIDEKICK.cardName} count={state.sidekickPoolCount} tone="neutral" fill cost={SIDEKICK.cost}
                canAfford={isMyTurn && !disabled && !actionsLockedByHeal && state.thisTurn.recruit >= SIDEKICK.cost && !state.thisTurn.sidekickRecruited && state.sidekickPoolCount > 0}
                onClick={isMyTurn && !disabled && !actionsLockedByHeal && !state.thisTurn.sidekickRecruited && state.sidekickPoolCount > 0 ? onRecruitSidekick : undefined}
                pileStyle={{ borderColor: '#909090', background: 'linear-gradient(135deg,#7a7a7a,#686868)' }} />
              {/* Hover preview — sibling of button, so z-[500] escapes the button's stacking context */}
              <div className="pointer-events-none absolute left-full top-0 z-[500] ml-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <HeroCardArt def={SIDEKICK} style={SHIELD_GREY_STYLE} lightBg />
              </div>
            </div>
            {/* Officer pile */}
            <div className="group relative flex flex-col flex-1 min-h-0">
              <PileDisplay label={OFFICER.cardName} count={state.officerPoolCount} tone="neutral" fill cost={OFFICER.cost}
                canAfford={isMyTurn && !disabled && !actionsLockedByHeal && state.thisTurn.recruit >= OFFICER.cost && state.officerPoolCount > 0}
                onClick={isMyTurn && !disabled && !actionsLockedByHeal && state.officerPoolCount > 0 ? onRecruitOfficer : undefined}
                pileStyle={{ borderColor: '#909090', background: 'linear-gradient(135deg,#7a7a7a,#686868)' }} />
              <div className="pointer-events-none absolute left-full top-0 z-[500] ml-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                <HeroCardArt def={OFFICER} style={SHIELD_GREY_STYLE} lightBg />
              </div>
            </div>
          </div>
          <div className="col-span-10">
            <div className="grid grid-cols-5 gap-2">
              {state.hq.map((card, slot) => {
                // While the hero reveal overlay is entering/showing for this slot,
                // hide the card so it only "appears" when the overlay lands.
                const hidingNewHero =
                  revealAnim !== null &&
                  revealAnim.kind === 'hero' &&
                  revealAnim.phase !== 'exiting' &&
                  revealAnim.hqSlot === slot;
                const visibleCard = hidingNewHero ? null : card;
                return (
                  <div key={slot} ref={el => { hqSlotRefs.current[slot] = el; }}>
                    <HQSlot
                      card={visibleCard}
                      slot={slot}
                      recruit={state.thisTurn.recruit}
                      disabled={!isMyTurn || disabled || actionsLockedByHeal || state.phase === 'finished'}
                      onRecruit={() => onRecruit(slot)}
                      refillAnim={animatingHqSlots.has(slot)}
                      onFreeRecruit={isFreeRecruitFromHQ && visibleCard
                        ? () => onResolveChoice(visibleCard.instanceId)
                        : undefined}
                      onFreeRecruitXmen={isFreeRecruitXmenFromHQ && visibleCard
                        ? () => onResolveChoice(visibleCard.instanceId)
                        : undefined}
                      onTuckHero={isSoloTwistTuck && visibleCard
                        ? () => onResolveChoice(visibleCard.instanceId)
                        : undefined}
                      onKoFromHq={isEscapeKoHqHero && visibleCard
                        ? () => onResolveChoice(visibleCard.instanceId)
                        : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          {/* Hero Deck — matches HQ card height */}
          <div className="col-span-1 flex h-36 flex-col" ref={heroDeckRef}>
            <PileDisplay label="Hero Deck" count={state.heroDeck.length} tone="emerald" backFace fill />
          </div>
        </div>
      </div>

      {/* ============================================================
          PLAYER UI — below the playmat. Resources, hand, end turn,
          log, players. Personal to the viewer.
          ============================================================ */}

      {/* Resource bar + action buttons */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          {/* Left: player info boxes + Strike/Recruit pips + played chips (wraps to 2nd row) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {me && (
              <>
                <PlayerBox label="Deck"    value={me.deck.length}    shade="emerald" backFace />
                <div className="group relative">
                  <span ref={myDiscardRef as React.Ref<HTMLSpanElement>}>
                    <PlayerBox label="Discard" value={me.discard.length} shade="emerald" backFace />
                  </span>
                  <HoverCardList cards={me.discard} heading="Discard Pile" placement="below" />
                </div>
                <div className="group relative">
                  <span ref={myVpRef as React.Ref<HTMLSpanElement>}>
                    <PlayerBox label="VP" value={me.vp} shade="rose" />
                  </span>
                  <HoverCardList cards={me.victoryPile} heading="Victory Pile" placement="below" />
                </div>
              </>
            )}
            <div className="h-8 w-px bg-neutral-800" />
            <ResourcePip label="Strike"  value={state.thisTurn.attack}  color="rose"    />
            <ResourcePip label="Recruit" value={state.thisTurn.recruit} color="emerald" />
            {/* Played chips — inline right of Recruit, wrap to next row when needed */}
            {state.thisTurn.playedThisTurn.map((c, i) => {
              const chipDef = CARDS[c.cardId];
              const chipClass = chipDef?.kind === 'hero' ? chipDef.classes[0] : undefined;
              const chipColor = chipClass ? CLASS_COLORS[chipClass] : '#d4d4d4';
              return (
                <div key={c.instanceId + i} className="group relative">
                  <div
                    className="h-5 cursor-default select-none rounded bg-neutral-800 px-1.5 text-[10px] leading-5 font-medium"
                    style={{ color: chipColor }}
                  >
                    {labelOf(c)}
                  </div>
                  {/* Full card art tooltip — appears above the chip on hover */}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-[300] mb-2 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <PlayedCardPreview card={c} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Right: turn counter + action buttons — anchored top-right */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-white font-medium">Turn {state.turn}</span>
            {me && state.phase === 'playing' && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={!isMyTurn || disabled || isChoiceMode || isLookTopTwoChoice || !hasStarters}
                  onClick={handlePlayStarters}
                  className="rounded border border-neutral-700 bg-neutral-800 px-4 py-1 text-xs font-medium text-neutral-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Play Starters
                </button>
                <button
                  type="button"
                  disabled={!isMyTurn || disabled || isChoiceMode || isLookTopTwoChoice}
                  onClick={handleEndTurn}
                  className="rounded border border-rose-800 bg-rose-950 px-4 py-1 text-xs font-medium text-rose-200 transition hover:border-rose-500 hover:bg-rose-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  End Turn
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pending-choice banner — shown when a card effect needs the player to
          pick a card from their hand to KO or discard, or to accept/decline
          a binary Deadpool effect. */}
      {pendingChoice && (
        <div className={`rounded-lg border px-4 py-2.5 ${
          pendingChoice.kind === 'reveal_to_prevent_wound'
            ? 'border-sky-500 bg-sky-950/50'
            : pendingChoice.kind === 'put_card_on_deck'
            ? 'border-emerald-500 bg-emerald-950/50'
            : pendingChoice.kind === 'reveal_top_discard_or_return'
            ? 'border-teal-500 bg-teal-950/50'
            : pendingChoice.kind === 'choose_others_draw_or_discard'
            ? 'border-cyan-500 bg-cyan-950/50'
            : pendingChoice.kind === 'copy_played_hero'
            ? 'border-rose-500 bg-rose-950/50'
            : (pendingChoice.kind === 'move_villain_select_villain' || pendingChoice.kind === 'move_villain_select_dest')
            ? 'border-sky-500 bg-sky-950/50'
            : pendingChoice.kind === 'free_recruit_from_hq'
            ? 'border-cyan-400 bg-cyan-950/50'
            : pendingChoice.kind === 'free_recruit_xmen_from_hq'
            ? 'border-emerald-400 bg-emerald-950/50'
            : pendingChoice.kind === 'ko_up_to_from_discard'
            ? 'border-rose-500 bg-rose-950/50'
            : pendingChoice.kind === 'em_bubble_select_hero'
            ? 'border-violet-500 bg-violet-950/50'
            : pendingChoice.kind === 'solo_twist_tuck_hero'
            ? 'border-emerald-500 bg-emerald-950/50'
            : pendingChoice.kind === 'escape_ko_hq_hero'
            ? 'border-rose-500 bg-rose-950/50'
            : pendingChoice.kind === 'order_top_of_deck'
            ? 'border-emerald-500 bg-emerald-950/50'
            : pendingChoice.kind === 'choose_city_villain_for_bystander'
            ? 'border-amber-500 bg-amber-950/50'
            : pendingChoice.kind === 'look_top_two_ko_one_return_one'
            ? 'border-rose-500 bg-rose-950/50'
            : pendingChoice.kind === 'melter_decide_card'
            ? 'border-orange-500 bg-orange-950/50'
            : isBinaryChoice
            ? 'border-purple-500 bg-purple-950/50'
            : 'border-amber-500 bg-amber-950/50'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className={`text-sm font-semibold ${
                pendingChoice.kind === 'reveal_to_prevent_wound'
                  ? 'text-sky-300'
                  : pendingChoice.kind === 'put_card_on_deck'
                  ? 'text-emerald-300'
                  : pendingChoice.kind === 'reveal_top_discard_or_return'
                  ? 'text-teal-300'
                  : pendingChoice.kind === 'choose_others_draw_or_discard'
                  ? 'text-cyan-300'
                  : pendingChoice.kind === 'copy_played_hero'
                  ? 'text-rose-300'
                  : (pendingChoice.kind === 'move_villain_select_villain' || pendingChoice.kind === 'move_villain_select_dest')
                  ? 'text-sky-300'
                  : pendingChoice.kind === 'free_recruit_from_hq'
                  ? 'text-cyan-300'
                  : pendingChoice.kind === 'free_recruit_xmen_from_hq'
                  ? 'text-emerald-300'
                  : pendingChoice.kind === 'ko_up_to_from_discard'
                  ? 'text-rose-300'
                  : pendingChoice.kind === 'em_bubble_select_hero'
                  ? 'text-violet-300'
                  : pendingChoice.kind === 'solo_twist_tuck_hero'
                  ? 'text-emerald-300'
                  : pendingChoice.kind === 'escape_ko_hq_hero'
                  ? 'text-rose-300'
                  : pendingChoice.kind === 'order_top_of_deck'
                  ? 'text-emerald-300'
                  : pendingChoice.kind === 'choose_city_villain_for_bystander'
                  ? 'text-amber-300'
                  : pendingChoice.kind === 'look_top_two_ko_one_return_one'
                  ? 'text-rose-300'
                  : pendingChoice.kind === 'melter_decide_card'
                  ? 'text-orange-300'
                  : isBinaryChoice
                  ? 'text-purple-300'
                  : 'text-amber-300'
              }`}>
                {adaptPromptForViewer(
                  pendingChoice.kind === 'reveal_to_prevent_wound'
                  ? '🛡️ Reveal your shield — click your Diving Block to draw a card instead of taking a wound'
                  : pendingChoice.kind === 'put_card_on_deck'
                  ? '📚 Choose a card from your hand to put on top of your deck'
                  : pendingChoice.kind === 'reveal_top_discard_or_return'
                  ? (() => {
                      const revCard = CARDS[(pendingChoice as { kind: string; card: { cardId: string } }).card.cardId];
                      const revName = revCard?.kind === 'hero' ? revCard.cardName : 'name' in (revCard ?? {}) ? (revCard as { name: string }).name : '?';
                      return `🃏 Revealed: ${revName} — discard it or put it back?`;
                    })()
                  : pendingChoice.kind === 'optional_return_sidekick_draw_two'
                  ? '🔁 Return this Sidekick to the stack and draw 2 cards?'
                  : pendingChoice.kind === 'discard_hand_draw_four'
                  ? '🔄 Discard your remaining hand and draw 4 cards?'
                  : pendingChoice.kind === 'optional_gain_wound_pass_left'
                  ? '💉 Gain a Wound to your hand? (Then all players pass a card to the left.)'
                  : pendingChoice.kind === 'optional_gain_card'
                  ? `🎁 You may gain a ${(pendingChoice as { label: string }).label} to your hand — take it?`
                  : pendingChoice.kind === 'choose_others_draw_or_discard'
                  ? '🎯 [tech] Choose — each other player draws a card, or each other player discards a card?'
                  : pendingChoice.kind === 'copy_played_hero'
                  ? '🔄 Rogue — click a Hero you played this turn to copy its ability'
                  : pendingChoice.kind === 'move_villain_select_villain'
                  ? '🌀 Storm — click a Villain in the city to move it'
                  : pendingChoice.kind === 'move_villain_select_dest'
                  ? `🌀 Storm — moving ${(pendingChoice as { sourceName: string }).sourceName} — click a city space to place it`
                  : pendingChoice.kind === 'free_recruit_from_hq'
                  ? '⚙️ Dark Technology — click a Tech or Ranged Hero in the HQ to recruit it for free'
                  : pendingChoice.kind === 'free_recruit_xmen_from_hq'
                  ? '🟩 Bitter Captor — click an X-Men Hero in the HQ to recruit it for free'
                  : pendingChoice.kind === 'ko_up_to_from_discard'
                  ? `🗑️ Maniacal Tyrant — click a card from your discard pile to KO it (${(pendingChoice as { remaining: number }).remaining} remaining)`
                  : pendingChoice.kind === 'em_bubble_select_hero'
                  ? '🔮 Electromagnetic Bubble — click an X-Men Hero from your played area to keep in next hand'
                  : pendingChoice.kind === 'solo_twist_tuck_hero'
                  ? '📥 Solo Twist Bonus — click a Hero in the HQ (cost 6 or less) to put it on the bottom of the Hero Deck'
                  : pendingChoice.kind === 'escape_ko_hq_hero'
                  ? `💀 ${(pendingChoice as { escapedVillainName: string }).escapedVillainName} escaped — click any Hero in the HQ to KO it`
                  : pendingChoice.kind === 'order_top_of_deck'
                  ? `📚 Order ${(pendingChoice as { queue: CardInstance[] }).queue.length} card${(pendingChoice as { queue: CardInstance[] }).queue.length === 1 ? '' : 's'} for the top of your deck — click in the order you want them drawn`
                  : pendingChoice.kind === 'choose_city_villain_for_bystander'
                  ? '👤 Here, Hold This — click a Villain or Henchman in the city to capture the Bystander'
                  : pendingChoice.kind === 'look_top_two_ko_one_return_one'
                  ? '🤖 Doombot Legion — click one of the revealed cards below to KO it (the other returns to your deck)'
                  : pendingChoice.kind === 'melter_decide_card'
                  ? (() => {
                      const head = (pendingChoice as { queue: { ownerName: string; card: CardInstance }[] }).queue[0];
                      if (!head) return '🔥 Melter';
                      const def = CARDS[head.card.cardId];
                      const cName = def?.kind === 'hero' ? def.cardName
                        : (def && 'name' in def) ? (def as { name: string }).name : head.card.cardId;
                      const left = (pendingChoice as { queue: unknown[] }).queue.length;
                      const remainTag = left > 1 ? ` (${left} card${left === 1 ? '' : 's'} left)` : '';
                      return `🔥 Melter — ${head.ownerName}'s revealed ${cName}: KO it or put it back?${remainTag}`;
                    })()
                  : pendingChoice.kind === 'ko_from_hand'
                  ? (() => {
                      const rem = ('remaining' in pendingChoice ? pendingChoice.remaining ?? 0 : 0);
                      const srcs = ('sources' in pendingChoice && pendingChoice.sources) ? pendingChoice.sources : ['hand', 'played'];
                      const zones = [
                        srcs.includes('hand')    ? 'hand'        : null,
                        srcs.includes('played')  ? 'played area' : null,
                        srcs.includes('discard') ? 'discard pile' : null,
                      ].filter(Boolean).join(', ');
                      const leftLabel = rem > 0 ? ` (${rem + 1} remaining)` : '';
                      return `🗑️ KO a card from your ${zones}${leftLabel}`;
                    })()
                  : 'mandatory' in pendingChoice && pendingChoice.mandatory
                  ? '↩️ You must discard a card from your hand'
                  : '↩️ Discard a card from your hand',
                  isMyTurn,
                  currentPlayer?.username,
                )}
              </span>
              {'filter' in pendingChoice && pendingChoice.filter === 'wounds_only' && (
                <span className="ml-2 text-xs text-amber-400">(Wound cards only)</span>
              )}
              {'filter' in pendingChoice && pendingChoice.filter === 'shield_heroes' && (
                <span className="ml-2 text-xs text-amber-400">(S.H.I.E.L.D. Heroes only)</span>
              )}
              {'filter' in pendingChoice && pendingChoice.filter === 'heroes_only' && (
                <span className="ml-2 text-xs text-rose-400">(Hero cards only — Master Strike penalty)</span>
              )}
              {'bonus' in pendingChoice && pendingChoice.bonus.length > 0 && !('mandatory' in pendingChoice && pendingChoice.mandatory) && (
                <span className="ml-2 text-xs text-neutral-400">
                  {isMyTurn ? '— click a card below, or skip to forfeit the bonus.' : ''}
                </span>
              )}
            </div>
            {isMyTurn && (
              <div className="flex shrink-0 gap-2">
                {/* Accept button — only for binary choices */}
                {isBinaryChoice && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={onAcceptChoice}
                    className={`rounded border px-3 py-1 text-xs font-medium transition disabled:opacity-40 ${
                      pendingChoice.kind === 'reveal_top_discard_or_return'
                        ? 'border-teal-600 bg-teal-900 text-teal-200 hover:border-teal-400 hover:text-white'
                        : pendingChoice.kind === 'choose_others_draw_or_discard'
                        ? 'border-cyan-600 bg-cyan-900 text-cyan-200 hover:border-cyan-400 hover:text-white'
                        : 'border-purple-600 bg-purple-900 text-purple-200 hover:border-purple-400 hover:text-white'
                    }`}
                  >
                    {pendingChoice.kind === 'reveal_top_discard_or_return'
                      ? 'Discard It'
                      : pendingChoice.kind === 'discard_hand_draw_four'
                      ? 'Discard & Draw 4'
                      : pendingChoice.kind === 'choose_others_draw_or_discard'
                      ? 'Each Player Draws'
                      : pendingChoice.kind === 'optional_return_sidekick_draw_two'
                      ? 'Return & Draw 2'
                      : pendingChoice.kind === 'optional_gain_card'
                      ? 'Yes, Gain It'
                      : pendingChoice.kind === 'melter_decide_card'
                      ? 'KO It'
                      : 'Take Wound'}
                  </button>
                )}
                {/* Skip / decline button — hidden for mandatory costs and a
                    few specific kinds that are required to resolve but don't
                    have a `mandatory` flag on the choice itself. */}
                {!('mandatory' in pendingChoice && pendingChoice.mandatory)
                  && pendingChoice.kind !== 'order_top_of_deck'
                  && pendingChoice.kind !== 'escape_ko_hq_hero' && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={onSkipChoice}
                    className="rounded border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-400 hover:text-white disabled:opacity-40"
                  >
                    {pendingChoice.kind === 'reveal_to_prevent_wound'
                      ? 'Take the wound'
                      : pendingChoice.kind === 'reveal_top_discard_or_return'
                      ? 'Put It Back'
                      : pendingChoice.kind === 'discard_hand_draw_four'
                      ? 'Keep Hand'
                      : pendingChoice.kind === 'optional_gain_wound_pass_left'
                      ? 'No Wound'
                      : pendingChoice.kind === 'choose_others_draw_or_discard'
                      ? 'Each Player Discards'
                      : pendingChoice.kind === 'optional_return_sidekick_draw_two'
                      ? 'Keep Sidekick'
                      : pendingChoice.kind === 'optional_gain_card'
                      ? 'No Thanks'
                      : pendingChoice.kind === 'melter_decide_card'
                      ? 'Put It Back'
                      : 'Skip'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cruel Ruler free-fight hint — persistent amber banner while the token is live */}
      {isMyTurn && !!state.thisTurn.fightCityFreeAvailable && !isChoiceMode && (
        <div className="flex items-center gap-2 rounded-md border border-amber-600/50 bg-amber-950/60 px-3 py-1.5 text-[12px] font-medium text-amber-300">
          <span>⚔️</span>
          <span>Cruel Ruler — click any Villain or Henchman in the City to fight it for free!</span>
        </div>
      )}

      {/* Choice-mode hand label — only shown when there's a useful instruction */}
      {isChoiceMode && !isBinaryChoice && (
        <ZoneLabel>
          {pendingChoice!.kind === 'reveal_to_prevent_wound'
            ? 'Your hand — click Diving Block to reveal it'
            : pendingChoice!.kind === 'put_card_on_deck'
            ? 'Choose a card to put on top of your deck'
            : 'Choose a card to ' + (pendingChoice!.kind === 'ko_from_hand' ? 'KO' : 'discard')}
        </ZoneLabel>
      )}
      {/* Hand grid — always 6 columns so a standard hand fits on one row.
          A 7th+ card wraps naturally to a second row via CSS grid auto-placement.
          Cards stretch to fill their cell (1fr each) up to the 230 px natural cap. */}
      {(() => {
        const handLen = me?.hand.length ?? 0;
        // Use min(handLen, 6) columns so 1-6 cards are sized naturally; 7+ overflow to row 2.
        const cols = Math.min(Math.max(handLen, 1), 6);
        const gridStyle: React.CSSProperties = handLen > 0 ? {
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: '6px',
          maxWidth: `${cols * 236 - 6}px`,
        } : {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        };
        return (
          <div className="mx-auto w-full min-h-[140px]" style={gridStyle}>
            {me ? (
              me.hand.length === 0 ? (
                <div className="text-xs text-neutral-600">empty hand</div>
              ) : (
                [...me.hand]
                  .sort((a, b) => {
                    // In choice mode: valid targets first.
                    if (isChoiceMode) {
                      const aValid = isChoiceTarget(a.cardId, pendingChoice!);
                      const bValid = isChoiceTarget(b.cardId, pendingChoice!);
                      if (aValid !== bValid) return aValid ? -1 : 1;
                    }
                    // Wounds always first, troopers/agents always last
                    const priority = (id: string) => {
                      if (id === 'wound')          return -2;
                      if (id === 'shield_trooper') return  1;
                      if (id === 'shield_agent')   return  2;
                      return 0;
                    };
                    const ap = priority(a.cardId), bp = priority(b.cardId);
                    if (ap !== bp) return ap - bp;
                    // Otherwise highest cost first
                    const aD = CARDS[a.cardId];
                    const bD = CARDS[b.cardId];
                    return (bD?.kind === 'hero' ? bD.cost : 0) - (aD?.kind === 'hero' ? aD.cost : 0);
                  })
                  .map((card) => {
                    if (isChoiceMode && !isBinaryChoice) {
                      const valid = isChoiceTarget(card.cardId, pendingChoice!);
                      return (
                        <HandCard
                          key={card.instanceId}
                          card={card}
                          wide
                          disabled={!valid || disabled}
                          choiceMode={valid ? pendingChoice!.kind : undefined}
                          onClick={() => onResolveChoice(card.instanceId)}
                        />
                      );
                    }
                    if (card.cardId === 'wound') {
                      return (
                        <HandCard
                          key={card.instanceId}
                          card={card}
                          wide
                          disabled={!woundHealingAvailable || disabled}
                          onClick={woundHealingAvailable && onWoundHeal ? onWoundHeal : () => {}}
                        />
                      );
                    }
                    return (
                      <HandCard
                        key={card.instanceId}
                        card={card}
                        wide
                        disabled={!isMyTurn || isChoiceMode || disabled || state.phase === 'finished' || !isPlayable(card.cardId)}
                        onClick={() => onPlay(card.instanceId)}
                      />
                    );
                  })
              )
            ) : (
              <div className="text-xs text-neutral-600">Spectating</div>
            )}
          </div>
        );
      })()}

      {/* Discard zone — shown in choice mode when the effect allows picking
          from the discard pile (e.g. Dangerous Rescue: hand OR discard). */}
      {isChoiceMode && 'sources' in pendingChoice! && pendingChoice!.sources?.includes('discard') && me && (
        <>
          <ZoneLabel>Your discard pile — choose a card to KO</ZoneLabel>
          {(() => {
            const discardLen = me.discard.length;
            const gs: React.CSSProperties = discardLen > 0 ? {
              display: 'grid',
              gridTemplateColumns: `repeat(${discardLen}, minmax(0, 1fr))`,
              gap: '6px',
              maxWidth: `${discardLen * 236 - 6}px`,
            } : { display: 'flex', alignItems: 'center', justifyContent: 'center' };
            return (
              <div className="mx-auto w-full min-h-[100px]" style={gs}>
                {discardLen === 0 ? (
                  <div className="text-xs text-neutral-600">discard pile empty</div>
                ) : (
                  [...me.discard]
                    .sort((a, b) => {
                      const aValid = isChoiceTarget(a.cardId, pendingChoice!);
                      const bValid = isChoiceTarget(b.cardId, pendingChoice!);
                      if (aValid !== bValid) return aValid ? -1 : 1;
                      const aD = CARDS[a.cardId];
                      const bD = CARDS[b.cardId];
                      return (bD?.kind === 'hero' ? bD.cost : 0) - (aD?.kind === 'hero' ? aD.cost : 0);
                    })
                    .map((card) => {
                      const valid = isChoiceTarget(card.cardId, pendingChoice!);
                      return (
                        <HandCard
                          key={card.instanceId}
                          card={card}
                          wide
                          disabled={!valid || disabled}
                          choiceMode={valid ? pendingChoice!.kind : undefined}
                          onClick={() => onResolveChoice(card.instanceId)}
                        />
                      );
                    })
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* Played-this-turn zone — shown in Rogue Copy Powers mode so the player
          can pick a Hero they already played this turn to copy. */}
      {isChoiceMode && isCopyHeroChoice &&
       state.thisTurn.playedThisTurn.length > 0 && me && (
        <>
          <ZoneLabel>Played this turn — click a Hero to copy its ability</ZoneLabel>
          {(() => {
            const n = state.thisTurn.playedThisTurn.length;
            const gs: React.CSSProperties = {
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))`,
              gap: '6px',
              maxWidth: `${Math.max(1, n) * 236 - 6}px`,
            };
            return (
              <div className="mx-auto w-full min-h-[100px]" style={gs}>
                {state.thisTurn.playedThisTurn.map((card) => {
                  const def = CARDS[card.cardId];
                  const valid = def?.kind === 'hero' && card.cardId !== 'rogue_copy_powers';
                  return (
                    <HandCard
                      key={card.instanceId}
                      card={card}
                      wide
                      disabled={!valid || disabled}
                      choiceMode={valid ? 'copy_played_hero' : undefined}
                      onClick={() => valid && onResolveChoice(card.instanceId)}
                    />
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {/* Played-this-turn zone — shown in KO choice mode so the player can
          also KO cards they already played and got value from. */}
      {isChoiceMode && pendingChoice!.kind === 'ko_from_hand' &&
       state.thisTurn.playedThisTurn.length > 0 && me && (
        <>
          <ZoneLabel>Played this turn — choose a card to KO</ZoneLabel>
          {(() => {
            const n = state.thisTurn.playedThisTurn.length;
            const gs: React.CSSProperties = {
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))`,
              gap: '6px',
              maxWidth: `${Math.max(1, n) * 236 - 6}px`,
            };
            return (
              <div className="mx-auto w-full min-h-[100px]" style={gs}>
                {state.thisTurn.playedThisTurn.map((card) => {
                  const valid = isChoiceTarget(card.cardId, pendingChoice!);
                  return (
                    <HandCard
                      key={card.instanceId}
                      card={card}
                      wide
                      disabled={!valid || disabled}
                      choiceMode={valid ? 'ko_from_hand' : undefined}
                      onClick={() => onResolveChoice(card.instanceId)}
                    />
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {/* Doombot Legion peeked-cards zone — shown when the fight effect reveals 2
          top-deck cards and asks the player to pick one to KO. */}
      {isOrderTopOfDeck && pendingChoice?.kind === 'order_top_of_deck' && (
        <>
          <ZoneLabel>
            Choose the order — first click goes on TOP of your deck (drawn next)
            {pendingChoice.placed.length > 0 && (
              <span className="ml-2 text-emerald-400">
                · {pendingChoice.placed.length} placed
              </span>
            )}
          </ZoneLabel>
          {(() => {
            const cards = (pendingChoice as Extract<typeof pendingChoice, { kind: 'order_top_of_deck' }>).queue;
            const n = cards.length;
            const gs: React.CSSProperties = {
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))`,
              gap: '6px',
              maxWidth: `${Math.max(1, n) * 236 - 6}px`,
            };
            return (
              <div className="mx-auto w-full min-h-[100px]" style={gs}>
                {cards.map((card) => (
                  <HandCard
                    key={card.instanceId}
                    card={card}
                    wide
                    disabled={disabled}
                    choiceMode="ko_from_hand"
                    onClick={() => onResolveChoice(card.instanceId)}
                  />
                ))}
              </div>
            );
          })()}
        </>
      )}

      {isLookTopTwoChoice && pendingChoice?.kind === 'look_top_two_ko_one_return_one' && (
        <>
          <ZoneLabel>Choose a card to KO — the other returns to the top of your deck</ZoneLabel>
          {(() => {
            const cards = (pendingChoice as Extract<typeof pendingChoice, { kind: 'look_top_two_ko_one_return_one' }>).cards;
            const n = cards.length;
            const gs: React.CSSProperties = {
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))`,
              gap: '6px',
              maxWidth: `${Math.max(1, n) * 236 - 6}px`,
            };
            return (
              <div className="mx-auto w-full min-h-[100px]" style={gs}>
                {cards.map((card) => (
                  <HandCard
                    key={card.instanceId}
                    card={card}
                    wide
                    disabled={disabled}
                    choiceMode="ko_from_hand"
                    onClick={() => onResolveChoice(card.instanceId)}
                  />
                ))}
              </div>
            );
          })()}
        </>
      )}

      {/* Electromagnetic Bubble — player clicks an X-Men Hero from their played area. */}
      {isEmBubbleSelectHero && state.thisTurn.playedThisTurn.length > 0 && me && (
        <>
          <ZoneLabel>Electromagnetic Bubble — click an X-Men Hero you played this turn to add to your next hand</ZoneLabel>
          {(() => {
            const n = state.thisTurn.playedThisTurn.length;
            const gs: React.CSSProperties = {
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))`,
              gap: '6px',
              maxWidth: `${Math.max(1, n) * 236 - 6}px`,
            };
            return (
              <div className="mx-auto w-full min-h-[100px]" style={gs}>
                {state.thisTurn.playedThisTurn.map((card) => {
                  const def = CARDS[card.cardId];
                  const valid = def?.kind === 'hero' && (def as import('../lib/games/legendary/types').HeroCardDef).teams.includes('x-men');
                  return (
                    <HandCard
                      key={card.instanceId}
                      card={card}
                      wide
                      disabled={!valid || disabled}
                      choiceMode={valid ? 'copy_played_hero' : undefined}
                      onClick={() => valid && onResolveChoice(card.instanceId)}
                    />
                  );
                })}
              </div>
            );
          })()}
        </>
      )}

      {/* Maniacal Tyrant — player clicks a card from their discard to KO it. */}
      {isKoUpToFromDiscard && pendingChoice?.kind === 'ko_up_to_from_discard' && me && (
        <>
          <ZoneLabel>Maniacal Tyrant — click a card from your discard pile to KO it ({pendingChoice.remaining} remaining)</ZoneLabel>
          {(() => {
            const cards = pendingChoice.cards;
            const n = Math.max(1, cards.length);
            const gs: React.CSSProperties = {
              display: 'grid',
              gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
              gap: '6px',
              maxWidth: `${n * 236 - 6}px`,
            };
            return (
              <div className="mx-auto w-full min-h-[100px]" style={gs}>
                {cards.map((card) => (
                  <HandCard
                    key={card.instanceId}
                    card={card}
                    wide
                    disabled={disabled}
                    choiceMode="ko_from_hand"
                    onClick={() => onResolveChoice(card.instanceId)}
                  />
                ))}
              </div>
            );
          })()}
        </>
      )}

      {/* Victory-assured banner — shown after the final Tactic is taken but
          before the player clicks End Turn, so they can collect bonus VP. */}
      {state.pendingResult === 'win' && (
        <div className="rounded-lg border border-emerald-500 bg-emerald-950/50 px-4 py-2.5 text-center">
          <div className="text-sm font-bold text-emerald-300">
            🏆 {isMyTurn
              ? 'Victory assured! Keep playing for bonus VP, then End Turn to finish.'
              : `${currentPlayer?.username ?? 'A player'} is finishing their victory lap!`}
          </div>
        </div>
      )}

      {/* Game-start acknowledgment overlay — player clicks to trigger turn-1 villain reveal */}
      {state.phase === 'playing' && state.turn === 1 && !startAcked && (
        <StartAckOverlay onAck={handleStartAck} />
      )}
      {/* Villain / strike / twist reveal overlay */}
      {revealAnim && <CardRevealOverlay anim={revealAnim} />}

      {/* Collapsible log */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-950/60">
        <button
          type="button"
          onClick={() => setLogExpanded(e => !e)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-[10px] uppercase tracking-wider text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <span>Recent Actions{state.log.length > 0 ? ` (${state.log.length})` : ''}</span>
          <span className="text-neutral-600">{logExpanded ? '▲' : '▼'}</span>
        </button>
        {logExpanded && (
          <div className="max-h-64 space-y-0.5 overflow-y-auto px-3 pb-3 font-mono text-[11px] leading-snug">
            {state.log.length === 0 ? (
              <div className="text-neutral-600">No actions yet.</div>
            ) : (
              [...state.log].reverse().map((ev, i) => (
                <div key={state.log.length - 1 - i} className={logColor(ev, mySeat)}>{logText(ev)}</div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** City location names (left to right). Villains ENTER at Sewers (slot 0)
 *  and age toward Bridge (slot 4), which is the escape edge — when the next
 *  villain is revealed the Bridge slot falls off. */
const CITY_LOCATIONS = ['Sewers', 'Bank', 'Rooftops', 'Streets', 'Bridge'] as const;

/** Atmospheric CSS gradient backgrounds for empty city slots. */
const CITY_EMPTY_STYLES: Record<number, { bg: string; border: string }> = {
  0: { bg: 'linear-gradient(180deg,#0d1f12,#071008)',  border: '#1a3a22' }, // Sewers — murky green
  1: { bg: 'linear-gradient(135deg,#1c1808,#120f05)',  border: '#302806' }, // Bank   — warm amber
  2: { bg: 'linear-gradient(180deg,#0c0f22,#070818)',  border: '#181a35' }, // Rooftops — night navy
  3: { bg: 'linear-gradient(180deg,#181818,#0f0f12)',  border: '#282830' }, // Streets — concrete
  4: { bg: 'linear-gradient(160deg,#0e1620,#090f18)',  border: '#182030' }, // Bridge — steel blue
};
/** Diagonal noise texture layered over atmospheric slot backgrounds. */
const CITY_TEXTURE = 'repeating-linear-gradient(135deg,rgba(255,255,255,0.025) 0 1px,transparent 1px 12px)';

/** Per-slot fill color for the chevron location strip below the city grid.
 *  All five slots use the same neutral so the strip reads as one continuous
 *  divider instead of five differently-tinted segments stitched together. */
const CITY_CHEVRON_COLORS: Record<number, string> = {
  0: '#1a1a1a', // Sewers
  1: '#1a1a1a', // Bank
  2: '#1a1a1a', // Rooftops
  3: '#1a1a1a', // Streets
  4: '#1a1a1a', // Bridge
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** End-of-game scoreboard. Sorted by VP desc; crowns the highest-VP player as
 *  MVP. Handles ties (every player tied for highest gets the MVP badge).
 *  Surfaces the final Victory Pile count alongside each VP total so it's easy
 *  to see at a glance how the points were earned. */
function FinalScoreboard({ players }: { players: PlayerState[] }) {
  if (players.length === 0) return null;
  // Stable sort: higher VP first; preserve seat order for ties.
  const sorted = [...players].sort((a, b) => b.vp - a.vp || a.seat - b.seat);
  const topVp = sorted[0].vp;
  const mvpCount = sorted.filter(p => p.vp === topVp).length;
  const mvpLine = mvpCount === 1
    ? `🏆 ${sorted[0].username} is the MVP!`
    : `🏆 ${mvpCount}-way tie for MVP at ${topVp} VP`;

  return (
    <div className="mx-auto w-full max-w-2xl rounded-xl border-2 border-amber-700/60 bg-gradient-to-br from-amber-950/40 to-neutral-950/60 p-5 shadow-xl">
      <h2 className="mb-1 text-center text-[10px] font-semibold uppercase tracking-widest text-amber-300/70">
        Final Scoreboard
      </h2>
      <h3 className="mb-4 text-center text-lg font-bold text-amber-200">{mvpLine}</h3>
      <div className="space-y-1.5">
        {sorted.map((p, i) => {
          const isMvp = p.vp === topVp;
          const rank = i + 1;
          return (
            <div
              key={p.playerId}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 transition ${
                isMvp
                  ? 'border-amber-500/60 bg-amber-900/30'
                  : 'border-neutral-800 bg-neutral-900/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    isMvp ? 'bg-amber-500 text-neutral-900' : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {rank}
                </span>
                <div className="flex flex-col">
                  <span className={`text-sm font-medium ${isMvp ? 'text-amber-100' : 'text-neutral-200'}`}>
                    {p.username}
                    {isMvp && <span className="ml-2 text-amber-400">👑 MVP</span>}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {p.victoryPile.length} card{p.victoryPile.length === 1 ? '' : 's'} in Victory Pile
                  </span>
                </div>
              </div>
              <span
                className={`font-mono text-2xl font-bold tabular-nums ${
                  isMvp ? 'text-amber-300' : 'text-neutral-300'
                }`}
              >
                {p.vp}
                <span className="ml-1 text-xs font-normal text-neutral-500">VP</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Rewrites a pending-choice banner string so it reads correctly when an
 *  OFF-TURN viewer is watching another player resolve a choice. Swaps the
 *  second-person pronouns ("You" / "your") to the active player's name plus
 *  third-person ("they" / "their"), and prefixes a "[Name]:" tag so it's
 *  immediately obvious the prompt isn't for the viewer to act on. Leaves
 *  the leading emoji (if any) untouched so the visual tone is consistent.
 *
 *  No-op when `isMyTurn` is true — the active player still sees the original
 *  "You must..." copy. */
function adaptPromptForViewer(
  text: string,
  isMyTurn: boolean,
  activeName: string | undefined,
): string {
  if (isMyTurn) return text;
  const name = activeName ?? 'The active player';
  // Capture leading emoji + whitespace so we can keep it at the front when we
  // prepend the active player's name.
  const prefixMatch = text.match(/^([^A-Za-z]+)/);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const body = text.slice(prefix.length)
    // Order matters: bigrams first so single-word patterns don't eat them.
    .replace(/\bYou must\b/g, `${name} must`)
    .replace(/\bYou may\b/g, `${name} may`)
    .replace(/\bYou'll\b/g, `${name} will`)
    .replace(/\bYour\b/g,    `${name}'s`)
    .replace(/\byour\b/g,    'their')
    .replace(/\bYou\b/g,     name)
    .replace(/\byou\b/g,     'they');
  return `${prefix}${name}: ${body}`;
}

function ZoneLabel({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 text-[10px] uppercase tracking-wider text-neutral-500">{children}</div>;
}

function CitySlot({
  card, slot, isLast, attack, locationDebuff = 0, disabled, onFight, attachedBystanders,
  freeBystanderFightAvailable = false, fightCityFreeAvailable = false,
  onMoveSelect, onMoveDest, onBystanderSelect,
  attachedHeroName, attachedHeroCost, killbotStrike, fightConditionMet = true,
}: {
  card: CardInstance | null;
  slot: number;
  isLast: boolean;
  attack: number;
  locationDebuff?: number;
  disabled: boolean;
  onFight: () => void;
  attachedBystanders: number;
  /** When true, the player may fight a villain with bystanders at zero attack cost. */
  freeBystanderFightAvailable?: boolean;
  /** When true (Loki Cruel Ruler), the player may fight any one villain for free. */
  fightCityFreeAvailable?: boolean;
  /** Storm – step 1: click this villain to lift it for moving. */
  onMoveSelect?: () => void;
  /** Storm – step 2: click this slot as the move destination. */
  onMoveDest?: () => void;
  /** Deadpool "Here, Hold This": click this villain to assign the bystander. */
  onBystanderSelect?: () => void;
  /** Skrull attach mechanic — name and cost of the Hero tucked under this villain. */
  attachedHeroName?: string;
  attachedHeroCost?: number;
  /** Killbots scheme: when this villain is a Killbot, its effective strike
   *  equals the current twist count. Used by the canFight gate so the player
   *  sees the live required attack. */
  killbotStrike?: number;
  /** Whether the villain's fightCondition (e.g. Blob requires an X-Men hero,
   *  Venom requires a Covert hero) is currently satisfied. When false, the
   *  fight button stays disabled even if the player has enough attack. */
  fightConditionMet?: boolean;
}) {
  // Storm – Spinning Cyclone step 2: every slot is a clickable destination.
  if (onMoveDest) {
    let inner: React.ReactNode = (
      <div className="flex h-full w-full items-center justify-center text-[11px] font-medium text-sky-400 uppercase tracking-widest">
        Place here
      </div>
    );
    if (card) {
      const d = getCard(card.cardId);
      if (d.kind === 'villain' || d.kind === 'henchman') {
        inner = d.kind === 'villain'
          ? <VillainCardArt  def={d} wide attachedBystanders={attachedBystanders} attachedHeroName={attachedHeroName} attachedHeroCost={attachedHeroCost} killbotStrike={killbotStrike} />
          : <HenchmanCardArt def={d} wide attachedBystanders={attachedBystanders} />;
      }
    }
    return (
      <button
        type="button"
        onClick={onMoveDest}
        className="block w-full h-36 rounded-lg border-2 border-dashed border-sky-500 bg-sky-950/20 transition hover:bg-sky-900/30"
      >
        {inner}
      </button>
    );
  }

  if (!card) {
    const emptyStyle = CITY_EMPTY_STYLES[slot] ?? { bg: '#111', border: '#333' };
    return (
      <div
        className="flex h-36 flex-col items-end justify-end rounded-lg p-2"
        style={{
          background: `${CITY_TEXTURE}, ${emptyStyle.bg}`,
          border: `1px solid ${emptyStyle.border}`,
        }}
      >
        <span className="text-[9px] uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.12)' }}>
          vacant
        </span>
      </div>
    );
  }
  const def = getCard(card.cardId);
  if (def.kind !== 'villain' && def.kind !== 'henchman') {
    return <div className="h-36 rounded-lg bg-neutral-900" />;
  }

  // Deadpool "Here, Hold This" — highlight this villain as a bystander-capture target.
  if (onBystanderSelect) {
    return (
      <button
        type="button"
        onClick={onBystanderSelect}
        className="block w-full -translate-y-1 rounded-lg ring-2 ring-amber-400 transition hover:-translate-y-2 hover:ring-amber-300"
      >
        {def.kind === 'villain'
          ? <VillainCardArt  def={def} wide attachedBystanders={attachedBystanders} />
          : <HenchmanCardArt def={def} wide attachedBystanders={attachedBystanders} />
        }
        <span className="sr-only">Assign bystander to {def.name}</span>
      </button>
    );
  }

  // Storm – Spinning Cyclone step 1: highlight this villain as moveable.
  if (onMoveSelect) {
    return (
      <button
        type="button"
        onClick={onMoveSelect}
        className="block w-full -translate-y-1 rounded-lg ring-2 ring-sky-400 transition hover:-translate-y-2 hover:ring-sky-300"
      >
        {def.kind === 'villain'
          ? <VillainCardArt  def={def} wide attachedBystanders={attachedBystanders} />
          : <HenchmanCardArt def={def} wide attachedBystanders={attachedBystanders} />
        }
        <span className="sr-only">Move villain in slot {slot}</span>
      </button>
    );
  }

  // Skrull attach mechanic: attached Hero's cost replaces the printed attack
  // when present. Killbots scheme: Killbot villains scale with twist count.
  // Mirrors engine's effective-attack logic in doFightCity.
  const baseAttack = attachedHeroCost !== undefined
    ? attachedHeroCost
    : (card?.cardId === 'killbot' ? (killbotStrike ?? 0) : def.attack);
  const effectiveRequired = Math.max(0, baseAttack - locationDebuff);
  // Free bystander fight (Hawkeye): can fight for free if villain has attached bystanders.
  // Free city fight (Loki Cruel Ruler): can fight any one villain for free.
  const canFight = !disabled && fightConditionMet && (
    attack >= effectiveRequired ||
    (freeBystanderFightAvailable && attachedBystanders > 0) ||
    fightCityFreeAvailable
  );
  // Highlight ring when the free city fight token is active and this villain is a valid target.
  const freeFightRing = !disabled && fightCityFreeAvailable
    ? 'ring-2 ring-offset-1 ring-offset-neutral-950 ring-amber-400'
    : '';
  return (
    <button
      type="button"
      disabled={!canFight}
      onClick={onFight}
      className={`block w-full rounded-lg transition-all duration-150 ${freeFightRing} ${
        canFight
          ? '-translate-y-3 shadow-lg hover:-translate-y-4 hover:shadow-xl'
          : ''
      }`}
    >
      {def.kind === 'villain'
        ? <VillainCardArt  def={def} wide attachedBystanders={attachedBystanders} locationDebuff={locationDebuff} attachedHeroName={attachedHeroName} attachedHeroCost={attachedHeroCost} killbotStrike={killbotStrike} />
        : <HenchmanCardArt def={def} wide attachedBystanders={attachedBystanders} />
      }
      <span className="sr-only">Slot {slot}</span>
    </button>
  );
}

function HQSlot({
  card, slot, recruit, disabled, onRecruit, refillAnim = false, onFreeRecruit, onFreeRecruitXmen, onTuckHero, onKoFromHq,
}: {
  card: CardInstance | null;
  slot: number;
  recruit: number;
  disabled: boolean;
  onRecruit: () => void;
  /** When true the card plays a flip-in animation (just placed from the Hero Deck). */
  refillAnim?: boolean;
  /** Dark Technology: when provided, this slot is in free-recruit mode.
   *  Eligible (Tech/Ranged) cards are highlighted and clickable; others are dimmed. */
  onFreeRecruit?: () => void;
  /** Bitter Captor (Magneto Tactic 2): when provided, this slot is in X-Men free-recruit mode.
   *  Eligible (X-Men) cards are highlighted in emerald and clickable; others are dimmed. */
  onFreeRecruitXmen?: () => void;
  /** Solo Twist bonus: when provided, click to tuck this Hero (cost ≤ 6) to the
   *  bottom of the Hero Deck. Ineligible (cost > 6) cards are dimmed. */
  onTuckHero?: () => void;
  /** Villain Escape penalty: when provided, click ANY HQ Hero to KO it. */
  onKoFromHq?: () => void;
}) {
  if (!card) {
    return (
      <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-neutral-800 text-[11px] text-neutral-600">
        empty
      </div>
    );
  }
  const def = getCard(card.cardId);
  if (def.kind !== 'hero') return <div className="h-40 rounded-lg bg-neutral-900" />;
  const copies = CARD_COPIES[card.cardId];

  // ── Dark Technology free-recruit mode ──────────────────────────────────────
  if (onFreeRecruit !== undefined) {
    const isEligible = def.classes.includes('tech') || def.classes.includes('ranged');
    return (
      <button
        type="button"
        disabled={!isEligible}
        onClick={isEligible ? onFreeRecruit : undefined}
        className={[
          'block w-full transition-all duration-150',
          refillAnim ? 'animate-hq-flip-in' : '',
          isEligible
            ? '-translate-y-3 shadow-lg ring-2 ring-cyan-400 hover:-translate-y-4 hover:shadow-xl hover:ring-cyan-300'
            : 'opacity-40',
        ].join(' ')}
      >
        <HeroCardArt def={def} wide height="h-36" copies={copies} />
        <span className="sr-only">Recruit {def.cardName} for free</span>
      </button>
    );
  }

  // ── Bitter Captor free X-Men recruit mode ──────────────────────────────────
  if (onFreeRecruitXmen !== undefined) {
    const isEligible = def.teams.includes('x-men');
    return (
      <button
        type="button"
        disabled={!isEligible}
        onClick={isEligible ? onFreeRecruitXmen : undefined}
        className={[
          'block w-full transition-all duration-150',
          refillAnim ? 'animate-hq-flip-in' : '',
          isEligible
            ? '-translate-y-3 shadow-lg ring-2 ring-emerald-400 hover:-translate-y-4 hover:shadow-xl hover:ring-emerald-300'
            : 'opacity-40',
        ].join(' ')}
      >
        <HeroCardArt def={def} wide height="h-36" copies={copies} />
        <span className="sr-only">Recruit {def.cardName} for free (X-Men)</span>
      </button>
    );
  }

  // ── Solo Twist tuck mode ────────────────────────────────────────────────────
  if (onTuckHero !== undefined) {
    const isEligible = def.cost <= 6;
    return (
      <button
        type="button"
        disabled={!isEligible}
        onClick={isEligible ? onTuckHero : undefined}
        className={[
          'block w-full transition-all duration-150',
          refillAnim ? 'animate-hq-flip-in' : '',
          isEligible
            ? '-translate-y-3 shadow-lg ring-2 ring-emerald-500 hover:-translate-y-4 hover:shadow-xl hover:ring-emerald-300'
            : 'opacity-40',
        ].join(' ')}
      >
        <HeroCardArt def={def} wide height="h-36" copies={copies} />
        <span className="sr-only">Tuck {def.cardName} to bottom of Hero Deck</span>
      </button>
    );
  }

  // ── Villain Escape penalty mode ─────────────────────────────────────────────
  // Player must KO a Hero from the HQ; any HQ Hero is eligible. Click any
  // slot to choose — every Hero gets the rose ring + lift treatment.
  if (onKoFromHq !== undefined) {
    return (
      <button
        type="button"
        onClick={onKoFromHq}
        className={[
          'block w-full transition-all duration-150',
          refillAnim ? 'animate-hq-flip-in' : '',
          '-translate-y-3 shadow-lg ring-2 ring-rose-500 hover:-translate-y-4 hover:shadow-xl hover:ring-rose-300',
        ].join(' ')}
      >
        <HeroCardArt def={def} wide height="h-36" copies={copies} />
        <span className="sr-only">KO {def.cardName} from the HQ</span>
      </button>
    );
  }

  const canAfford = !disabled && recruit >= def.cost;
  return (
    <button
      type="button"
      disabled={!canAfford}
      onClick={onRecruit}
      className={[
        'block w-full transition-all duration-150',
        refillAnim ? 'animate-hq-flip-in' : '',
        canAfford ? '-translate-y-3 shadow-lg hover:-translate-y-4 hover:shadow-xl' : 'opacity-60',
      ].join(' ')}
    >
      <HeroCardArt def={def} wide height="h-36" copies={copies} />
      <span className="sr-only">Slot {slot}</span>
    </button>
  );
}

function HandCard({
  card, disabled, onClick, choiceMode, wide = false,
}: {
  card: CardInstance;
  disabled: boolean;
  onClick: () => void;
  /** When set the card is highlighted as a KO/discard/topdeck/reveal/copy target. */
  choiceMode?: 'ko_from_hand' | 'discard_from_hand' | 'reveal_to_prevent_wound' | 'put_card_on_deck' | 'copy_played_hero' | 'move_villain_select_villain' | 'move_villain_select_dest';
  /** Stretch the card to fill a CSS grid cell instead of using a fixed pixel width. */
  wide?: boolean;
}) {
  const def = CARDS[card.cardId];
  // Wounds / bystanders in hand — junk cards that match sandbox system card art.
  // In choice mode they may be valid targets (e.g. Wolverine KOs a Wound),
  // so we respect the incoming `disabled` and `choiceMode` props rather than
  // hardcoding them as always-disabled.
  if (!def || def.kind !== 'hero') {
    const isWound     = def?.kind === 'wound';
    const isBystander = def?.kind === 'bystander';
    if (isWound || isBystander) {
      const systemChoiceRing =
        choiceMode === 'ko_from_hand'            ? 'ring-2 ring-rose-500 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
        choiceMode === 'discard_from_hand'       ? 'ring-2 ring-amber-400 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
        choiceMode === 'reveal_to_prevent_wound' ? 'ring-2 ring-sky-400 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
        choiceMode === 'put_card_on_deck'        ? 'ring-2 ring-emerald-400 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
        '';
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          className={`transition ${systemChoiceRing || (disabled ? 'cursor-default opacity-80' : 'hover:-translate-y-1 hover:shadow-lg')}`}
        >
          {isWound ? (
            /* Wound card — same visual structure as HeroCardArt so the text
               starts at the exact same vertical position as hero ability text. */
            <div
              style={{ borderWidth: 2, borderStyle: 'solid', borderColor: '#7a3030', background: 'linear-gradient(135deg, #6b2525, #5a1e1e)' }}
              className={`relative flex h-[165px] ${wide ? 'w-full' : 'w-[230px]'} flex-col items-stretch rounded-lg p-2 text-left`}
            >
              {/* Row 1: card name */}
              <div className="flex items-center gap-1 min-w-0">
                <div className="h-[14px] w-[14px] shrink-0" aria-hidden />
                <span className="text-[12px] font-bold leading-tight text-neutral-100">Wound</span>
              </div>
              {/* Row 2: type label — transparent placeholder keeps ability text at the same
                   vertical offset as hero cards (matches SystemCardArt's no-typeLabel behaviour). */}
              <div className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 shrink-0" aria-hidden />
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'transparent' }}>System Card</span>
              </div>
              {/* Ability text — pl-3 pr-2 pt-3 matches HeroCardArt exactly */}
              <div className="mb-1 flex-1 pl-3 pr-2 pt-3 text-[12px] leading-snug text-neutral-300">
                {(WOUND as { text?: string }).text}
              </div>
            </div>
          ) : (
            <SystemCardArt name="Bystander" borderColor="#c4a800" bg="linear-gradient(135deg, #c4a800, #a08600)" height="h-[165px]" wide={wide} vp={1} />
          )}
        </button>
      );
    }
    return (
      <div className={`flex h-[165px] ${wide ? 'w-full' : 'w-[220px]'} flex-col items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 opacity-60 text-[11px] text-neutral-500`}>
        Unknown card
      </div>
    );
  }
  const copies = CARD_COPIES[card.cardId];
  // SHIELD starters + Officer all share the agent grey tint.
  const SHIELD_CARD_IDS = ['shield_trooper', 'shield_agent', 'shield_officer', 'sidekick'];
  const shieldStyle: React.CSSProperties | undefined = SHIELD_CARD_IDS.includes(card.cardId)
    ? { background: 'linear-gradient(135deg, #7a7a7a, #686868)' }
    : undefined;
  // Choice-mode ring: red for KO, amber for discard, sky for reveal.
  const choiceRing =
    choiceMode === 'ko_from_hand'            ? 'ring-2 ring-rose-500 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
    choiceMode === 'discard_from_hand'       ? 'ring-2 ring-amber-400 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
    choiceMode === 'reveal_to_prevent_wound' ? 'ring-2 ring-sky-400 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
    choiceMode === 'put_card_on_deck'        ? 'ring-2 ring-emerald-400 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
    '';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={def.text}
      className={`transition ${choiceRing || (disabled ? 'opacity-50' : 'hover:-translate-y-1 hover:shadow-lg')}`}
    >
      <HeroCardArt def={def} copies={copies} wide={wide} style={shieldStyle} lightBg={!!shieldStyle} />
    </button>
  );
}

/** Small pile-style box for player Deck / Discard / VP in the resource bar.
 *  Pass `backFace` to overlay the same diagonal-stripe texture used on face-down
 *  hero/player draw piles (Deck and Discard share the same card back). */
function PlayerBox({
  label, value, shade, backFace = false,
}: {
  label: string;
  value: number;
  shade: 'emerald' | 'rose';
  backFace?: boolean;
}) {
  const border = shade === 'rose' ? 'border-rose-900/60' : 'border-emerald-900/60';
  const bg     = shade === 'rose' ? 'bg-rose-950/40'     : 'bg-emerald-950/30';
  const num    = shade === 'rose' ? 'text-rose-400'       : 'text-neutral-200';
  return (
    <div className={`relative flex h-14 w-14 flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-solid ${border} ${bg}`}>
      {backFace && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{ background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0 4px, transparent 4px 8px)' }}
        />
      )}
      <span className="relative z-10 text-[9px] uppercase tracking-wider text-white">{label}</span>
      <span className={`relative z-10 font-sans tabular-nums text-lg font-bold ${num}`}>{value}</span>
    </div>
  );
}

function ResourcePip({ label, value, color }: { label: string; value: number; color: 'rose' | 'emerald' | 'neutral' }) {
  const cls = color === 'rose' ? 'text-rose-400' : color === 'emerald' ? 'text-emerald-400' : 'text-neutral-300';
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <span className={`font-sans tabular-nums text-xl font-bold ${cls}`}>{value}</span>
    </div>
  );
}

function PlayerRow({
  p, active, isYou, floaters,
}: {
  p: PlayerState;
  active: boolean;
  isYou: boolean;
  floaters: Floater[];
}) {
  const accent = p.accent_color ?? '#10b981';
  return (
    <div className={`relative flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
      active ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-neutral-800'
    }`}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
      <span className="truncate font-medium text-neutral-100">{p.username}</span>
      {isYou && <span className="text-[9px] uppercase tracking-wider text-neutral-500">you</span>}
      <div className="ml-auto flex items-center gap-3 text-[10px] text-neutral-400">
        <span>hand {p.hand.length}</span>
        <span>deck {p.deck.length}</span>
        <span>disc {p.discard.length}</span>
        {p.pendingMasterStrikeKO && (
          <span className="shrink-0 rounded bg-rose-900/60 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-400">
            ⚡ KO pending
          </span>
        )}
        <span className="font-mono text-emerald-400">{p.vp} VP</span>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
        {floaters.map((f, i) => (
          <div
            key={f.key}
            className="animate-float-up font-mono text-base font-bold"
            style={{
              marginLeft: `${i * 8}px`,
              color: f.tone === 'damage' ? '#fb7185' : '#4ade80',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            {f.sign}{f.amount}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playmat pile components (face-up/down stack visualizations)
// ---------------------------------------------------------------------------

/** Tone palette for pile borders. Mirrors the playmat's color-coding:
 *  scheme/bystander = amber, villain/strike/escape = rose, hero = emerald. */
type PileTone = 'neutral' | 'rose' | 'amber' | 'emerald';
function pileToneClasses(tone: PileTone): string {
  switch (tone) {
    case 'rose':    return 'border-rose-900/60 bg-rose-950/30';
    case 'amber':   return 'border-amber-900/60 bg-amber-950/30';
    case 'emerald': return 'border-emerald-900/60 bg-emerald-950/30';
    default:        return 'border-neutral-800 bg-neutral-950/30';
  }
}

/**
 * Compact stack representation for a draw/discard/escape/wound/bystander pile.
 * Shows: zone label, current count, optionally a name from the top card,
 * optionally a "card back" texture for face-down decks.
 */
const SHIELD_GREY_STYLE: React.CSSProperties = { background: 'linear-gradient(135deg, #7a7a7a, #686868)' };

function PileDisplay({
  label, count, total, topCardLabel, tone = 'neutral', backFace = false, compact = false,
  square = false, fill = false, pileStyle, infinite = false,
  cost, onClick, canAfford = false,
}: {
  label: string;
  count: number;
  total?: number;
  topCardLabel?: string;
  tone?: PileTone;
  backFace?: boolean;
  compact?: boolean;
  square?: boolean;
  fill?: boolean;
  pileStyle?: React.CSSProperties;
  /** Show ∞ instead of count (always-available pool). */
  infinite?: boolean;
  /** Recruit cost badge in bottom-right corner. */
  cost?: number;
  /** Click handler for recruitable pools (Sidekick, Officer). */
  onClick?: () => void;
  /** Highlight as affordable — lifts the pile like HQ cards. */
  canAfford?: boolean;
}) {
  const h = fill ? 'flex-1 min-h-0' : square ? 'aspect-square w-full' : compact ? 'h-10' : 'h-20';
  const hasCards = infinite || count > 0;
  const borderStyle = hasCards ? 'border-solid' : 'border-dashed';
  // opacity-60 is applied to the INNER content, not the outer wrapper.
  // If it were on the outer wrapper the hover-preview card (rendered as a
  // sibling of the content div) would inherit the parent opacity and appear
  // washed out — CSS opacity is multiplicative and can't be undone in children.
  const liftClass = onClick
    ? canAfford
      ? '-translate-y-2 shadow-lg cursor-pointer hover:-translate-y-3 hover:shadow-xl'
      : 'cursor-not-allowed'
    : '';
  const dimContent = onClick && !canAfford;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? {
        type: 'button' as const,
        // Use aria-disabled instead of HTML disabled so the button stays hoverable
        // (HTML disabled suppresses pointer events, which breaks group-hover previews).
        'aria-disabled': !canAfford,
        onClick: canAfford ? onClick : undefined,
      } : {})}
      style={pileStyle}
      className={`group relative flex ${h} flex-col items-center justify-center rounded-lg border-2 ${borderStyle} ${pileToneClasses(tone)} px-1.5 py-1 transition-all duration-150 ${liftClass}`}
    >
      {backFace && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0.5 rounded-md opacity-25 ${dimContent ? 'opacity-[0.15]' : 'opacity-25'}`}
          style={{ background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0 4px, transparent 4px 8px)' }}
        />
      )}
      <div className={`relative z-10 flex flex-col items-center transition-opacity duration-150 ${dimContent ? 'opacity-60' : ''}`}>
        <span className="text-[9px] uppercase tracking-wider text-white">{label}</span>
        <span className="font-sans tabular-nums text-base font-bold text-neutral-200">
          {infinite ? '∞' : count}{total !== undefined ? `/${total}` : ''}
        </span>
        {topCardLabel && !compact && (
          <span className="line-clamp-1 max-w-full text-[9px] text-neutral-400">{topCardLabel}</span>
        )}
      </div>
      {/* Recruit cost badge — dims with content */}
      {cost !== undefined && (
        <div
          className={`absolute bottom-1 right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9px] font-bold shadow transition-opacity duration-150 ${dimContent ? 'opacity-60' : ''}`}
          style={{ backgroundColor: '#7A6330', border: '1px solid #A8893E', color: '#fff' }}
        >
          {cost}
        </div>
      )}
      {/* Hover card previews are rendered by the CALLER as siblings of this
          element — not as children — so their z-index escapes the button's
          stacking context. See the sidekick/officer group-relative wrappers. */}
    </Tag>
  );
}

/** Scheme card — the playmat's "scheme" zone. Shows the scheme name + a
 *  small threat meter that fills as twists get revealed. */
function SchemeZone({
  schemeDef, twistsRevealed,
}: {
  schemeDef: ReturnType<typeof getCard>;
  twistsRevealed: number;
}) {
  // Hooks must run unconditionally — call before any early return.
  const textRef = useAutoFitFontSize(
    11, 8,
    [schemeDef.kind === 'scheme' ? schemeDef.text : '', schemeDef.cardId],
  );

  if (schemeDef.kind !== 'scheme') {
    return <div className="h-full rounded-lg border border-dashed border-neutral-800" />;
  }
  const labelColor = '#a78bfa'; // violet-400 — matches the "Scheme" type label

  return (
    <div
      className="flex h-full flex-col rounded-lg border-2 border-solid border-violet-700/70 bg-gradient-to-br from-violet-950/40 to-neutral-950/40 px-2 py-1"
    >
      <span className="truncate text-[14px] font-bold text-white leading-tight">{schemeDef.name}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: labelColor }}>Scheme</span>
      {schemeDef.text && (
        <div ref={textRef} className="mt-1 flex-1 overflow-hidden leading-tight">
          {schemeDef.text.split('\n').map((segment, i) => {
            const colonIdx = segment.indexOf(':');
            if (colonIdx > 0) {
              const label = segment.slice(0, colonIdx + 1);
              const body  = segment.slice(colonIdx + 1).trim();
              return (
                <div key={i}>
                  <span className="font-bold" style={{ color: labelColor }}>{label}</span>
                  {body && <span className="ml-0.5 text-white"><CardText text={body} /></span>}
                </div>
              );
            }
            return <div key={i} className="text-white"><CardText text={segment} /></div>;
          })}
        </div>
      )}
      <div className="mt-auto flex gap-0.5">
        {Array.from({ length: schemeDef.twists }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded ${i < twistsRevealed ? 'bg-violet-500' : 'bg-neutral-700'}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Mastermind card — the boss. Clickable to attempt a fight. Styled to match
 *  the sandbox MastermindCardArt: crimson border, name/label/alwaysLeads/strike
 *  text. Tactic progress bar stays at the bottom. */
function MastermindZone({
  mmDef, tacticsLeft, attack, mastermindAttackDebuff = 0, isMyTurn, disabled, onFight, bystanderCount = 0,
}: {
  mmDef: ReturnType<typeof getCard>;
  /** How many Tactic cards are still face-down (= hits left to win). */
  tacticsLeft: number;
  /** Effective attack available (already includes recruit if God of Thunder is active). */
  attack: number;
  /** Storm's Tidal Wave: reduces the mastermind's effective attack requirement. */
  mastermindAttackDebuff?: number;
  isMyTurn: boolean;
  disabled: boolean;
  onFight: () => void;
  /** Bystanders currently held by the mastermind. */
  bystanderCount?: number;
}) {
  if (mmDef.kind !== 'mastermind') {
    return <div className="h-full rounded-lg border border-dashed border-neutral-800" />;
  }
  const totalTactics = mmDef.hits;
  const effectiveRequired = Math.max(0, mmDef.attack - mastermindAttackDebuff);
  const canHit = isMyTurn && !disabled && attack >= effectiveRequired && tacticsLeft > 0;
  // Border is always bright crimson (matches scheme panel's always-bright violet).
  const borderColor = '#DC143C';

  return (
    <button
      type="button"
      disabled={!canHit}
      onClick={onFight}
      style={{ borderWidth: 2, borderColor, borderStyle: 'solid' }}
      className={`relative flex h-full w-full flex-col rounded-lg bg-gradient-to-br from-red-950/40 to-neutral-950/40 p-2 text-left transition ${
        canHit ? 'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-rose-700/50' : ''
      }`}
    >
      {/* Name */}
      <div className="truncate text-[15px] font-bold leading-tight text-white">
        {mmDef.name}
      </div>
      {/* Type label */}
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#DC143C' }}>
        Mastermind
      </div>
      {/* Always Leads */}
      <div className="mt-0.5 text-[11px]">
        <span className="font-semibold" style={{ color: '#DC143C' }}>Always Leads: </span>
        <span className="font-bold text-white">{teamDisplayName(mmDef.alwaysLeads)}</span>
      </div>
      {/* Strike text — label in crimson, body in white; truncated to 2 lines */}
      {mmDef.text && (() => {
        const colonIdx = mmDef.text!.indexOf(':');
        const label = colonIdx > 0 ? mmDef.text!.slice(0, colonIdx + 1) : '';
        const body  = colonIdx > 0 ? mmDef.text!.slice(colonIdx + 1).trim() : mmDef.text!;
        return (
          <div className="mt-1 line-clamp-2 pr-7 text-[11px] leading-snug">
            {label && <span className="font-bold" style={{ color: '#DC143C' }}>{label} </span>}
            <span className="text-white"><CardText text={body} /></span>
          </div>
        );
      })()}
      {/* Tactic bars — spans full width */}
      <div className="mt-auto pt-1">
        {/* gap-1.5 prevents the bleed / merge effect between adjacent lights */}
        <div className="flex gap-1.5">
          {Array.from({ length: tacticsLeft }).map((_, i) => (
            <div key={i} className="h-2 flex-1 rounded bg-rose-800" />
          ))}
          {Array.from({ length: totalTactics - tacticsLeft }).map((_, i) => (
            <div key={`done-${i}`} className="h-2 flex-1 rounded bg-neutral-700" />
          ))}
        </div>
      </div>
      {/* VP badge */}
      <div
        className="absolute right-1 top-1/2 -translate-y-1/2 flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-bold shadow"
        style={{ backgroundColor: '#b91c1c', border: '1px solid #ef4444', color: '#fff' }}
      >
        {mmDef.vp}
      </div>
      {/* Attack stat — pinned right, floating just above the tactic bars */}
      <span className="absolute right-1 bottom-[20px] flex items-center gap-0.5 text-[13px] font-semibold text-white">
        {mmDef.attack}<StrikeIcon size={13} />
      </span>
      {/* Bystander tab — same gold style as villain card tabs */}
      {bystanderCount > 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 pointer-events-none"
          style={{
            top: -15,
            backgroundColor: '#c4a800',
            border: '2px solid #f0c000',
            borderBottom: 'none',
            borderRadius: '4px 4px 0 0',
            padding: '2px 8px 3px',
            fontSize: '9px',
            fontWeight: 700,
            color: '#1a1000',
            whiteSpace: 'nowrap',
            zIndex: 20,
            boxShadow: '0 -2px 6px rgba(196,168,0,0.5)',
          }}
        >
          <span>👤</span>
          <span>×{bystanderCount}</span>
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Game-start acknowledgment overlay
// ---------------------------------------------------------------------------

/**
 * Shown to every player at the start of turn 1, before the first villain
 * reveal animation fires. Clicking anywhere dismisses it and triggers the
 * animation. Keeps the dramatic first-reveal from firing before the player
 * has had a chance to see the board.
 */
function StartAckOverlay({ onAck }: { onAck: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[999] flex cursor-pointer items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      onClick={onAck}
    >
      <div className="flex flex-col items-center gap-4 select-none">
        <div
          className="text-4xl font-extrabold uppercase tracking-widest text-white"
          style={{ textShadow: '0 0 40px rgba(239,68,68,0.9), 0 2px 8px rgba(0,0,0,0.8)' }}
        >
          Game Begins
        </div>
        <div className="text-sm text-neutral-300">Click anywhere to reveal the first villain</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Villain / strike / twist reveal animation overlay
// ---------------------------------------------------------------------------

/** Inner card art for the reveal overlay — dispatches to the right card type. */
function RevealCardContent({ anim }: { anim: RevealAnim }) {
  if (anim.kind === 'villain' || anim.kind === 'henchman') {
    const def = getCard(anim.cardId);
    if (def.kind === 'villain')   return <VillainCardArt   def={def} />;
    if (def.kind === 'henchman')  return <HenchmanCardArt  def={def} />;
    return null;
  }
  if (anim.kind === 'hero' || anim.kind === 'hero_recruited') {
    const def = getCard(anim.cardId);
    if (def.kind === 'hero') return <HeroCardArt def={def} copies={CARD_COPIES[anim.cardId]} />;
    return null;
  }
  if (anim.kind === 'master_strike') {
    return (
      <SystemCardArt
        name="Master Strike"
        borderColor="#c45000"
        bg="linear-gradient(135deg, #8a3800, #6a2c00)"
        text={anim.strikeText}
        typeLabel={anim.typeLabel}
      />
    );
  }
  if (anim.kind === 'bystander') {
    return (
      <SystemCardArt
        name="Bystander"
        borderColor="#c4a800"
        bg="linear-gradient(135deg, #c4a800, #a08600)"
        vp={1}
      />
    );
  }
  if (anim.kind === 'wound') {
    return (
      <SystemCardArt
        name="Wound"
        borderColor="#7a3030"
        bg="linear-gradient(135deg, #6b2525, #5a1e1e)"
        text="Healing: If you don't recruit or fight anything on your turn, you may KO all the Wounds from your hand."
      />
    );
  }
  if (anim.kind === 'tactic') {
    const tacticDef = getCard(anim.cardId);
    if (tacticDef?.kind === 'tactic') {
      return <TacticCardArt def={tacticDef} mastermindName={anim.typeLabel} />;
    }
    // Fallback: render a system card with the tactic text if lookup fails
    return (
      <SystemCardArt
        name={anim.typeLabel ?? 'Tactic'}
        borderColor="#DC143C"
        bg="linear-gradient(135deg, #7a0a1e, #5a0614)"
        text={anim.strikeText}
        typeLabel={anim.typeLabel ? `Mastermind Tactic - ${anim.typeLabel}` : 'Mastermind Tactic'}
      />
    );
  }
  return (
    <SystemCardArt
      name="Scheme Twist"
      borderColor="#4a2880"
      bg="linear-gradient(135deg, #3a2068, #2e1854)"
    />
  );
}

/**
 * Full-screen fixed overlay that plays the villain-reveal flip animation:
 *
 *   entering (0 ms)  — card starts tiny + face-down (rotateY 90°, scale 0.05)
 *   showing  (50 ms) — transitions to 1.5× scale, face revealed, dark backdrop
 *   exiting  (2500ms)— shrinks and translates toward its destination pile
 *   removed  (3500ms)— cleared from state
 *
 * The outer <div> handles the X/Y exit translation; the inner handles the
 * flip + scale, keeping perspective consistent throughout.
 */
function CardRevealOverlay({ anim }: { anim: RevealAnim }) {
  const isShowing = anim.phase === 'showing';
  const isExiting = anim.phase === 'exiting';

  // Outer wrapper: handles entry-from-deck translation and exit-to-destination translation.
  const outerTransform = (() => {
    if (isExiting)  return `translate(${anim.exitX}px, ${anim.exitY}px)`;
    if (isShowing)  return 'translate(0,0)';
    return `translate(${anim.startX ?? 400}px, ${anim.startY ?? 100}px)`;
  })();
  const outerTransition = (() => {
    if (isExiting) return 'transform 900ms cubic-bezier(0.4,0,1,1)';
    if (isShowing) return 'transform 500ms cubic-bezier(0.34,1.2,0.64,1)';
    return 'none';
  })();

  // Inner transform: flip + scale
  const innerTransform = (() => {
    switch (anim.phase) {
      case 'entering': return 'perspective(800px) rotateY(90deg) scale(0.3)';
      case 'showing':  return 'perspective(800px) rotateY(0deg) scale(1.5)';
      case 'exiting':  return 'perspective(800px) rotateY(0deg) scale(0.35)';
    }
  })();

  const label = (() => {
    switch (anim.kind) {
      case 'villain':        return 'Villain Revealed';
      case 'henchman':       return 'Henchman Revealed';
      case 'master_strike':  return 'Master Strike!';
      case 'scheme_twist':   return 'Scheme Twist!';
      case 'bystander':      return 'Bystander Captured!';
      case 'hero':           return 'Hero Added to HQ!';
      case 'hero_recruited': return 'Hero Recruited!';
      case 'tactic':         return 'Tactic Earned!';
      case 'wound':          return 'Wound Taken!';
    }
  })();

  const labelColor = anim.kind === 'master_strike'
    ? '#fb923c'
    : anim.kind === 'scheme_twist'
    ? '#c084fc'
    : anim.kind === 'bystander'
    ? '#fcd34d'
    : (anim.kind === 'hero' || anim.kind === 'hero_recruited')
    ? '#34d399'
    : anim.kind === 'tactic'
    ? '#DC143C'
    : anim.kind === 'wound'
    ? '#f87171'
    : '#f87171';

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-none">
      {/* Dark backdrop — fades in on showing, out on exiting */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: isShowing ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0)',
          transition: isExiting ? 'background-color 600ms ease-out' : 'background-color 350ms ease-in',
        }}
      />

      {/* Outer wrapper handles the entry-from-deck and exit-to-destination translation */}
      <div
        className="relative z-10"
        style={{
          transform: outerTransform,
          transition: outerTransition,
        }}
      >
        {/* Inner wrapper handles the flip + scale + fade */}
        <div
          className="flex flex-col items-center gap-3"
          style={{
            transform: innerTransform,
            opacity: isExiting ? 0 : 1,
            transition: isExiting
              ? 'transform 900ms cubic-bezier(0.4,0,1,1), opacity 900ms ease-in'
              : 'transform 480ms cubic-bezier(0.34,1.56,0.64,1)',
          }}
        >
          <div
            className="text-[13px] font-extrabold uppercase tracking-[0.18em] drop-shadow-lg"
            style={{ color: labelColor, textShadow: `0 0 20px ${labelColor}88` }}
          >
            {label}
          </div>
          <RevealCardContent anim={anim} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hover-list tooltip — KO pile and Victory Pile
// ---------------------------------------------------------------------------

/** Floating card-name list shown when hovering a pile that wraps this component.
 *  The parent must have `position: relative` and `group` Tailwind class.
 *  `placement="below"` drops the list downward (use when the pile is near the top of the viewport).
 *  Each row is itself hoverable to show the full card art (PlayedCardPreview)
 *  alongside, so players can read individual cards without leaving the popup.
 *
 *  The preview tooltip is rendered with `position: fixed` so it can escape the
 *  popup's scroll-clip / overflow without triggering scrollbars. The popup's
 *  inner list still scrolls when there are many cards, but the scrollbar is
 *  hidden visually for a cleaner look. */
function HoverCardList({ cards, heading, placement = 'above' }: {
  cards: CardInstance[];
  heading: string;
  placement?: 'above' | 'below';
}) {
  // Track which row is hovered and the row element's screen rect; the preview
  // is positioned in viewport coordinates via that rect so it can render
  // OUTSIDE the popup's scroll container without triggering horizontal overflow.
  const [hovered, setHovered] = useState<{ idx: number; rect: DOMRect } | null>(null);

  if (cards.length === 0) return null;
  // No gap between pile and popup so the cursor can move from the pile into
  // the popup without dropping out of group-hover. pointer-events-auto lets
  // hovering inside the popup keep the parent group hovered.
  const posClass = placement === 'below' ? 'top-full' : 'bottom-full';

  // Card art is ~234px wide (HeroCardArt default w-[230px] + 2px border).
  // Preview is rendered as a position:fixed element keyed off the hovered
  // row's viewport rect. Auto-pick the side that fits: prefer right, flip to
  // left when right would overflow the viewport. Clamp Y so rows near the
  // top of the viewport don't push the preview off-screen.
  const PREVIEW_W = 234;
  const PREVIEW_H = 165;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth  : 1920;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const useLeftSide = hovered
    ? hovered.rect.right + PREVIEW_W + 8 > viewportW
    : false;
  const previewX = hovered
    ? (useLeftSide
        ? Math.max(8, hovered.rect.left - PREVIEW_W - 8)
        : hovered.rect.right + 8)
    : 0;
  const previewYRaw = hovered ? hovered.rect.top - 8 : 0;
  const previewY = Math.max(8, Math.min(viewportH - PREVIEW_H - 8, previewYRaw));

  return (
    <>
      <div className={`pointer-events-auto absolute left-0 z-[300] hidden w-52 rounded-lg border border-neutral-700 bg-neutral-900/95 p-2 shadow-xl backdrop-blur-sm group-hover:block ${posClass}`}>
        <div className="mb-1.5 text-[9px] uppercase tracking-wider text-neutral-500">
          {heading} — {cards.length}
        </div>
        {/* Inner scroll container — scrollbar hidden visually but content still
            scrolls via wheel / drag when there are more cards than fit. */}
        <div
          className="scrollbar-none max-h-56 space-y-0.5 overflow-y-auto"
          onMouseLeave={() => setHovered(null)}
        >
          {cards.map((c, i) => {
            const def = CARDS[c.cardId];
            // Resolve a display name from any card type.
            const name =
              def?.kind === 'hero'         ? def.cardName
              : def?.kind === 'wound'      ? 'Wound'
              : def?.kind === 'bystander'  ? 'Bystander'
              : def && 'name' in def       ? (def as { name: string }).name
              : c.cardId === 'master_strike' ? 'Master Strike'
              : c.cardId;
            // VP value if the card has one.
            const vp = def && 'vp' in def ? (def as { vp: number }).vp : null;
            const color =
              def?.kind === 'villain'  || def?.kind === 'henchman' ? 'text-rose-400'
              : def?.kind === 'hero'   ? 'text-emerald-400'
              : def?.kind === 'bystander' ? 'text-amber-400'
              : c.cardId === 'master_strike' ? 'text-orange-400'
              : 'text-neutral-400';
            return (
              <div
                key={i}
                onMouseEnter={e => setHovered({ idx: i, rect: e.currentTarget.getBoundingClientRect() })}
                className={`flex cursor-default items-center justify-between gap-2 rounded px-1 text-[10px] hover:bg-neutral-800/60 ${color}`}
              >
                <span className="truncate">{name}</span>
                {vp !== null && (
                  <span className="shrink-0 text-[9px] text-neutral-500">{vp}VP</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Preview portal — fixed positioning escapes the popup's clip rect so
          we don't trigger horizontal scrollbars on the list container. */}
      {hovered && cards[hovered.idx] && (
        <div
          className="pointer-events-none fixed z-[1000]"
          style={{ left: previewX, top: previewY }}
        >
          <PlayedCardPreview card={cards[hovered.idx]} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Played-strip card hover preview
// ---------------------------------------------------------------------------

const SHIELD_CARD_IDS_SET = new Set(['shield_trooper', 'shield_agent', 'shield_officer', 'sidekick']);
const SHIELD_GRADIENT: React.CSSProperties = { background: 'linear-gradient(135deg, #7a7a7a, #686868)' };

/** Full card art shown in a floating overlay above a played-strip chip. */
function PlayedCardPreview({ card }: { card: CardInstance }) {
  const def = CARDS[card.cardId];
  if (!def) return null;
  if (def.kind === 'hero') {
    const copies = CARD_COPIES[card.cardId];
    const isShield = SHIELD_CARD_IDS_SET.has(card.cardId);
    return (
      <HeroCardArt
        def={def}
        copies={copies}
        style={isShield ? SHIELD_GRADIENT : undefined}
        lightBg={isShield}
      />
    );
  }
  if (def.kind === 'wound') {
    return (
      <SystemCardArt
        name="Wound"
        borderColor="#7a3030"
        bg="linear-gradient(135deg, #6b2525, #5a1e1e)"
        text={(WOUND as { text?: string }).text}
      />
    );
  }
  if (def.kind === 'bystander') {
    return (
      <SystemCardArt
        name="Bystander"
        borderColor="#c4a800"
        bg="linear-gradient(135deg, #c4a800, #a08600)"
        vp={1}
      />
    );
  }
  // Villains and henchmen end up in the VP pile after being defeated; render
  // their full card art on hover so players can review what they've collected.
  if (def.kind === 'villain')  return <VillainCardArt  def={def} />;
  if (def.kind === 'henchman') return <HenchmanCardArt def={def} />;
  // Mastermind Tactics earned from hits also live in the VP pile — show the
  // tactic card with its parent mastermind name.
  if (def.kind === 'tactic') {
    const mm = MASTERMINDS.find(m => m.cardId === def.mastermindId);
    return <TacticCardArt def={def} mastermindName={mm?.name} attack={mm?.attack} />;
  }
  // Master Strike cards can show up too (rare — typically KO'd, but defensive).
  if (def.kind === 'master_strike') {
    return (
      <SystemCardArt
        name="Master Strike"
        borderColor="#c45000"
        bg="linear-gradient(135deg, #8a3800, #6a2c00)"
      />
    );
  }
  return null;
}

// ---------- helpers ----------

function labelOf(c: CardInstance): string {
  const def = CARDS[c.cardId];
  if (!def) return '?';
  if (def.kind === 'hero') return def.cardName;
  return def.name;
}

function isPlayable(id: CardId): boolean {
  return CARDS[id]?.kind === 'hero';
}

/** Returns true if a card in the player's hand is a valid target for the given
 *  pending choice (respects the 'wounds_only' filter). */
function isChoiceTarget(cardId: CardId, choice: PendingChoice): boolean {
  if (choice.kind === 'reveal_to_prevent_wound') {
    // Only a hero card that carries the prevent_wound_draw hand passive is valid.
    const def = CARDS[cardId];
    if (def?.kind !== 'hero') return false;
    return !!(def as HeroCardDef).onHand?.some(h => h.kind === 'prevent_wound_draw');
  }
  if ('filter' in choice && choice.filter === 'wounds_only') return cardId === 'wound';
  if ('filter' in choice && choice.filter === 'shield_heroes') {
    const def = CARDS[cardId];
    if (def?.kind !== 'hero') return false;
    const shieldTeams = new Set(['shield', 'shield-officer', 'shield-agent', 'shield-trooper']);
    return (def as HeroCardDef).teams.some(t => shieldTeams.has(t));
  }
  if ('filter' in choice && choice.filter === 'heroes_only') {
    return CARDS[cardId]?.kind === 'hero';
  }
  // copy_played_hero: hand/discard cards are never valid — selection is from the played zone only.
  if (choice.kind === 'copy_played_hero') return false;
  return true; // any card is a valid target when no filter is set
}

function logText(ev: LegendaryEvent): string {
  switch (ev.kind) {
    case 'system':             return ev.text;
    case 'turn_started':       return `${ev.username}'s turn.`;
    case 'card_played':        return `${ev.cardName} played.`;
    case 'hero_recruited':     return `recruited ${ev.cardName} (${ev.cost}🪙)`;
    case 'villain_defeated':   return `defeated ${ev.cardName} (+${ev.vp} VP)`;
    case 'villain_revealed':   return `${ev.cardName} entered the city`;
    case 'villain_escaped':    return `${ev.cardName} ESCAPED`;
    case 'mastermind_hit':     return `${ev.username} took "${ev.tacticName}" (+${ev.tacticVp}VP) — ${ev.tacticsRemaining} tactic${ev.tacticsRemaining === 1 ? '' : 's'} left`;
    case 'master_strike':      return `⚡ Master Strike: ${ev.effectText}`;
    case 'scheme_twist':       return `Scheme Twist ${ev.twistsRevealed} / ${ev.twistsTotal}`;
    case 'wound_taken':          return `${ev.username} took a Wound`;
    case 'bystander_rescued':    return `${ev.username} rescued ${ev.count} bystander${ev.count === 1 ? '' : 's'}`;
    case 'bystander_captured':   return `Bystander captured by ${ev.captorName}`;
    case 'hq_refilled':          return `HQ refilled: ${ev.cardName}`;
    case 'game_ended':           return ev.reasonText;
  }
}

function logColor(ev: LegendaryEvent, mySeat: number): string {
  if (ev.kind === 'villain_escaped' || ev.kind === 'master_strike') return 'text-rose-400';
  if (ev.kind === 'scheme_twist') return 'text-amber-400';
  if (ev.kind === 'bystander_captured') return 'text-amber-300';
  if (ev.kind === 'hq_refilled') return 'text-neutral-600';
  if (ev.kind === 'game_ended') return ev.result === 'win' ? 'text-emerald-300' : ev.result === 'tie' ? 'text-amber-300' : 'text-rose-300';
  if ('seat' in ev && (ev as { seat?: number }).seat === mySeat) return 'text-emerald-300';
  return 'text-neutral-400';
}

function sfx(ev: LegendaryEvent, mySeat: number): void {
  switch (ev.kind) {
    case 'card_played':       sounds.sdCardPlay(); break;
    case 'hero_recruited':    sounds.sdMana(); break;
    case 'villain_defeated':  sounds.sdDamage(); break;
    case 'villain_escaped':
    case 'master_strike':     sounds.sdLose(); break;
    case 'wound_taken':       sounds.sdPayHp(); break;
    case 'bystander_rescued': sounds.sdHeal(); break;
    case 'game_ended':        ev.result === 'win' ? sounds.win() : ev.result === 'tie' ? sounds.sdHeal() : sounds.sdLose(); break;
    default: break;
  }
  void mySeat;
}

function floaterFor(ev: LegendaryEvent): { seat: number; sign: '+' | '-'; amount: number; tone: 'damage' | 'heal' }[] {
  if (ev.kind === 'wound_taken') {
    return [{ seat: ev.seat, sign: '-', amount: 1, tone: 'damage' }];
  }
  if (ev.kind === 'bystander_rescued') {
    return [{ seat: ev.seat, sign: '+', amount: ev.count, tone: 'heal' }];
  }
  if (ev.kind === 'villain_defeated') {
    return [{ seat: ev.seat, sign: '+', amount: ev.vp, tone: 'heal' }];
  }
  return [];
}

// =====================================================================
// Lobby setup screen
// =====================================================================

/** Human-readable label for a villain/henchman group id. */
function groupLabel(id: string): string {
  return teamDisplayName(id);
}

/** How many hero classes are needed for a given player count. */
function neededHeroClasses(playerCount: number): number {
  if (playerCount <= 1) return 3;
  if (playerCount >= 5) return 6;
  return 5;
}

function LegendarySetup({
  state, isHost, disabled,
  onStart, onSetMastermind, onSetScheme, onSetHeroClasses, onRandomizeHeroes,
  onSetVillainGroups, onSetHenchmanGroups, onRandomizeVillains, onRandomizeHenchmen,
}: {
  state: LegendaryState;
  isHost: boolean;
  disabled: boolean;
  onStart: () => void;
  onSetMastermind?: (mastermindId: string) => void;
  onSetScheme?: (schemeId: string) => void;
  onSetHeroClasses?: (classNames: string[]) => void;
  onRandomizeHeroes?: () => void;
  onSetVillainGroups?: (groupIds: string[]) => void;
  onSetHenchmanGroups?: (groupIds: string[]) => void;
  onRandomizeVillains?: () => void;
  onRandomizeHenchmen?: () => void;
}) {
  const playerCount = state.players.length;
  const needed      = neededHeroClasses(playerCount);
  const selectedSet = new Set(state.heroClassIds);
  const selectedCount = selectedSet.size;

  // Selected villain / henchman groups (host's lobby picks, may be empty).
  const selectedVillainIds  = new Set(state.villainGroupIds);
  const selectedHenchmanIds = new Set(state.henchmanGroupIds);

  function toggleClass(cn: string) {
    if (!isHost || !onSetHeroClasses) return;
    const next = new Set(selectedSet);
    if (next.has(cn)) { next.delete(cn); } else { next.add(cn); }
    onSetHeroClasses([...next]);
  }
  function toggleVillain(groupId: string) {
    if (!isHost || !onSetVillainGroups) return;
    const next = new Set(selectedVillainIds);
    if (next.has(groupId)) { next.delete(groupId); } else { next.add(groupId); }
    onSetVillainGroups([...next]);
  }
  function toggleHenchman(groupId: string) {
    if (!isHost || !onSetHenchmanGroups) return;
    const next = new Set(selectedHenchmanIds);
    if (next.has(groupId)) { next.delete(groupId); } else { next.add(groupId); }
    onSetHenchmanGroups([...next]);
  }

  function randomizeMastermind() {
    if (!isHost || !onSetMastermind || disabled) return;
    const pick = MASTERMINDS[Math.floor(Math.random() * MASTERMINDS.length)];
    onSetMastermind(pick.cardId);
  }

  function randomizeScheme() {
    if (!isHost || !onSetScheme || disabled) return;
    const pick = SCHEMES[Math.floor(Math.random() * SCHEMES.length)];
    onSetScheme(pick.cardId);
  }

  function randomizeAll() {
    randomizeMastermind();
    randomizeScheme();
    onRandomizeHeroes?.();
    onRandomizeVillains?.();
    onRandomizeHenchmen?.();
  }

  const canStart = state.players.length >= 1 && selectedCount === needed;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {/* ── Title + Randomize All ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-2xl font-bold tracking-wide text-neutral-100">Game Setup</div>
          <div className="mt-0.5 text-xs text-neutral-500">Marvel Legendary — Co-op Deckbuilder</div>
        </div>
        {isHost && (
          <button
            type="button"
            disabled={disabled}
            onClick={randomizeAll}
            className="shrink-0 rounded-xl border border-violet-600 bg-violet-950/60 px-4 py-2 text-sm font-semibold text-violet-200 transition hover:border-violet-400 hover:text-white disabled:opacity-40"
          >
            🎲 Randomize All
          </button>
        )}
      </div>

      {/* ── Mastermind ── (compact title chips; hover reveals full details) */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionLabel className="mb-0">Mastermind</SectionLabel>
          {isHost && (
            <button type="button" disabled={disabled} onClick={randomizeMastermind}
              className="rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-400 hover:text-white disabled:opacity-40">
              🎲 Randomize
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MASTERMINDS.map(mm => (
            <SetupChip
              key={mm.cardId}
              label={mm.name}
              selected={mm.cardId === state.mastermindId}
              disabled={!isHost || disabled}
              tone="rose"
              onClick={() => isHost && onSetMastermind?.(mm.cardId)}
              hoverContent={<MastermindHoverCard mm={mm} />}
            />
          ))}
        </div>
      </section>

      {/* ── Scheme ── (compact title chips; hover reveals full details) */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionLabel className="mb-0">Scheme</SectionLabel>
          {isHost && (
            <button type="button" disabled={disabled} onClick={randomizeScheme}
              className="rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-400 hover:text-white disabled:opacity-40">
              🎲 Randomize
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SCHEMES.map(s => (
            <SetupChip
              key={s.cardId}
              label={s.name}
              selected={s.cardId === state.schemeId}
              disabled={!isHost || disabled}
              tone="violet"
              onClick={() => isHost && onSetScheme?.(s.cardId)}
              hoverContent={<SchemeHoverCard scheme={s} />}
            />
          ))}
        </div>
      </section>

      {/* ── Villain groups ── (multi-select; defaults to mastermind's
           alwaysLeads + auto-fill at game start when nothing is picked) */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionLabel className="mb-0">
            Villain Groups
            <span className="ml-1.5 font-normal normal-case text-neutral-600">
              ({playerCount} player{playerCount === 1 ? '' : 's'} — leave empty to auto-fill)
            </span>
          </SectionLabel>
          {isHost && (
            <button type="button" disabled={disabled} onClick={() => onRandomizeVillains?.()}
              className="rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-400 hover:text-white disabled:opacity-40">
              🎲 Randomize
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {VILLAIN_GROUPS.map(g => (
            <SetupChip
              key={g.groupId}
              label={teamDisplayName(g.team)}
              selected={selectedVillainIds.has(g.groupId)}
              disabled={!isHost || disabled}
              tone="red"
              onClick={() => toggleVillain(g.groupId)}
              hoverContent={<VillainGroupHoverCard group={g} />}
            />
          ))}
        </div>
      </section>

      {/* ── Henchman groups ── (multi-select) */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionLabel className="mb-0">
            Henchman Groups
            <span className="ml-1.5 font-normal normal-case text-neutral-600">
              (leave empty to auto-fill)
            </span>
          </SectionLabel>
          {isHost && (
            <button type="button" disabled={disabled} onClick={() => onRandomizeHenchmen?.()}
              className="rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-400 hover:text-white disabled:opacity-40">
              🎲 Randomize
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {HENCHMAN_GROUPS.map(g => (
            <SetupChip
              key={g.groupId}
              label={teamDisplayName(g.team)}
              selected={selectedHenchmanIds.has(g.groupId)}
              disabled={!isHost || disabled}
              tone="orange"
              onClick={() => toggleHenchman(g.groupId)}
              hoverContent={<HenchmanGroupHoverCard group={g} />}
            />
          ))}
        </div>
      </section>

      {/* ── Hero classes ── */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SectionLabel className="mb-0">Hero Classes</SectionLabel>
          <span className={[
            'text-xs font-semibold',
            selectedCount === needed ? 'text-emerald-400' : 'text-amber-400',
          ].join(' ')}>
            {selectedCount} / {needed} selected
          </span>
          {isHost && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRandomizeHeroes?.()}
              className="ml-auto rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-400 hover:text-neutral-100 disabled:opacity-40"
            >
              🎲 Randomize
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {HERO_CLASSES.map(cls => {
            const isSel = selectedSet.has(cls.className);
            // Use the primary class colour from the first card in the class.
            const primaryClass = cls.cards[0]?.def.classes[0];
            const hex = primaryClass ? CLASS_COLORS[primaryClass] : '#374151';
            return (
              <button
                key={cls.className}
                type="button"
                disabled={!isHost || disabled}
                onClick={() => toggleClass(cls.className)}
                style={isSel ? { borderColor: hex, backgroundColor: `${hex}22`, color: '#f5f5f5' } : {}}
                className={[
                  'rounded-lg border px-2 py-2 text-center text-xs font-medium transition',
                  isSel
                    ? 'shadow-sm'
                    : 'border-neutral-700 bg-neutral-800/50 text-neutral-500',
                  isHost && !disabled ? 'cursor-pointer hover:opacity-90' : 'cursor-default',
                ].join(' ')}
              >
                {cls.className}
              </button>
            );
          })}
        </div>
        {!isHost && (
          <p className="mt-2 text-xs text-neutral-600">Only the host can change hero classes.</p>
        )}
      </section>

      {/* ── Players ── */}
      <section>
        <SectionLabel>Players ({state.players.length})</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {state.players.map(p => (
            <div
              key={p.playerId}
              className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-1.5"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: p.accent_color ?? '#888' }}
              />
              <span className="text-xs font-medium text-neutral-200">{p.username}</span>
              {p.seat === 0 && <span className="text-[10px] text-amber-500">Host</span>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Start ── */}
      <div className="flex items-center gap-4 border-t border-neutral-800 pt-4">
        {isHost ? (
          <>
            {!canStart && selectedCount !== needed && (
              <p className="text-sm text-amber-400">
                Select exactly {needed} hero class{needed === 1 ? '' : 'es'} to continue.
              </p>
            )}
            {canStart && <p className="text-sm text-emerald-400">Ready to start!</p>}
            <button
              type="button"
              disabled={disabled || !canStart}
              onClick={onStart}
              className="ml-auto rounded-xl bg-emerald-500 px-8 py-2.5 font-semibold text-black shadow-lg transition hover:bg-emerald-400 disabled:opacity-40"
            >
              Start Game
            </button>
          </>
        ) : (
          <p className="text-sm text-neutral-500">Waiting for the host to start…</p>
        )}
      </div>
    </div>
  );
}

// ─── Setup-screen helpers ────────────────────────────────────────────────────

/** Compact title-only selector button used in the setup screen. Shows a
 *  floating hover-card with the full details (no click needed). */
function SetupChip({
  label, selected, disabled, tone, onClick, hoverContent,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  tone: 'rose' | 'violet' | 'red' | 'orange';
  onClick: () => void;
  hoverContent: React.ReactNode;
}) {
  const [hovered, setHovered] = useState<DOMRect | null>(null);
  // Selected colors per tone — match the section's accent.
  const selBorder =
    tone === 'rose'   ? 'border-rose-500 bg-rose-950/60 text-rose-100' :
    tone === 'violet' ? 'border-violet-500 bg-violet-950/60 text-violet-100' :
    tone === 'red'    ? 'border-red-600 bg-red-950/60 text-red-100' :
                        'border-orange-600 bg-orange-950/60 text-orange-100';
  const baseBorder = 'border-neutral-700 bg-neutral-800/50 text-neutral-300';

  // Position the hover card in viewport coords so it can render outside the
  // setup grid's overflow box. Card is ~270px wide × ~200px tall.
  const CARD_W = 320;
  const CARD_H = 220;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth  : 1920;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 1080;
  let hoverX = 0, hoverY = 0;
  if (hovered) {
    // Prefer below; flip above if it would overflow the bottom.
    const wantBelow = hovered.bottom + CARD_H + 8 <= viewportH;
    hoverY = wantBelow ? hovered.bottom + 8 : Math.max(8, hovered.top - CARD_H - 8);
    // Anchor horizontally to the chip's left, clamp to viewport.
    hoverX = Math.max(8, Math.min(viewportW - CARD_W - 8, hovered.left));
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onMouseEnter={e => setHovered(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setHovered(null)}
        onClick={onClick}
        className={[
          'rounded-lg border-2 px-2 py-2 text-center text-xs font-medium transition',
          selected ? selBorder : baseBorder,
          !disabled ? 'cursor-pointer hover:opacity-90' : 'cursor-default opacity-70',
        ].join(' ')}
      >
        {label}
      </button>
      {hovered && (
        <div
          className="pointer-events-none fixed z-[1000]"
          style={{ left: hoverX, top: hoverY, width: CARD_W }}
        >
          {hoverContent}
        </div>
      )}
    </>
  );
}

/** Hover preview for a mastermind in the setup screen. */
function MastermindHoverCard({ mm }: { mm: MastermindCardDef }) {
  const borderColor = '#DC143C';
  return (
    <div
      style={{ borderWidth: 2, borderColor }}
      className="rounded-lg border-solid bg-gradient-to-br from-red-950/80 to-neutral-950/90 p-3 shadow-2xl"
    >
      <div className="text-sm font-bold leading-tight text-white">{mm.name}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Mastermind
      </div>
      <div className="mt-1 text-[11px]">
        <span className="font-semibold" style={{ color: borderColor }}>Always Leads: </span>
        <span className="font-bold text-white">{teamDisplayName(mm.alwaysLeads)}</span>
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-neutral-300">
        <span>⚔ {mm.attack} attack</span>
        <span>✦ {mm.hits} hits</span>
        <span>{mm.vp} VP / tactic</span>
      </div>
      {mm.text && (() => {
        const colonIdx = mm.text.indexOf(':');
        const label = colonIdx > 0 ? mm.text.slice(0, colonIdx + 1) : '';
        const body  = colonIdx > 0 ? mm.text.slice(colonIdx + 1).trim() : mm.text;
        return (
          <div className="mt-2 text-[11px] leading-snug">
            {label && <span className="font-bold" style={{ color: borderColor }}>{label} </span>}
            <span className="text-neutral-200"><CardText text={body} /></span>
          </div>
        );
      })()}
    </div>
  );
}

/** Hover preview for a scheme in the setup screen. */
function SchemeHoverCard({ scheme }: { scheme: SchemeCardDef }) {
  const labelColor = '#a78bfa';
  return (
    <div className="rounded-lg border-2 border-solid border-violet-700/80 bg-gradient-to-br from-violet-950/80 to-neutral-950/90 p-3 shadow-2xl">
      <div className="text-sm font-bold leading-tight text-white">{scheme.name}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: labelColor }}>
        Scheme — {scheme.twists} Twists
      </div>
      {scheme.text && (
        <div className="mt-1.5 text-[11px] leading-snug">
          {scheme.text.split('\n').map((segment, i) => {
            const colonIdx = segment.indexOf(':');
            if (colonIdx > 0) {
              const label = segment.slice(0, colonIdx + 1);
              const body  = segment.slice(colonIdx + 1).trim();
              return (
                <div key={i} className="mb-0.5">
                  <span className="font-bold" style={{ color: labelColor }}>{label}</span>
                  {body && <span className="ml-0.5 text-neutral-200"><CardText text={body} /></span>}
                </div>
              );
            }
            return <div key={i} className="mb-0.5 text-neutral-200"><CardText text={segment} /></div>;
          })}
        </div>
      )}
    </div>
  );
}

/** Hover preview for a villain group — lists each villain with attack/VP. */
function VillainGroupHoverCard({ group }: { group: { groupId: string; team: string; cards: readonly { def: VillainCardDef; copies: number }[] } }) {
  const borderColor = '#dc2626';
  const totalCards = group.cards.reduce((s, c) => s + c.copies, 0);
  return (
    <div
      style={{ borderWidth: 2, borderColor }}
      className="rounded-lg border-solid bg-gradient-to-br from-red-950/80 to-neutral-950/90 p-3 shadow-2xl"
    >
      <div className="text-sm font-bold leading-tight text-white">{teamDisplayName(group.team)}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Villain Group — {totalCards} cards
      </div>
      <div className="mt-1.5 space-y-0.5">
        {group.cards.map(({ def, copies }) => (
          <div key={def.cardId} className="flex items-center justify-between gap-2 text-[10px] text-neutral-200">
            <span className="truncate">
              <span className="font-mono text-neutral-500">{copies}×</span> {def.name}
            </span>
            <span className="shrink-0 text-neutral-500">⚔{def.attack} · {def.vp}VP</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Hover preview for a henchman group — shows the (typically single) card. */
function HenchmanGroupHoverCard({ group }: { group: { groupId: string; team: string; cards: readonly { def: HenchmanCardDef; copies: number }[] } }) {
  const borderColor = '#ea580c';
  const totalCards = group.cards.reduce((s, c) => s + c.copies, 0);
  return (
    <div
      style={{ borderWidth: 2, borderColor }}
      className="rounded-lg border-solid bg-gradient-to-br from-orange-950/80 to-neutral-950/90 p-3 shadow-2xl"
    >
      <div className="text-sm font-bold leading-tight text-white">{teamDisplayName(group.team)}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: borderColor }}>
        Henchman Group — {totalCards} cards
      </div>
      <div className="mt-1.5 space-y-0.5">
        {group.cards.map(({ def, copies }) => (
          <div key={def.cardId} className="text-[10px] text-neutral-200">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="font-mono text-neutral-500">{copies}×</span> {def.name}
              </span>
              <span className="shrink-0 text-neutral-500">⚔{def.attack} · {def.vp}VP</span>
            </div>
            {def.text && (
              <div className="ml-3 mt-0.5 text-[10px] leading-snug text-neutral-400">
                <CardText text={def.text} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tiny section heading used inside LegendarySetup. */
function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500 ${className}`}>
      {children}
    </div>
  );
}
