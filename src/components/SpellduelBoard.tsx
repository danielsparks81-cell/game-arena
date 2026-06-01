'use client';

import { useEffect, useRef, useState } from 'react';
import { sounds } from '@/lib/sounds';
import {
  CARDS,
  MAX_MANA,
  STARTING_HP,
  DRAFT_ROUNDS,
  eventText,
  eventSeat,
  type CardId,
  type DraftSeatState,
  type PlayerState,
  type ResolvedTarget,
  type SDEvent,
  type SDState,
  type Seat,
  type TargetSpec,
} from '@/lib/games/spellduel';

// One transient "floater" rendered on a player panel (e.g. -2 in red,
// +3 in green). The `key` is unique per spawn so React re-mounts the
// element and the CSS animation replays even if the same amount fires twice.
type Floater = { key: number; seat: Seat; sign: '-' | '+'; amount: number; tone: 'damage' | 'heal' | 'pay' };

/**
 * Spellduel board.
 *
 * Layout (top-down):
 *   • Opponent's stats panel + hidden-hand row (just card backs)
 *   • Center: shared log (most recent ~6 lines) + turn indicator
 *   • Your stats panel + clickable hand
 *   • End-turn button anchored bottom-right
 *
 * Effects and triggers all resolve server-side; this component just reads
 * `state` and dispatches { kind: 'play', cardIdx } or { kind: 'end_turn' }.
 * The "can I play this?" check is duplicated client-side so disabled cards
 * grey out immediately instead of round-tripping just to surface an error.
 */
