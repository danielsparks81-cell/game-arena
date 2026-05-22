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

import { useEffect, useRef, useState } from 'react';
import { sounds } from '@/lib/sounds';
import {
  CARDS,
  getCard,
  HQ_SIZE,
  CITY_SIZE,
  SCHEMES,
  type CardId,
  type CardInstance,
  type HeroCardDef,
  type HeroClass,
  type LegendaryEvent,
  type LegendaryState,
  type PendingChoice,
  type PlayerState,
} from '@/lib/games/legendary';
import { SIDEKICK, OFFICER } from '@/lib/games/legendary/heroes/shield';
// Card render primitives. Extracted so the sandbox preview at
// /legendary-sandbox renders cards identically — no drift between author-time
// and play-time visuals.
import {
  CLASS_COLORS,
  CLASS_LABELS,
  ClassChips,
  CostBadge,
  HeroCardArt,
  TeamChip,
  classBorderStyle,
  isShieldStarter,
} from '@/components/legendary/HeroCardArt';
import {
  VillainCardArt,
  HenchmanCardArt,
  SystemCardArt,
} from '@/components/legendary/SystemCardArt';
import { CARD_COPIES } from '@/lib/games/legendary';

type Floater = { key: number; seat: number; sign: '+' | '-'; amount: number; tone: 'damage' | 'heal' };

type RevealAnim = {
  key: number;
  cardId: string;
  kind: 'villain' | 'henchman' | 'master_strike' | 'scheme_twist' | 'bystander';
  phase: 'entering' | 'showing' | 'exiting';
  /** Pixel offset from viewport center to destination (computed from DOM rects at trigger time). */
  exitX: number;
  exitY: number;
};

