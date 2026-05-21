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
  type HeroClass,
  type LegendaryEvent,
  type LegendaryState,
  type PlayerState,
} from '@/lib/games/legendary';
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
import { CARD_COPIES } from '@/lib/games/legendary';

type Floater = { key: number; seat: number; sign: '+' | '-'; amount: number; tone: 'damage' | 'heal' };

export default function LegendaryBoard({
  state, currentUserId, isHost, disabled, onStart, onPlay, onRecruit, onFightCity, onFightMastermind, onEndTurn,
}: {
  state: LegendaryState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onStart: () => void;
  onPlay: (instanceId: string) => void;
  onRecruit: (slot: number) => void;
  onFightCity: (slot: number) => void;
  onFightMastermind: () => void;
  onEndTurn: () => void;
}) {
  const me = state.players.find(p => p.playerId === currentUserId);
  const mySeat = me?.seat ?? -1;
  const currentPlayer = state.players[state.currentPlayerIdx];
  const isMyTurn = state.phase === 'playing' && currentPlayer?.playerId === currentUserId;

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

  const mmDef = getCard(state.mastermindId);
  const schemeDef = getCard(state.schemeId);
  const banner = state.phase === 'finished'
    ? (state.result === 'win' ? `🏆 ${state.resultReason ?? 'Heroes Win!'}` : `💀 ${state.resultReason ?? 'Evil Wins.'}`)
    : isMyTurn ? 'Your turn — play cards, then buy/fight, then End Turn.'
    : `${currentPlayer?.username ?? 'A player'}'s turn`;

  // Master Strikes get KO'd into state.ko after they fire; count them out
  // so the Strikes pile shows a real number.
  const strikesPlayed = state.ko.filter(c => c.cardId === 'master_strike').length;
  const schemeIsScheme = schemeDef.kind === 'scheme';
  const mmIsMM = mmDef.kind === 'mastermind';

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3">
      <div className="text-center text-sm text-neutral-300">{banner}</div>

      {/* ============================================================
          PLAYMAT — mirrors the standard Marvel Legendary playmat:
            Row 1: Twists · Scheme · Escape · Wounds · Bystanders
            Row 2: Strikes · Mastermind · (spacer) · Villain Deck
            Row 3: Sidekicks/Officers · 5 City slots · Hero Deck
            Row 4: HQ (5 slots, centered)
          ============================================================ */}
      <div className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">

        {/* ---- Row 1: Top auxiliary piles ---- */}
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-2">
            <PileDisplay
              label="Twists"
              count={state.schemeTwistsRevealed}
              total={schemeIsScheme ? schemeDef.twists : undefined}
              tone="amber"
            />
          </div>
          <div className="col-span-2">
            <SchemeZone schemeDef={schemeDef} twistsRevealed={state.schemeTwistsRevealed} />
          </div>
          <div className="col-span-4">
            <PileDisplay
              label="Escape"
              count={state.escapedPile.length}
              topCardLabel={state.escapedPile.length > 0 ? labelOf(state.escapedPile[state.escapedPile.length - 1]) : '—'}
              tone="rose"
            />
          </div>
          <div className="col-span-2">
            <PileDisplay label="Wounds" count={state.woundDeck.length} tone="neutral" />
          </div>
          <div className="col-span-2">
            <PileDisplay
              label="Bystanders"
              count={state.mastermind.bystanders.length}
              tone="amber"
            />
          </div>
        </div>

        {/* ---- Row 2: Mastermind band ---- */}
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-2">
            <PileDisplay label="Strikes" count={strikesPlayed} tone="rose" />
          </div>
          <div className="col-span-4">
            <MastermindZone
              mmDef={mmDef}
              hitsTaken={state.mastermind.hitsTaken}
              attack={state.thisTurn.attack}
              isMyTurn={isMyTurn}
              disabled={disabled || state.phase === 'finished'}
              onFight={onFightMastermind}
            />
          </div>
          {/* Right side — Always Leads centerpiece spans to the end now that
              Villain Deck moved down into the City row. */}
          <div className="col-span-6 flex items-center justify-center rounded-lg border border-dashed border-neutral-800 px-3 py-2 text-center">
            <div className="text-[11px] text-neutral-500">
              {mmIsMM && (
                <>
                  <span className="uppercase tracking-wider text-neutral-400">Always Leads</span>
                  <div className="mt-0.5 font-semibold text-neutral-200 capitalize">{mmDef.alwaysLeads}</div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ---- Row 3: City row (horizontal) ---- */}
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-1 flex flex-col gap-1">
            <PileDisplay label="Sidekicks" count={0} tone="neutral" compact />
            <PileDisplay label="Officers"  count={0} tone="neutral" compact />
          </div>
          <div className="col-span-10 grid grid-cols-5 gap-2">
            {state.city.map((card, slot) => (
              <div key={slot} className="flex flex-col gap-0.5">
                <CitySlot
                  card={card}
                  slot={slot}
                  isLast={slot === CITY_SIZE - 1}
                  attack={state.thisTurn.attack}
                  disabled={!isMyTurn || disabled || state.phase === 'finished'}
                  onFight={() => onFightCity(slot)}
                  attachedBystanders={card ? state.cityBystanders[card.instanceId]?.length ?? 0 : 0}
                />
                {/* Location name beneath each slot (matches the playmat). */}
                <div className={`text-center text-[9px] uppercase tracking-wider ${
                  slot === CITY_SIZE - 1 ? 'text-rose-500 font-semibold' : 'text-neutral-500'
                }`}>
                  {CITY_LOCATIONS[slot]}
                  {slot === CITY_SIZE - 1 && <span className="ml-1">↑ escape</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="col-span-1">
            <PileDisplay label="Villain Deck" count={state.villainDeck.length} tone="rose" backFace />
          </div>
        </div>

        {/* ---- Row 4: HQ row + Hero Deck on the right ---- */}
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-1" />
          <div className="col-span-10">
            <div className="mb-1 text-center text-[10px] uppercase tracking-wider text-neutral-500">HQ</div>
            <div className="grid grid-cols-5 gap-2">
              {state.hq.map((card, slot) => (
                <HQSlot
                  key={slot}
                  card={card}
                  slot={slot}
                  recruit={state.thisTurn.recruit}
                  disabled={!isMyTurn || disabled || state.phase === 'finished'}
                  onRecruit={() => onRecruit(slot)}
                />
              ))}
            </div>
          </div>
          <div className="col-span-1">
            <PileDisplay label="Hero Deck" count={state.heroDeck.length} tone="emerald" backFace />
          </div>
        </div>
      </div>

      {/* ============================================================
          PLAYER UI — below the playmat. Resources, hand, end turn,
          log, players. Personal to the viewer.
          ============================================================ */}

      {/* Resource bar + played strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm">
        <div className="flex items-center gap-6">
          <ResourcePip label="Strike"  value={state.thisTurn.attack}  color="rose"  />
          <ResourcePip label="Recruit" value={state.thisTurn.recruit} color="emerald" />
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 shrink-0">Played</span>
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
        <span className="text-xs text-neutral-500">Turn {state.turn}</span>
      </div>

      {/* Class legend */}
      <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] text-neutral-500">
        {(Object.keys(CLASS_COLORS) as HeroClass[]).map(c => (
          <span key={c} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full border border-black/40"
              style={{ backgroundColor: CLASS_COLORS[c] }}
            />
            {CLASS_LABELS[c]}
          </span>
        ))}
      </div>

      {/* Your hand */}
      <ZoneLabel>Your hand</ZoneLabel>
      <div className="flex flex-wrap items-stretch justify-center gap-2 min-h-[140px]">
        {me ? (
          me.hand.length === 0 ? (
            <div className="text-xs text-neutral-600">empty hand</div>
          ) : (
            me.hand.map((card) => (
              <HandCard
                key={card.instanceId}
                card={card}
                disabled={!isMyTurn || disabled || state.phase === 'finished' || !isPlayable(card.cardId)}
                onClick={() => onPlay(card.instanceId)}
              />
            ))
          )
        ) : (
          <div className="text-xs text-neutral-600">Spectating</div>
        )}
      </div>

      {/* End turn */}
      {me && state.phase === 'playing' && (
        <button
          type="button"
          disabled={!isMyTurn || disabled}
          onClick={onEndTurn}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:border-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          End turn (discards your hand & played cards)
        </button>
      )}

      {/* Log + Players */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">Recent</div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-snug">
            {state.log.length === 0 ? (
              <div className="text-neutral-600">No actions yet.</div>
            ) : (
              state.log.slice(-14).map((ev, i) => (
                <div key={i} className={logColor(ev, mySeat)}>{logText(ev)}</div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">Players</div>
          <div className="space-y-1">
            {state.players.map(p => (
              <PlayerRow
                key={p.playerId}
                p={p}
                active={state.phase === 'playing' && p.playerId === currentPlayer?.playerId}
                isYou={p.playerId === currentUserId}
                floaters={floaters.filter(f => f.seat === p.seat)}
              />
            ))}
          </div>
        </div>
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
      <div className={`flex h-32 flex-col items-center justify-center rounded-lg border border-dashed text-[11px] text-neutral-600 ${
        isLast ? 'border-rose-900/50' : 'border-neutral-800'
      }`}>
        <span>empty</span>
      </div>
    );
  }
  const def = getCard(card.cardId);
  if (def.kind !== 'villain' && def.kind !== 'henchman') {
    return <div className="h-32 rounded-lg bg-neutral-900" />;
  }
  const canFight = !disabled && attack >= def.attack;
  return (
    <button
      type="button"
      disabled={!canFight}
      onClick={onFight}
      className={`flex h-32 flex-col items-stretch rounded-lg border p-2 text-left transition ${
        canFight ? 'border-rose-700 bg-gradient-to-br from-rose-950 to-neutral-950 hover:border-emerald-400'
                 : 'border-neutral-800 bg-neutral-900 opacity-80'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="truncate text-[11px] font-semibold text-neutral-100">{def.name}</span>
        <span className="rounded bg-rose-600/30 px-1 text-[10px] font-mono text-rose-200">{def.attack}⚔</span>
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wider text-neutral-500">
        {def.kind === 'villain' ? 'Villain' : 'Henchman'}
      </div>
      {def.kind === 'villain' && def.text && (
        <div className="mt-1 text-[10px] leading-tight text-neutral-400">{def.text}</div>
      )}
      <div className="mt-auto flex items-center justify-between text-[10px] text-neutral-500">
        <span>{def.vp} VP</span>
        {attachedBystanders > 0 && (
          <span className="rounded bg-amber-500/20 px-1 text-amber-300">+{attachedBystanders} 👤</span>
        )}
      </div>
      <span className="sr-only">Slot {slot}</span>
    </button>
  );
}

function HQSlot({
  card, slot, recruit, disabled, onRecruit,
}: {
  card: CardInstance | null;
  slot: number;
  recruit: number;
  disabled: boolean;
  onRecruit: () => void;
}) {
  if (!card) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-neutral-800 text-[11px] text-neutral-600">
        empty
      </div>
    );
  }
  const def = getCard(card.cardId);
  if (def.kind !== 'hero') return <div className="h-32 rounded-lg bg-neutral-900" />;
  const canAfford = !disabled && recruit >= def.cost;
  const copies = CARD_COPIES[card.cardId];
  return (
    <button
      type="button"
      disabled={!canAfford}
      onClick={onRecruit}
      className={`transition ${canAfford ? 'hover:-translate-y-0.5 hover:shadow-lg' : 'opacity-60'}`}
    >
      <HeroCardArt def={def} wide height="h-36" copies={copies} />
      <span className="sr-only">Slot {slot}</span>
    </button>
  );
}

function HandCard({
  card, disabled, onClick,
}: {
  card: CardInstance;
  disabled: boolean;
  onClick: () => void;
}) {
  const def = CARDS[card.cardId];
  // Wounds / bystanders in hand — junk card, not playable as a hero.
  if (!def || def.kind !== 'hero') {
    return (
      <div className="flex h-28 w-48 flex-col items-stretch rounded-lg border border-rose-900/60 bg-gradient-to-br from-rose-950 to-neutral-950 p-2 opacity-70">
        <div className="text-[11px] font-semibold text-rose-200">
          {def?.kind === 'wound' ? 'Wound' : def?.kind === 'bystander' ? 'Bystander' : 'Card'}
        </div>
        <div className="mt-auto text-[9px] uppercase tracking-wider text-rose-500">junk — clutter only</div>
      </div>
    );
  }
  const copies = CARD_COPIES[card.cardId];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={def.text}
      className={`transition ${disabled ? 'opacity-50' : 'hover:-translate-y-1 hover:shadow-lg'}`}
    >
      <HeroCardArt def={def} copies={copies} />
    </button>
  );
}

function ResourcePip({ label, value, color }: { label: string; value: number; color: 'rose' | 'emerald' }) {
  const cls = color === 'rose' ? 'text-rose-400' : 'text-emerald-400';
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <span className={`font-mono text-xl font-bold ${cls}`}>{value}</span>
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
function PileDisplay({
  label, count, total, topCardLabel, tone = 'neutral', backFace = false, compact = false,
}: {
  label: string;
  count: number;
  total?: number;
  topCardLabel?: string;
  tone?: PileTone;
  backFace?: boolean;
  compact?: boolean;
}) {
  const h = compact ? 'h-10' : 'h-20';
  return (
    <div
      className={`relative flex ${h} flex-col items-center justify-center rounded-lg border-2 border-dashed ${pileToneClasses(tone)} px-1.5 py-1`}
    >
      {backFace && (
        // Subtle inner pattern to imply "face-down stack". Decorative only.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0.5 rounded-md opacity-25"
          style={{
            background:
              'repeating-linear-gradient(45deg, rgba(255,255,255,0.07) 0 4px, transparent 4px 8px)',
          }}
        />
      )}
      <div className="relative z-10 flex flex-col items-center">
        <span className="text-[9px] uppercase tracking-wider text-neutral-500">{label}</span>
        <span className="font-mono text-base font-bold text-neutral-200">
          {count}{total !== undefined ? `/${total}` : ''}
        </span>
        {topCardLabel && !compact && (
          <span className="line-clamp-1 max-w-full text-[9px] text-neutral-400">{topCardLabel}</span>
        )}
      </div>
    </div>
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
    return <div className="h-20 rounded-lg border border-dashed border-neutral-800" />;
  }
  return (
    <div
      className="flex h-20 flex-col rounded-lg border-2 border-dashed border-amber-700/70 bg-gradient-to-br from-amber-950/40 to-neutral-950/40 px-2 py-1"
      title={schemeDef.text}
    >
      <span className="text-[9px] uppercase tracking-wider text-amber-400">Scheme</span>
      <span className="truncate text-[11px] font-semibold text-neutral-100">{schemeDef.name}</span>
      <div className="mt-auto flex gap-0.5">
        {Array.from({ length: schemeDef.twists }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded ${i < twistsRevealed ? 'bg-amber-500' : 'bg-neutral-800'}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Mastermind card — the boss. Clickable to attempt a fight. HP rendered as
 *  a row of pips showing remaining "hits to defeat". */
function MastermindZone({
  mmDef, hitsTaken, attack, isMyTurn, disabled, onFight,
}: {
  mmDef: ReturnType<typeof getCard>;
  hitsTaken: number;
  attack: number;
  isMyTurn: boolean;
  disabled: boolean;
  onFight: () => void;
}) {
  if (mmDef.kind !== 'mastermind') {
    return <div className="h-20 rounded-lg border border-dashed border-neutral-800" />;
  }
  const canHit = isMyTurn && !disabled && attack >= mmDef.attack;
  return (
    <button
      type="button"
      disabled={!canHit}
      onClick={onFight}
      title={mmDef.text}
      className={`flex h-20 flex-col items-stretch rounded-lg border-2 bg-gradient-to-br from-rose-950 to-neutral-950 px-2 py-1 text-left transition ${
        canHit ? 'border-rose-500 hover:-translate-y-0.5 hover:shadow-lg' : 'border-rose-900/70 opacity-90'
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-wider text-rose-400">Mastermind</span>
        <span className="font-mono text-[9px] text-neutral-400">{mmDef.attack}⚔ · {mmDef.vp}VP</span>
      </div>
      <span className="truncate text-sm font-semibold text-neutral-100">{mmDef.name}</span>
      <div className="mt-auto flex gap-0.5">
        {Array.from({ length: mmDef.hits }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded ${i < hitsTaken ? 'bg-rose-500' : 'bg-neutral-800'}`}
          />
        ))}
      </div>
    </button>
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

function logText(ev: LegendaryEvent): string {
  switch (ev.kind) {
    case 'system':             return ev.text;
    case 'turn_started':       return `${ev.username}'s turn.`;
    case 'card_played':        return `${ev.cardName} played.`;
    case 'hero_recruited':     return `recruited ${ev.cardName} (${ev.cost}🪙)`;
    case 'villain_defeated':   return `defeated ${ev.cardName} (+${ev.vp} VP)`;
    case 'villain_revealed':   return `${ev.cardName} entered the city`;
    case 'villain_escaped':    return `${ev.cardName} ESCAPED`;
    case 'mastermind_hit':     return `Mastermind hit — ${ev.hitsRemaining} left to defeat`;
    case 'master_strike':      return `⚡ Master Strike: ${ev.effectText}`;
    case 'scheme_twist':       return `Scheme Twist ${ev.twistsRevealed} / ${ev.twistsTotal}`;
    case 'wound_taken':        return `${ev.username} took a Wound`;
    case 'bystander_rescued':  return `${ev.username} rescued ${ev.count} bystander${ev.count === 1 ? '' : 's'}`;
    case 'game_ended':         return ev.reasonText;
  }
}

function logColor(ev: LegendaryEvent, mySeat: number): string {
  if (ev.kind === 'villain_escaped' || ev.kind === 'master_strike') return 'text-rose-400';
  if (ev.kind === 'scheme_twist') return 'text-amber-400';
  if (ev.kind === 'game_ended') return ev.result === 'win' ? 'text-emerald-300' : 'text-rose-300';
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
    case 'game_ended':        ev.result === 'win' ? sounds.win() : sounds.sdLose(); break;
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