export default function SpellduelBoard({
  state, currentUserId, disabled, onDraftPick, onPlay, onReact, onPassReaction, onEndTurn,
}: {
  state: SDState;
  currentUserId: string;
  disabled: boolean;
  /** Pre-duel: take an offered card into your deck. */
  onDraftPick: (cardId: CardId) => void;
  /** Targets is omitted for cards that have no `targets[]` spec. */
  onPlay: (cardIdx: number, targets?: ResolvedTarget[]) => void;
  /** Play a reaction card (by hand index) into the open reaction window. */
  onReact: (cardIdx: number) => void;
  /** Decline to react; let the pending spell resolve. */
  onPassReaction: () => void;
  onEndTurn: () => void;
}) {
  const mySeat: Seat | null =
    state.seats.A === currentUserId ? 'A' :
    state.seats.B === currentUserId ? 'B' : null;

  // Pre-duel draft screen takes over the whole board while building decks.
  if (state.phase === 'drafting' && state.draft) {
    const oppSeat: Seat = mySeat === 'A' ? 'B' : 'A';
    return (
      <DraftScreen
        mine={mySeat ? state.draft[mySeat] : null}
        oppProgress={state.draft[oppSeat]}
        oppName={state.players[oppSeat]?.username ?? 'Opponent'}
        disabled={disabled}
        onPick={onDraftPick}
      />
    );
  }

  // While a player is picking targets for a card we hold all of:
  //   - which hand index they clicked
  //   - the card's TargetSpec[] (so we know what to prompt for next)
  //   - the ResolvedTarget[] they've picked so far
  // The picker overlay reads this and either advances or fires onPlay.
  const [targeting, setTargeting] = useState<{
    cardIdx: number;
    specs: TargetSpec[];
    chosen: ResolvedTarget[];
  } | null>(null);

  // Reset targeting if the underlying state changed in a way that invalidates
  // it (e.g. turn ended, card no longer at that index, opponent dropped). The
  // simplest heuristic: cancel any time it's not our turn.
  const stillMyTurn = state.phase === 'playing' && state.currentSeat === mySeat;
  if (targeting && !stillMyTurn) {
    // Defer to next tick to avoid setState-in-render; cheap to call here.
    queueMicrotask(() => setTargeting(null));
  }

  // ---------------------------------------------------------------------
  // Event-diff: every time state.log grows, find the new SDEvents and use
  // them to drive sounds, hit/heal panel pulses, and floating numbers.
  // The structured events from Phase 1 make this clean — we just pattern-
  // match on kind. Adding a new event type means adding one case below.
  // ---------------------------------------------------------------------
  const lastSeenIdx = useRef(state.log.length);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [hitKey,  setHitKey]  = useState<{ A: number; B: number }>({ A: 0, B: 0 });
  const [healKey, setHealKey] = useState<{ A: number; B: number }>({ A: 0, B: 0 });

  useEffect(() => {
    const start = lastSeenIdx.current;
    if (state.log.length <= start) {
      // Either no change, or the log got TRIMMED (slice -25 in trimLog) so it
      // shrank. In the shrink case we just snap our cursor back; the new
      // events that ARE here have already been "seen" because we'd rendered
      // them previously.
      lastSeenIdx.current = state.log.length;
      return;
    }
    const fresh = state.log.slice(start);
    lastSeenIdx.current = state.log.length;

    const newFloaters: Floater[] = [];
    let keyBase = Date.now();
    // Collect which seats need a hit/heal pulse this batch; we apply each
    // via functional updates so we don't need hitKey/healKey in the deps.
    const hitSeats:  Seat[] = [];
    const healSeats: Seat[] = [];

    for (const ev of fresh) {
      switch (ev.kind) {
        case 'card_play':        sounds.sdCardPlay();      break;
        case 'damage':
          sounds.sdDamage();
          newFloaters.push({ key: keyBase++, seat: ev.to, sign: '-', amount: ev.amount, tone: 'damage' });
          hitSeats.push(ev.to);
          break;
        case 'damage_prevented':
          sounds.sdCounter();
          newFloaters.push({ key: keyBase++, seat: ev.to, sign: '+', amount: 0, tone: 'damage' });
          // No HP pulse — the damage didn't actually land.
          break;
        case 'heal':
          sounds.sdHeal();
          newFloaters.push({ key: keyBase++, seat: ev.seat, sign: '+', amount: ev.amount, tone: 'heal' });
          healSeats.push(ev.seat);
          break;
        case 'draw':             sounds.sdDraw();          break;
        case 'gain_mana':        sounds.sdMana();          break;
        case 'pay_hp':
          sounds.sdPayHp();
          newFloaters.push({ key: keyBase++, seat: ev.seat, sign: '-', amount: ev.amount, tone: 'pay' });
          hitSeats.push(ev.seat);
          break;
        case 'trigger_armed':    sounds.sdTriggerArmed();  break;
        case 'reaction_window':  sounds.sdTriggerArmed();  break;
        case 'countered':        sounds.sdCounter();       break;
        case 'reflected':        sounds.sdCounter();       break;
        case 'game_ended':
          if (ev.winner === mySeat)         sounds.win();
          else if (ev.winner !== 'draw')    sounds.sdLose();
          break;
        // 'turn_started', 'system', 'force_discard' are intentionally silent
        // for now — extend the switch when those events get sound design.
        default: break;
      }
    }

    if (hitSeats.length > 0) {
      setHitKey(prev => {
        const next = { ...prev };
        for (const s of hitSeats) next[s] = keyBase++;
        return next;
      });
    }
    if (healSeats.length > 0) {
      setHealKey(prev => {
        const next = { ...prev };
        for (const s of healSeats) next[s] = keyBase++;
        return next;
      });
    }
    if (newFloaters.length > 0) {
      setFloaters(prev => [...prev, ...newFloaters]);
      const ids = new Set(newFloaters.map(f => f.key));
      window.setTimeout(() => {
        setFloaters(prev => prev.filter(f => !ids.has(f.key)));
      }, 900);
    }
  }, [state.log, mySeat]);

  // Spectator fallback — render seat A perspective on top, seat B on bottom.
  const meSeat: Seat = mySeat ?? 'B';
  const oppSeat: Seat = meSeat === 'A' ? 'B' : 'A';

  const me  = state.players[meSeat];
  const opp = state.players[oppSeat];

  const isMyTurn = state.phase === 'playing' && state.currentSeat === meSeat && !!mySeat;
  const matchOver = state.phase === 'finished';

  // Reaction window: the engine paused a spell mid-cast and it's my turn to
  // respond. Compute which of my cards can legally answer it so the prompt can
  // offer them (and grey out the rest).
  const pr = state.pendingReaction;
  const reactionForMe = !!pr && !!mySeat && pr.reactorSeat === mySeat;
  const pendingCard = pr ? CARDS[pr.cardId] : null;
  const pendingDealsDamage = pendingCard
    ? pendingCard.effects.some(e => e.kind === 'damage' || e.kind === 'burn')
      || pendingCard.dynamic === 'combo' || pendingCard.dynamic === 'last_gasp'
    : false;
  const myReactionOptions = reactionForMe
    ? me.hand.flatMap((cardId, idx) => {
        const c = CARDS[cardId];
        if (!c?.isReaction) return [];
        const affordable = (me.mana + me.manaBonusThisTurn) >= c.cost;
        const eligible = c.reactionType !== 'reflect' || pendingDealsDamage;
        return [{ idx, cardId, card: c, affordable, eligible }];
      })
    : [];

  let banner = '';
  if (matchOver) {
    if (state.winner === meSeat) banner = '🏆 You won the duel!';
    else if (state.winner === oppSeat) banner = '💀 You were defeated.';
    else banner = 'Duel ended.';
  } else if (state.phase === 'lobby') {
    banner = 'Waiting for an opponent…';
  } else if (pr) {
    // A spell is paused mid-cast awaiting a reaction.
    if (reactionForMe) banner = `${opp.username} is casting ${pendingCard?.name ?? 'a spell'} — react or let it resolve`;
    else if (mySeat) banner = `Casting ${pendingCard?.name ?? 'your spell'} — waiting on ${opp.username}…`;
    else banner = `${state.players[pr.casterSeat].username} casts ${pendingCard?.name ?? 'a spell'} — ${state.players[pr.reactorSeat].username} may react`;
  } else if (!mySeat) {
    banner = `Spectating — ${state.players[state.currentSeat].username}'s turn`;
  } else {
    banner = isMyTurn ? 'Your turn — play cards, then end turn' : `${opp.username}'s turn`;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      {/* Banner */}
      <div className="text-center text-sm text-neutral-300">{banner}</div>

      {/* Opponent panel */}
      <PlayerPanel
        p={opp}
        isActive={state.phase === 'playing' && state.currentSeat === oppSeat}
        isYou={false}
        hitKey={hitKey[oppSeat]}
        healKey={healKey[oppSeat]}
        floaters={floaters.filter(f => f.seat === oppSeat)}
      />

      {/* Opponent's hand — card backs only */}
      <div className="flex min-h-[44px] items-center justify-center gap-1">
        {opp.hand.length === 0 ? (
          <span className="text-xs text-neutral-600">empty hand</span>
        ) : (
          opp.hand.map((_, i) => <CardBack key={i} />)
        )}
      </div>

      {/* Center: shared log */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500">
          <span>Recent</span>
          <span>turn {state.turn}</span>
        </div>
        <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-snug">
          {state.log.length === 0 ? (
            <div className="text-neutral-600">No actions yet.</div>
          ) : (
            state.log.slice(-8).map((ev, i) => {
              const s = eventSeat(ev);
              const color =
                s === 'system' ? 'text-neutral-500'
                : s === meSeat  ? 'text-emerald-300'
                : 'text-rose-300';
              return (
                <div key={i} className={color}>
                  {eventText(ev, mySeat)}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Your panel */}
      <PlayerPanel
        p={me}
        isActive={isMyTurn}
        isYou={true}
        hitKey={hitKey[meSeat]}
        healKey={healKey[meSeat]}
        floaters={floaters.filter(f => f.seat === meSeat)}
      />

      {/* Your hand — clickable */}
      <div className="flex flex-wrap items-stretch justify-center gap-2 pt-1">
        {me.hand.length === 0 ? (
          <div className="text-xs text-neutral-600">empty hand</div>
        ) : (
          me.hand.map((cardId, idx) => {
            const card = CARDS[cardId];
            // Spectators (and any unexpected leak of the HIDDEN_CARD sentinel)
            // see a face-down card — never an exception trying to read .cost.
            if (!card) {
              return <CardBack key={idx} large />;
            }
            const effMana = me.mana + me.manaBonusThisTurn;
            const canAfford = effMana >= card.cost;
            const cardDisabled = disabled || !mySeat || !isMyTurn || !canAfford || matchOver || !!targeting || !!pr;
            return (
              <Card
                key={idx}
                cardId={cardId}
                disabled={cardDisabled}
                onClick={() => {
                  // Card with no targets — play immediately.
                  if (!card.targets || card.targets.length === 0) {
                    onPlay(idx);
                    return;
                  }
                  // Card needs targets — enter the picker.
                  setTargeting({ cardIdx: idx, specs: card.targets, chosen: [] });
                }}
              />
            );
          })
        )}
      </div>

      {/* End turn */}
      {mySeat && !matchOver && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            disabled={disabled || !isMyTurn || !!targeting || !!pr}
            onClick={onEndTurn}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            End turn
          </button>
        </div>
      )}

      {/* Reaction overlay — shown to the reactor while a spell is paused. */}
      {reactionForMe && pr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-amber-500/60 bg-neutral-900 p-5 shadow-xl">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-amber-400">Reaction window</div>
            <div className="mb-3 text-sm text-neutral-200">
              <span className="font-medium text-rose-300">{opp.username}</span> is casting{' '}
              <span className="font-medium text-white">{pendingCard?.name ?? 'a spell'}</span>. Respond with a
              reaction, or let it resolve.
            </div>
            <div className="flex flex-col gap-2">
              {myReactionOptions.length === 0 && (
                <div className="text-xs text-neutral-500">No reactions in hand.</div>
              )}
              {myReactionOptions.map(({ idx, cardId, card, affordable, eligible }) => {
                const usable = affordable && eligible;
                const why = !affordable ? 'not enough mana' : !eligible ? 'needs a damage spell' : '';
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={disabled || !usable}
                    onClick={() => onReact(idx)}
                    className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-neutral-950 px-3 py-2 text-left text-sm transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span>
                      <span className="font-medium text-amber-200">{card.name}</span>
                      <span className="ml-1 text-xs text-neutral-500">({card.cost} mana)</span>
                      {why && <span className="ml-1 text-[10px] text-rose-400">— {why}</span>}
                      <span className="block text-[11px] text-neutral-400">{card.description}</span>
                    </span>
                    <span className="ml-2 shrink-0 text-amber-400">↩</span>
                  </button>
                );
              })}
              <button
                type="button"
                disabled={disabled}
                onClick={onPassReaction}
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:border-emerald-500 hover:text-white disabled:opacity-40"
              >
                Let it resolve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Targeting overlay */}
      {targeting && mySeat && (
        <TargetPicker
          spec={targeting.specs[targeting.chosen.length]}
          stepIndex={targeting.chosen.length}
          totalSteps={targeting.specs.length}
          mySeat={mySeat}
          players={state.players}
          onCancel={() => setTargeting(null)}
          onPick={(picked) => {
            const nextChosen = [...targeting.chosen, picked];
            if (nextChosen.length >= targeting.specs.length) {
              // All targets filled — fire the play and tear down the picker.
              const cardIdx = targeting.cardIdx;
              setTargeting(null);
              onPlay(cardIdx, nextChosen);
            } else {
              setTargeting({ ...targeting, chosen: nextChosen });
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Target picker overlay. Renders the right kind of picker for the current
 * TargetSpec; we'll grow the switch as new TargetKinds (card-in-hand,
 * card-in-discard, creature-in-play) come online.
 */
function TargetPicker({
  spec, stepIndex, totalSteps, mySeat, players, onPick, onCancel,
}: {
  spec: TargetSpec;
  stepIndex: number;
  totalSteps: number;
  mySeat: Seat;
  players: SDState['players'];
  onPick: (t: ResolvedTarget) => void;
  onCancel: () => void;
}) {
  const oppSeat: Seat = mySeat === 'A' ? 'B' : 'A';
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-emerald-500/60 bg-neutral-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500">
          <span>{spec.prompt ?? 'Pick a target'}</span>
          {totalSteps > 1 && <span>Step {stepIndex + 1} / {totalSteps}</span>}
        </div>

        {spec.kind === 'any_player' && (
          <div className="grid grid-cols-2 gap-3 pt-3">
            <PlayerTargetButton
              label="Yourself"
              p={players[mySeat]}
              onClick={() => onPick({ kind: 'player', seat: mySeat })}
            />
            <PlayerTargetButton
              label="Opponent"
              p={players[oppSeat]}
              onClick={() => onPick({ kind: 'player', seat: oppSeat })}
            />
          </div>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-300 hover:border-rose-500 hover:text-rose-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function PlayerTargetButton({
  label, p, onClick,
}: {
  label: string;
  p: PlayerState;
  onClick: () => void;
}) {
  const accent = p.accent_color ?? '#10b981';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-stretch gap-1 rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-left hover:border-emerald-400"
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: accent }} />
        <span className="truncate text-sm font-medium text-neutral-100">{label}</span>
      </div>
      <div className="text-xs text-neutral-400">
        {p.username || '(empty)'} — {p.hp}/{STARTING_HP} HP
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlayerPanel({
  p, isActive, isYou, hitKey, healKey, floaters,
}: {
  p: PlayerState;
  isActive: boolean;
  isYou: boolean;
  /** Bump these to trigger a red/green pulse on this panel. */
  hitKey: number;
  healKey: number;
  floaters: Floater[];
}) {
  const accent = p.accent_color ?? '#10b981';
  const hpPct = Math.max(0, Math.min(100, (p.hp / STARTING_HP) * 100));
  const effMana = p.mana + p.manaBonusThisTurn;

  // Pulse classes are keyed on the bumping numbers so React re-mounts the
  // animation each time the parent dispatches a new hit/heal event.
  return (
    <div
      key={`pulse-${hitKey}-${healKey}`}
      className={`relative rounded-xl border bg-neutral-900/80 p-3 transition ${
        isActive ? 'border-emerald-500/70 shadow-[0_0_0_1px_rgba(16,185,129,0.4)]' : 'border-neutral-800'
      } ${hitKey > 0 ? 'animate-hit-pulse' : ''} ${healKey > 0 ? 'animate-heal-pulse' : ''}`}
    >
      {/* Floating ± numbers — absolute on the panel, centered horizontally,
          animating up + fading. Multiple floaters stack via slight x-jitter. */}
      <div className="pointer-events-none absolute inset-x-0 top-2 z-10">
        {floaters.map((f, i) => (
          <div
            key={f.key}
            className="absolute left-1/2 animate-float-up font-mono text-2xl font-bold"
            style={{
              marginLeft: `${(i - (floaters.length - 1) / 2) * 32}px`,
              color: f.tone === 'damage' ? '#fb7185'
                   : f.tone === 'heal'   ? '#4ade80'
                   :                       '#facc15',
              textShadow: '0 1px 2px rgba(0,0,0,0.7)',
            }}
          >
            {f.sign === '+' && f.amount === 0 ? 'Blocked' : `${f.sign}${f.amount}`}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          <span className="truncate text-sm font-medium text-neutral-100">
            {p.username || '(empty seat)'}
          </span>
          {isYou && <span className="text-[10px] uppercase tracking-wider text-neutral-500">you</span>}
          {p.pendingTriggers.length > 0 && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              {p.pendingTriggers.length}× armed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span title="Deck">🂠 {p.deck.length}</span>
          <span title="Discard">🗑 {p.discard.length}</span>
        </div>
      </div>

      {/* HP bar */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">HP</span>
        <div className="relative h-2 flex-1 overflow-hidden rounded bg-neutral-800">
          <div
            className="h-full bg-rose-500 transition-all"
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <span className="w-10 text-right font-mono text-xs text-neutral-200">
          {p.hp}/{STARTING_HP}
        </span>
      </div>

      {/* Mana pips */}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Mana</span>
        <div className="flex flex-wrap gap-0.5">
          {Array.from({ length: Math.max(p.maxMana, 1) }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full border ${
                i < p.mana
                  ? 'border-sky-400 bg-sky-400'
                  : 'border-neutral-700 bg-neutral-900'
              }`}
            />
          ))}
          {Array.from({ length: p.manaBonusThisTurn }).map((_, i) => (
            <span
              key={`b${i}`}
              className="h-3 w-3 rounded-full border border-amber-400 bg-amber-400"
              title="Bonus mana (this turn)"
            />
          ))}
        </div>
        <span className="ml-auto font-mono text-xs text-neutral-300">
          {effMana}/{p.maxMana}{p.maxMana < MAX_MANA ? '' : ' (max)'}
        </span>
      </div>
    </div>
  );
}

/** Per-rarity visual treatment. Common = base indigo; Uncommon = silver;
 *  Rare = glowing gold (animated). Returns body bg, border, name color, and an
 *  optional always-on glow class for rares. */
function rarityStyle(rarity: 'common' | 'uncommon' | 'rare') {
  switch (rarity) {
    case 'uncommon':
      return {
        body: 'bg-gradient-to-br from-slate-700/70 to-neutral-900',
        border: 'border-slate-300/70',
        hoverBorder: 'hover:border-slate-100',
        name: 'text-slate-100',
        glow: '',
      };
    case 'rare':
      return {
        body: 'bg-gradient-to-br from-amber-900/70 to-neutral-900',
        border: 'border-amber-400/80',
        hoverBorder: 'hover:border-amber-200',
        name: 'text-amber-200',
        glow: 'animate-sd-rare-glow',
      };
    default:
      return {
        body: 'bg-gradient-to-br from-indigo-950 to-neutral-900',
        border: 'border-indigo-700',
        hoverBorder: 'hover:border-emerald-400',
        name: 'text-neutral-100',
        glow: '',
      };
  }
}

function Card({
  cardId, disabled, onClick,
}: {
  cardId: CardId;
  disabled: boolean;
  onClick: () => void;
}) {
  const card = CARDS[cardId];
  const rs = rarityStyle(card.rarity);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group relative flex h-44 w-32 flex-col items-stretch rounded-lg border ${rs.body} p-2 text-left transition ${
        disabled
          ? 'border-neutral-800 opacity-40'
          : `${rs.border} ${rs.hoverBorder} ${rs.glow} hover:-translate-y-1 hover:shadow-lg`
      }`}
      title={`${card.name} (${card.rarity}) — ${card.description}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`truncate text-sm font-semibold ${rs.name}`}>{card.name}</span>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 font-mono text-xs font-bold text-white">
          {card.cost}
        </span>
      </div>
      <div className="my-1.5 flex-1 leading-snug text-[11px] text-neutral-200">
        {card.description}
      </div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500">
        <span>{card.trigger ? 'Trigger' : card.dynamic ? 'Dynamic' : 'Spell'}</span>
        <span className={card.rarity === 'rare' ? 'text-amber-400' : card.rarity === 'uncommon' ? 'text-slate-300' : 'text-neutral-600'}>
          {card.rarity === 'rare' ? '◆' : card.rarity === 'uncommon' ? '◈' : '◇'}
        </span>
      </div>
    </button>
  );
}

function CardBack({ large = false }: { large?: boolean }) {
  // Compact (default) = the row of opponent's hand markers.
  // Large = a face-down stand-in for an unrevealed card in your own hand row
  //         (spectator view, or a defensive fallback for any HIDDEN_CARD that
  //         slipped into a player's hand somehow).
  const cls = large
    ? 'h-44 w-32 rounded-lg border border-indigo-800 bg-gradient-to-br from-indigo-900 via-indigo-950 to-black'
    : 'h-10 w-7 rounded-md border border-indigo-800 bg-gradient-to-br from-indigo-900 via-indigo-950 to-black';
  return <div className={cls} aria-hidden />;
}

/** A thin progress bar showing how far a player is through the draft. */
function DraftProgress({ label, round, done }: { label: string; round: number; done: boolean }) {
  const pct = done ? 100 : Math.round(((round - 1) / DRAFT_ROUNDS) * 100);
  return (
    <div className="flex items-center gap-2 text-[11px] text-neutral-500">
      <span className="w-32 shrink-0 truncate">
        {label}: {done ? 'ready ✓' : `round ${round}/${DRAFT_ROUNDS}`}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full bg-emerald-500/70 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Pre-duel draft screen. Each round the player is shown fresh offers and must
 * pick 2 commons + 1 uncommon (+ 1 rare on even rounds), building toward a
 * 35-card deck. Both players draft in parallel; the duel begins automatically
 * once both finish.
 */
function DraftScreen({
  mine, oppProgress, oppName, disabled, onPick,
}: {
  mine: DraftSeatState | null;
  oppProgress: DraftSeatState;
  oppName: string;
  disabled: boolean;
  onPick: (cardId: CardId) => void;
}) {
  // Spectators don't have a draft seat.
  if (!mine) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm text-neutral-400">
        Both players are drafting their decks…
      </div>
    );
  }

  if (mine.done) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <div className="text-lg font-semibold text-emerald-300">Deck locked in! ✓</div>
        <div className="text-sm text-neutral-400">Waiting for {oppName} to finish drafting…</div>
        <div className="w-full">
          <DraftProgress label={oppName} round={oppProgress.round} done={oppProgress.done} />
        </div>
      </div>
    );
  }

  const sections = ([
    { key: 'common',   title: 'Commons',   offer: mine.offer.common,   need: mine.need.common },
    { key: 'uncommon', title: 'Uncommons', offer: mine.offer.uncommon, need: mine.need.uncommon },
    { key: 'rare',     title: 'Rares',     offer: mine.offer.rare,     need: mine.need.rare },
  ] as const).filter(s => s.offer.length > 0 || s.need > 0);

  const counts = {
    common:   mine.picked.filter(id => CARDS[id]?.rarity === 'common').length,
    uncommon: mine.picked.filter(id => CARDS[id]?.rarity === 'uncommon').length,
    rare:     mine.picked.filter(id => CARDS[id]?.rarity === 'rare').length,
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-neutral-200">
          Draft your deck — Round {mine.round}/{DRAFT_ROUNDS}
        </div>
        <div className="text-xs text-neutral-500">
          Deck: {counts.common} commons · {counts.uncommon} uncommons · {counts.rare} rares
        </div>
      </div>

      <DraftProgress label={oppName} round={oppProgress.round} done={oppProgress.done} />

      {sections.map(s => (
        <div key={s.key} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-neutral-200">{s.title}</span>
            <span className={s.need > 0 ? 'text-emerald-300' : 'text-neutral-600'}>
              {s.need > 0 ? `pick ${s.need} more` : 'done ✓'}
            </span>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {s.offer.length === 0 ? (
              <span className="py-6 text-xs text-neutral-600">picked ✓</span>
            ) : (
              s.offer.map((cardId, i) => (
                <Card
                  key={`${cardId}-${i}`}
                  cardId={cardId}
                  disabled={disabled || s.need <= 0}
                  onClick={() => onPick(cardId)}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