export default function LegendaryBoard({
  state, currentUserId, isHost, disabled,
  onStart, onPlay, onRecruit, onRecruitSidekick, onRecruitOfficer,
  onFightCity, onFightMastermind, onResolveChoice, onSkipChoice, onEndTurn,
  onRevealFirstVillain,
}: {
  state: LegendaryState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onStart: () => void;
  onPlay: (instanceId: string) => void;
  onRecruit: (slot: number) => void;
  onRecruitSidekick: () => void;
  onRecruitOfficer: () => void;
  onFightCity: (slot: number) => void;
  onFightMastermind: () => void;
  /** Resolve a pending ko_from_hand / discard_from_hand choice. */
  onResolveChoice: (instanceId: string) => void;
  /** Skip the pending choice (forfeit the bonus). */
  onSkipChoice: () => void;
  onEndTurn: () => void;
  /** Current player clicks "Game Begins" — reveals first villain via the engine. */
  onRevealFirstVillain?: () => void;
}) {
  const me = state.players.find(p => p.playerId === currentUserId);
  const mySeat = me?.seat ?? -1;
  const currentPlayer = state.players[state.currentPlayerIdx];
  const isMyTurn = state.phase === 'playing' && currentPlayer?.playerId === currentUserId;

  // Pending choice: the engine is waiting for the active player to pick a card
  // from their hand to KO or discard (from a card effect like Diving Block).
  const pendingChoice: PendingChoice | undefined = state.thisTurn.pendingChoice;
  const isChoiceMode = isMyTurn && !!pendingChoice;

  // ----- Lobby phase: setup-confirmation screen -----
  if (state.phase === 'lobby') {
    const mastermind = getCard(state.mastermindId);
    const scheme = getCard(state.schemeId);
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 text-center">
        <div className="text-xl font-semibold text-neutral-100">Setup</div>
        <div className="text-sm text-neutral-400">
          <div>Mastermind: <span className="font-medium text-rose-400">{mastermind.kind === 'mastermind' ? mastermind.name : '?'}</span></div>
          <div>Scheme: <span className="font-medium text-amber-400">{scheme.kind === 'scheme' ? scheme.name : '?'}</span></div>
          <div className="mt-1 text-xs text-neutral-500">
            Heroes: {state.heroClassIds.join(', ')}
          </div>
        </div>
        <div className="text-sm text-neutral-300">
          {state.players.length} player{state.players.length === 1 ? '' : 's'} ready
        </div>
        {isHost ? (
          <button
            type="button"
            disabled={disabled || state.players.length < 1}
            onClick={onStart}
            className="rounded-lg bg-emerald-500 px-6 py-2 font-medium text-black transition hover:bg-emerald-400 disabled:opacity-40"
          >
            Start Game
          </button>
        ) : (
          <div className="text-xs text-neutral-500">Waiting for the host to start…</div>
        )}
      </div>
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
  const mastermindRef = useRef<HTMLDivElement>(null); // mastermind zone (bystander fallback)

  const [revealAnim, setRevealAnim] = useState<RevealAnim | null>(null);
  // When handleStartAck fires the animation optimistically (immediate, from
  // the villain deck top card), this flag tells the log-watcher to skip the
  // matching villain_revealed event that arrives later from Supabase.
  const skipFirstVillainAnim = useRef(false);
  // startAcked: purely cosmetic — hides the "Game Begins" splash overlay.
  // The reveal animation is fully decoupled from this flag; it fires whenever
  // a new reveal event arrives in the log, regardless of overlay state.
  const [startAcked, setStartAcked] = useState(false);

  // Cursor initialised to the current log length so events that already exist
  // when the component mounts (lobby history) are never re-animated. Only log
  // entries that arrive AFTER mount trigger the reveal overlay.
  const lastRevealIdx = useRef(state.log.length);
  useEffect(() => {
    const start = lastRevealIdx.current;
    if (state.log.length <= start) {
      lastRevealIdx.current = state.log.length;
      return;
    }
    const fresh = state.log.slice(start);
    // Always advance — we never need to replay a reveal event.
    lastRevealIdx.current = state.log.length;

    let cardId = '';
    let kind: RevealAnim['kind'] | null = null;
    let bystanderDest: 'villain' | 'mastermind' = 'villain';
    // Scan newest-first so we animate the most-recent reveal in this batch.
    for (const ev of [...fresh].reverse()) {
      if (ev.kind === 'villain_revealed') {
        // Skip if we already fired an optimistic animation from handleStartAck.
        if (skipFirstVillainAnim.current) {
          skipFirstVillainAnim.current = false;
          break; // don't re-animate; the card is already flying to the city
        }
        cardId = ev.cardId;
        const def = getCard(ev.cardId);
        kind = def.kind === 'henchman' ? 'henchman' : 'villain';
        break;
      } else if (ev.kind === 'master_strike') {
        cardId = 'master_strike'; kind = 'master_strike'; break;
      } else if (ev.kind === 'scheme_twist') {
        cardId = 'scheme_twist';  kind = 'scheme_twist';  break;
      } else if (ev.kind === 'bystander_captured') {
        cardId = 'bystander'; kind = 'bystander';
        bystanderDest = ev.capturedBy; break;
      }
    }
    if (!kind) return;

    // Compute pixel-exact exit offset from viewport center → destination element.
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    const centerOf = (el: HTMLElement | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    let destEl: HTMLElement | null = null;
    if (kind === 'villain' || kind === 'henchman') destEl = sewersRef.current;
    else if (kind === 'master_strike')             destEl = strikesRef.current;
    else if (kind === 'scheme_twist')              destEl = schemeRef.current;
    else if (kind === 'bystander')                 destEl = bystanderDest === 'villain' ? sewersRef.current : mastermindRef.current;
    const dest = centerOf(destEl);
    const exitX = dest ? dest.x - cx : (kind === 'villain' || kind === 'henchman' ? 340 : kind === 'master_strike' ? -380 : -200);
    const exitY = dest ? dest.y - cy : (kind === 'villain' || kind === 'henchman' ?  50 : kind === 'master_strike' ?   60 : -160);

    // DO NOT return a cleanup here — the cleanup fires on every log change and
    // would cancel exit timers mid-animation. Keys keep stale callbacks no-ops.
    const key = Date.now();
    setRevealAnim({ key, cardId, kind, phase: 'entering', exitX, exitY });
    window.setTimeout(() =>
      setRevealAnim(a => a?.key === key ? { ...a, phase: 'showing' } : a), 50);
    window.setTimeout(() =>
      setRevealAnim(a => a?.key === key ? { ...a, phase: 'exiting' } : a), 2500);
    window.setTimeout(() =>
      setRevealAnim(a => a?.key === key ? null : a), 3500);
  }, [state.log]);

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
    if (nextCard) {
      const def = getCard(nextCard.cardId);
      if (def.kind === 'villain' || def.kind === 'henchman') {
        const kind: RevealAnim['kind'] = def.kind === 'henchman' ? 'henchman' : 'villain';
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        let exitX = 340, exitY = 50;
        const sewersEl = sewersRef.current;
        if (sewersEl) {
          const r = sewersEl.getBoundingClientRect();
          exitX = r.left + r.width / 2 - cx;
          exitY = r.top  + r.height / 2 - cy;
        }
        const key = Date.now();
        setRevealAnim({ key, cardId: nextCard.cardId, kind, phase: 'entering', exitX, exitY });
        window.setTimeout(() =>
          setRevealAnim(a => a?.key === key ? { ...a, phase: 'showing' } : a), 50);
        window.setTimeout(() =>
          setRevealAnim(a => a?.key === key ? { ...a, phase: 'exiting' } : a), 2500);
        window.setTimeout(() =>
          setRevealAnim(a => a?.key === key ? null : a), 3500);
        skipFirstVillainAnim.current = true;
      }
    }

    onRevealFirstVillain?.();
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

  const handlePlayAll = () => {
    if (!me || !isMyTurn || disabled) return;
    for (const card of me.hand) {
      if (isPlayable(card.cardId)) onPlay(card.instanceId);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      {state.phase === 'finished' && (
        <div className="text-center text-sm text-neutral-300">{banner}</div>
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
          <div className="col-span-1 flex h-40 flex-col">
            <PileDisplay
              label="KO"
              count={state.ko.length}
              tone="neutral"
              fill
              pileStyle={{ borderColor: '#404040', background: 'linear-gradient(135deg,rgba(40,40,40,.6),rgba(20,20,20,.6))' }}
            />
          </div>
          <div className="col-span-10 grid grid-cols-5 gap-2">
            {/* Escape — directly above Bridge city slot */}
            <div className="col-span-1 flex h-40 flex-col">
              <PileDisplay
                label="Escape"
                count={state.escapedPile.length}
                topCardLabel={state.escapedPile.length > 0 ? labelOf(state.escapedPile[state.escapedPile.length - 1]) : '—'}
                tone="rose"
                fill
              />
            </div>
            {/* Scheme — spans 2 city-slot widths. ref used for animation targeting. */}
            <div className="col-span-2 h-40" ref={schemeRef}>
              <SchemeZone schemeDef={schemeDef} twistsRevealed={state.schemeTwistsRevealed} />
            </div>
            {/* Mastermind — spans 2 city-slot widths */}
            <div className="col-span-2 h-40" ref={mastermindRef}>
              <MastermindZone
                mmDef={mmDef}
                tacticsLeft={state.mastermind.tactics?.length ?? 0}
                attack={state.thisTurn.attack}
                isMyTurn={isMyTurn}
                disabled={disabled || state.phase === 'finished'}
                onFight={onFightMastermind}
              />
            </div>
          </div>
          {/* Wounds + Bystanders — right of Mastermind, aligned with Villain/Hero Deck column */}
          <div className="col-span-1 flex h-40 flex-col gap-1">
            <PileDisplay label="Wounds"     count={state.woundDeck.length}      tone="neutral" fill
              pileStyle={{ borderColor: '#7a3030', background: 'linear-gradient(135deg,rgba(107,37,37,.45),rgba(90,30,30,.45))' }} />
            <PileDisplay label="Bystanders" count={totalBystanders} tone="amber" fill infinite
              pileStyle={{ borderColor: '#c4a800', background: 'linear-gradient(135deg,rgba(196,168,0,.3),rgba(160,134,0,.3))' }} />
          </div>
        </div>

        {/* ---- Row 3: City row ---- */}
        {/* Left col: Twists + Strikes stacked. City renders slot4→0 (escape on left,
            entry on right next to Villain Deck). Villain Deck is full card height. */}
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-1 flex h-40 flex-col gap-1">
            <PileDisplay
              label="Twists"
              count={state.schemeTwistsRevealed}
              total={schemeIsScheme ? schemeDef.twists : undefined}
              tone="amber"
              fill
              pileStyle={{ borderColor: '#4a2880', background: 'linear-gradient(135deg,rgba(58,32,104,.45),rgba(45,24,85,.45))' }}
            />
            <div ref={strikesRef} className="flex flex-1 min-h-0 flex-col">
              <PileDisplay label="Strikes" count={strikesPlayed} tone="rose" fill
                pileStyle={{ borderColor: '#8a5800', background: 'linear-gradient(135deg,rgba(122,72,0,.45),rgba(92,54,0,.45))' }} />
            </div>
          </div>
          {/* City slots rendered right-to-left: Bridge(escape) on left, Sewers(entry) on right */}
          <div className="col-span-10 grid grid-cols-5 gap-2">
            {([4, 3, 2, 1, 0] as const).map((slot) => {
              const card = state.city[slot];
              return (
                <div key={slot} ref={slot === 0 ? sewersRef : null} className="flex flex-col gap-0.5">
                  <CitySlot
                    card={card}
                    slot={slot}
                    isLast={slot === CITY_SIZE - 1}
                    attack={state.thisTurn.attack}
                    disabled={!isMyTurn || disabled || state.phase === 'finished'}
                    onFight={() => onFightCity(slot)}
                    attachedBystanders={card ? state.cityBystanders[card.instanceId]?.length ?? 0 : 0}
                  />
                  <div className="text-center text-[9px] uppercase tracking-wider text-neutral-200">
                    {CITY_LOCATIONS[slot]}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Villain Deck — full card height (h-40) */}
          <div className="col-span-1 flex h-40 flex-col">
            <PileDisplay label="Villain Deck" count={state.villainDeck.length} tone="rose" backFace fill />
          </div>
        </div>

        {/* ---- Row 4: HQ row ---- */}
        {/* Left col: Sidekicks + Officers stacked (each half of h-40). Hero Deck full card height. */}
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-1 flex h-40 flex-col gap-1">
            <PileDisplay label={SIDEKICK.cardName} count={0} tone="neutral" fill infinite cost={SIDEKICK.cost} hoverDef={SIDEKICK}
              canAfford={isMyTurn && !disabled && state.thisTurn.recruit >= SIDEKICK.cost && !state.thisTurn.sidekickRecruited}
              onClick={isMyTurn && !disabled && !state.thisTurn.sidekickRecruited ? onRecruitSidekick : undefined}
              pileStyle={{ borderColor: '#909090', background: 'linear-gradient(135deg,#7a7a7a,#686868)' }} />
            <PileDisplay label={OFFICER.cardName} count={0} tone="neutral" fill infinite cost={OFFICER.cost} hoverDef={OFFICER} hoverLightBg
              canAfford={isMyTurn && !disabled && state.thisTurn.recruit >= OFFICER.cost}
              onClick={isMyTurn && !disabled ? onRecruitOfficer : undefined}
              pileStyle={{ borderColor: '#909090', background: 'linear-gradient(135deg,#7a7a7a,#686868)' }} />
          </div>
          <div className="col-span-10">
            <div className="grid grid-cols-5 gap-2">
              {state.hq.map((card, slot) => (
                <HQSlot
                  key={slot}
                  card={card}
                  slot={slot}
                  recruit={state.thisTurn.recruit}
                  disabled={!isMyTurn || disabled || state.phase === 'finished'}
                  onRecruit={() => onRecruit(slot)}
                  refillAnim={animatingHqSlots.has(slot)}
                />
              ))}
            </div>
          </div>
          {/* Hero Deck — full card height (h-40) */}
          <div className="col-span-1 flex h-40 flex-col">
            <PileDisplay label="Hero Deck" count={state.heroDeck.length} tone="emerald" backFace fill />
          </div>
        </div>
      </div>

      {/* ============================================================
          PLAYER UI — below the playmat. Resources, hand, end turn,
          log, players. Personal to the viewer.
          ============================================================ */}

      {/* Resource bar + played strip + action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm">
        {/* Left: player info boxes + Strike/Recruit pips */}
        <div className="flex items-center gap-3">
          {me && (
            <>
              <PlayerBox label="Deck"    value={me.deck.length}    shade="emerald" backFace />
              <PlayerBox label="Discard" value={me.discard.length} shade="emerald" backFace />
              <PlayerBox label="VP"      value={me.vp}             shade="rose"    />
            </>
          )}
          <div className="mx-1 h-8 w-px bg-neutral-800" />
          <ResourcePip label="Strike"  value={state.thisTurn.attack}  color="rose"    />
          <ResourcePip label="Recruit" value={state.thisTurn.recruit} color="emerald" />
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-white shrink-0">Played</span>
          <div className="flex flex-wrap gap-1">
            {state.thisTurn.playedThisTurn.length === 0 ? (
              <span className="text-xs text-neutral-600">—</span>
            ) : (
              state.thisTurn.playedThisTurn.map((c, i) => (
                <div key={c.instanceId + i} className="h-5 rounded bg-neutral-800 px-1.5 text-[10px] leading-5 text-neutral-300">
                  {labelOf(c)}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white font-medium">Turn {state.turn}</span>
          {me && state.phase === 'playing' && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={!isMyTurn || disabled || isChoiceMode || !me.hand.some(c => isPlayable(c.cardId))}
                onClick={handlePlayAll}
                className="rounded border border-neutral-700 bg-neutral-800 px-4 py-1 text-xs font-medium text-neutral-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Play All
              </button>
              <button
                type="button"
                disabled={!isMyTurn || disabled || isChoiceMode}
                onClick={onEndTurn}
                className="rounded border border-rose-800 bg-rose-950 px-4 py-1 text-xs font-medium text-rose-200 transition hover:border-rose-500 hover:bg-rose-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                End Turn
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pending-choice banner — shown when a card effect needs the player to
          pick a card from their hand to KO or discard. */}
      {pendingChoice && (
        <div className="rounded-lg border border-amber-500 bg-amber-950/50 px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-sm font-semibold text-amber-300">
                {pendingChoice.kind === 'ko_from_hand' ? '🗑️ KO a card from your hand' : '↩️ Discard a card from your hand'}
              </span>
              {pendingChoice.filter === 'wounds_only' && (
                <span className="ml-2 text-xs text-amber-400">(Wound cards only)</span>
              )}
              {pendingChoice.bonus.length > 0 && (
                <span className="ml-2 text-xs text-neutral-400">
                  {isMyTurn ? '— click a card below, or skip to forfeit the bonus.' : ''}
                </span>
              )}
            </div>
            {isMyTurn && (
              <button
                type="button"
                disabled={disabled}
                onClick={onSkipChoice}
                className="shrink-0 rounded border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-400 hover:text-white disabled:opacity-40"
              >
                Skip
              </button>
            )}
          </div>
        </div>
      )}

      {/* Your hand */}
      <ZoneLabel>{isChoiceMode ? 'Choose a card to ' + (pendingChoice!.kind === 'ko_from_hand' ? 'KO' : 'discard') : 'Your hand'}</ZoneLabel>
      <div className="flex flex-wrap items-stretch justify-center gap-2 min-h-[140px]">
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
                if (isChoiceMode) {
                  const valid = isChoiceTarget(card.cardId, pendingChoice!);
                  return (
                    <HandCard
                      key={card.instanceId}
                      card={card}
                      disabled={!valid || disabled}
                      choiceMode={valid ? pendingChoice!.kind : undefined}
                      onClick={() => onResolveChoice(card.instanceId)}
                    />
                  );
                }
                return (
                  <HandCard
                    key={card.instanceId}
                    card={card}
                    disabled={!isMyTurn || disabled || state.phase === 'finished' || !isPlayable(card.cardId)}
                    onClick={() => onPlay(card.instanceId)}
                  />
                );
              })
          )
        ) : (
          <div className="text-xs text-neutral-600">Spectating</div>
        )}
      </div>

      {/* Discard zone — shown in choice mode when the effect allows picking
          from the discard pile (e.g. Dangerous Rescue: hand OR discard). */}
      {isChoiceMode && pendingChoice!.sources?.includes('discard') && me && (
        <>
          <ZoneLabel>Your discard pile — choose a card to KO</ZoneLabel>
          <div className="flex flex-wrap items-stretch justify-center gap-2 min-h-[100px]">
            {me.discard.length === 0 ? (
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
                      disabled={!valid || disabled}
                      choiceMode={valid ? pendingChoice!.kind : undefined}
                      onClick={() => onResolveChoice(card.instanceId)}
                    />
                  );
                })
            )}
          </div>
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
                <div key={i} className={logColor(ev, mySeat)}>{logText(ev)}</div>
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ZoneLabel({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 text-[10px] uppercase tracking-wider text-neutral-500">{children}</div>;
}

function CitySlot({
  card, slot, isLast, attack, disabled, onFight, attachedBystanders,
}: {
  card: CardInstance | null;
  slot: number;
  isLast: boolean;
  attack: number;
  disabled: boolean;
  onFight: () => void;
  attachedBystanders: number;
}) {
  if (!card) {
    return (
      <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 text-[11px] text-neutral-600">
        <span>empty</span>
      </div>
    );
  }
  const def = getCard(card.cardId);
  if (def.kind !== 'villain' && def.kind !== 'henchman') {
    return <div className="h-40 rounded-lg bg-neutral-900" />;
  }
  const canFight = !disabled && attack >= def.attack;
  return (
    <button
      type="button"
      disabled={!canFight}
      onClick={onFight}
      className={`rounded-lg transition-all duration-150 ${
        canFight
          ? '-translate-y-3 shadow-lg ring-2 ring-rose-700 hover:-translate-y-4 hover:shadow-xl hover:ring-emerald-400'
          : ''
      }`}
    >
      {def.kind === 'villain'
        ? <VillainCardArt  def={def} wide attachedBystanders={attachedBystanders} />
        : <HenchmanCardArt def={def} wide attachedBystanders={attachedBystanders} />
      }
      <span className="sr-only">Slot {slot}</span>
    </button>
  );
}

function HQSlot({
  card, slot, recruit, disabled, onRecruit, refillAnim = false,
}: {
  card: CardInstance | null;
  slot: number;
  recruit: number;
  disabled: boolean;
  onRecruit: () => void;
  /** When true the card plays a flip-in animation (just placed from the Hero Deck). */
  refillAnim?: boolean;
}) {
  if (!card) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-neutral-800 text-[11px] text-neutral-600">
        empty
      </div>
    );
  }
  const def = getCard(card.cardId);
  if (def.kind !== 'hero') return <div className="h-40 rounded-lg bg-neutral-900" />;
  const canAfford = !disabled && recruit >= def.cost;
  const copies = CARD_COPIES[card.cardId];
  return (
    <button
      type="button"
      disabled={!canAfford}
      onClick={onRecruit}
      className={[
        'transition-all duration-150',
        refillAnim ? 'animate-hq-flip-in' : '',
        canAfford ? '-translate-y-3 shadow-lg hover:-translate-y-4 hover:shadow-xl' : 'opacity-60',
      ].join(' ')}
    >
      <HeroCardArt def={def} wide height="h-40" copies={copies} />
      <span className="sr-only">Slot {slot}</span>
    </button>
  );
}

function HandCard({
  card, disabled, onClick, choiceMode,
}: {
  card: CardInstance;
  disabled: boolean;
  onClick: () => void;
  /** When set the card is highlighted as a KO/discard target. */
  choiceMode?: 'ko_from_hand' | 'discard_from_hand';
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
        choiceMode === 'ko_from_hand'      ? 'ring-2 ring-rose-500 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
        choiceMode === 'discard_from_hand' ? 'ring-2 ring-amber-400 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
        '';
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          className={`transition ${systemChoiceRing || (disabled ? 'cursor-default opacity-80' : 'hover:-translate-y-1 hover:shadow-lg')}`}
        >
          {isWound
            ? <SystemCardArt name="Wound"     borderColor="#7a3030" bg="linear-gradient(135deg, #6b2525, #5a1e1e)"   height="h-40" />
            : <SystemCardArt name="Bystander" borderColor="#c4a800" bg="linear-gradient(135deg, #c4a800, #a08600)"   height="h-40" vp={1} />
          }
        </button>
      );
    }
    return (
      <div className="flex h-40 w-[220px] flex-col items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 opacity-60 text-[11px] text-neutral-500">
        Unknown card
      </div>
    );
  }
  const copies = CARD_COPIES[card.cardId];
  // SHIELD starters + Officer all share the agent grey tint.
  const SHIELD_CARD_IDS = ['shield_trooper', 'shield_agent', 'shield_officer'];
  const shieldStyle: React.CSSProperties | undefined = SHIELD_CARD_IDS.includes(card.cardId)
    ? { background: 'linear-gradient(135deg, #7a7a7a, #686868)' }
    : undefined;
  // Choice-mode ring: red for KO, amber for discard.
  const choiceRing =
    choiceMode === 'ko_from_hand'      ? 'ring-2 ring-rose-500 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
    choiceMode === 'discard_from_hand' ? 'ring-2 ring-amber-400 -translate-y-2 shadow-lg hover:-translate-y-3 hover:shadow-xl' :
    '';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={def.text}
      className={`transition ${choiceRing || (disabled ? 'opacity-50' : 'hover:-translate-y-1 hover:shadow-lg')}`}
    >
      <HeroCardArt def={def} copies={copies} style={shieldStyle} lightBg={!!shieldStyle} />
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
// 'sidekick' is NOT a shield-officer variant but gets the same grey tint in hand + hover preview.
const SHIELD_IDS = ['shield_trooper', 'shield_agent', 'shield_officer', 'sidekick'];

function PileDisplay({
  label, count, total, topCardLabel, tone = 'neutral', backFace = false, compact = false,
  square = false, fill = false, pileStyle, infinite = false,
  cost, hoverDef, hoverLightBg = false, onClick, canAfford = false,
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
  /** Card to preview on hover — shown to the right of the pile. */
  hoverDef?: HeroCardDef;
  hoverLightBg?: boolean;
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
      {...(onClick ? { type: 'button' as const, onClick, disabled: !canAfford } : {})}
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
      {/* Hover card preview — lives OUTSIDE the dimmed content div so it
          always renders at full opacity regardless of canAfford state. */}
      {hoverDef && (
        <div className="pointer-events-none absolute left-full top-0 z-[200] ml-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <HeroCardArt
            def={hoverDef}
            style={SHIELD_IDS.includes(hoverDef.cardId) ? SHIELD_GREY_STYLE : undefined}
            lightBg={hoverLightBg || SHIELD_IDS.includes(hoverDef.cardId)}
          />
        </div>
      )}
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
  if (schemeDef.kind !== 'scheme') {
    return <div className="h-full rounded-lg border border-dashed border-neutral-800" />;
  }
  return (
    <div
      className="flex h-full flex-col rounded-lg border-2 border-solid border-violet-700/70 bg-gradient-to-br from-violet-950/40 to-neutral-950/40 px-2 py-1"
      title={schemeDef.text}
    >
      <span className="text-[9px] uppercase tracking-wider text-violet-400">Scheme</span>
      <span className="truncate text-[11px] font-semibold text-neutral-100">{schemeDef.name}</span>
      <div className="mt-auto flex gap-0.5">
        {Array.from({ length: schemeDef.twists }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded ${i < twistsRevealed ? 'bg-violet-500' : 'bg-neutral-800'}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Mastermind card — the boss. Clickable to attempt a fight. Tactics rendered
 *  as a row of pips: filled = taken, empty = still face-down beneath the boss. */
function MastermindZone({
  mmDef, tacticsLeft, attack, isMyTurn, disabled, onFight,
}: {
  mmDef: ReturnType<typeof getCard>;
  /** How many Tactic cards are still face-down (= hits left to win). */
  tacticsLeft: number;
  attack: number;
  isMyTurn: boolean;
  disabled: boolean;
  onFight: () => void;
}) {
  if (mmDef.kind !== 'mastermind') {
    return <div className="h-full rounded-lg border border-dashed border-neutral-800" />;
  }
  const totalTactics = mmDef.hits; // hits = tactic count on the card def
  const tacticsTaken = totalTactics - tacticsLeft;
  const canHit = isMyTurn && !disabled && attack >= mmDef.attack && tacticsLeft > 0;
  return (
    <button
      type="button"
      disabled={!canHit}
      onClick={onFight}
      title={mmDef.text}
      className={`flex h-full w-full flex-col items-stretch rounded-lg border-2 bg-gradient-to-br from-rose-950 to-neutral-950 px-2 py-1 text-left transition ${
        canHit ? 'border-rose-500 hover:-translate-y-0.5 hover:shadow-lg' : 'border-rose-900/70 opacity-90'
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-wider text-rose-400">Mastermind</span>
        <span className="font-mono text-[9px] text-neutral-400">{mmDef.attack}⚔</span>
      </div>
      <span className="truncate text-sm font-semibold text-neutral-100">{mmDef.name}</span>
      <div className="mt-auto">
        <div className="mb-0.5 text-[8px] uppercase tracking-wider text-neutral-500">
          {tacticsLeft}/{totalTactics} tactics
        </div>
        <div className="flex gap-0.5">
          {Array.from({ length: totalTactics }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded ${i < tacticsTaken ? 'bg-rose-500' : 'bg-neutral-800'}`}
            />
          ))}
        </div>
      </div>
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
  if (anim.kind === 'master_strike') {
    return (
      <SystemCardArt
        name="Master Strike"
        borderColor="#c45000"
        bg="linear-gradient(135deg, #8a3800, #6a2c00)"
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

  // Exit destination — pixel offset recorded at animation-trigger time from
  // real DOM getBoundingClientRect, so the card lands on the actual target element.
  const exitTranslate = `translate(${anim.exitX}px, ${anim.exitY}px)`;

  // Inner transform: flip + scale
  const innerTransform = (() => {
    switch (anim.phase) {
      case 'entering': return 'perspective(800px) rotateY(90deg) scale(0.05)';
      case 'showing':  return 'perspective(800px) rotateY(0deg) scale(1.5)';
      case 'exiting':  return 'perspective(800px) rotateY(0deg) scale(0.35)';
    }
  })();

  const label = (() => {
    switch (anim.kind) {
      case 'villain':       return 'Villain Revealed';
      case 'henchman':      return 'Henchman Revealed';
      case 'master_strike': return 'Master Strike!';
      case 'scheme_twist':  return 'Scheme Twist!';
      case 'bystander':     return 'Bystander Captured!';
    }
  })();

  const labelColor = anim.kind === 'master_strike'
    ? '#fb923c'
    : anim.kind === 'scheme_twist'
    ? '#c084fc'
    : anim.kind === 'bystander'
    ? '#fcd34d'
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

      {/* Outer wrapper handles the exit translation */}
      <div
        className="relative z-10"
        style={{
          transform: isExiting ? exitTranslate : 'translate(0,0)',
          transition: isExiting ? 'transform 900ms cubic-bezier(0.4,0,1,1)' : 'none',
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
  if (choice.filter === 'wounds_only') return cardId === 'wound';
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
