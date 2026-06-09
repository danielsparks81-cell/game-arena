'use client';

// HeroQuest lobby — all 4 heroes ALWAYS exist in the quest. Players claim
// hero slots; any unclaimed slots get auto-assigned at start_game by cycling
// through claimed players (1 player = controls all 4, 2 players = 2 each, …).

import {
  type HQState,
  HERO_DEFAULTS,
  CAMPAIGN,
  QUESTS,
} from '@/lib/games/heroquest';

// The lobby always previews the quest that start_game will actually launch —
// CAMPAIGN[0] — regardless of whatever questId is frozen in the saved DB state.
const STARTING_QUEST = QUESTS[CAMPAIGN[0]];
import { HeroToken, HeartIcon, MindIcon, SwordIcon, ShieldIcon } from './Art';
import { safeAccent } from '@/lib/accentColors';

const PARCHMENT_BG = `
  radial-gradient(ellipse at top, #f3e5c2 0%, #d8b884 80%),
  linear-gradient(135deg, #d8b884 0%, #b8945a 100%)
`;

export default function HeroLobby({
  state, currentUserId, isHost, disabled,
  onClaimHero, onRandomClasses, onStart,
}: {
  state: HQState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onClaimHero: (seat: number) => void;
  onRandomClasses: () => void;
  onStart: () => void;
}) {
  const mySeat = state.heroes.find(h => h.playerId === currentUserId)?.seat;
  // Distinct players seated in the room so we can tell the user "1 player =
  // controls all 4" vs "2 players = 2 each" etc.
  const distinctPlayers = Array.from(new Set(state.heroes.map(h => h.playerId).filter(Boolean)));
  const playerCount = distinctPlayers.length;
  const canStart = isHost && playerCount >= 1;

  const fillPreview = previewAutofill(state);

  return (
    <div className="space-y-4">
      {/* Mentor banner */}
      <div
        className="overflow-hidden rounded-xl border-2 shadow-lg"
        style={{ background: PARCHMENT_BG, borderColor: '#5a3a08', color: '#3a2408' }}
      >
        <div className="px-5 py-4 text-center" style={{ fontFamily: 'Georgia, serif' }}>
          <div className="text-[10px] uppercase tracking-[0.4em] text-amber-900/70">From the Books of Mentor</div>
          <h2 className="mt-1 text-2xl font-bold uppercase tracking-wide" style={{ color: '#5a1a08' }}>
            {STARTING_QUEST.name}
          </h2>
          <p className="mt-2 text-sm">{STARTING_QUEST.briefing}</p>
        </div>
      </div>

      {/* Party explainer */}
      <div className="rounded-xl border border-amber-900/40 bg-neutral-900 p-3 text-xs text-amber-200/80">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-bold text-amber-200">Every quest sends all 4 heroes.</span>
            {' '}With {playerCount} player{playerCount === 1 ? '' : 's'} seated, unclaimed
            heroes will be auto-assigned at start by cycling through the party.
            {playerCount === 1 && <span> Solo: you’ll control all four.</span>}
            {playerCount === 2 && <span> Two players: each controls two heroes.</span>}
            {playerCount === 3 && <span> Three players: one of you takes two heroes.</span>}
          </div>
          {isHost && (
            <button
              onClick={onRandomClasses}
              disabled={disabled || playerCount === 0}
              className="shrink-0 rounded-md border border-amber-700/60 bg-amber-900/30 px-2 py-1 text-xs text-amber-200 hover:bg-amber-800/40 disabled:opacity-40"
            >
              ⚂ Shuffle assignments
            </button>
          )}
        </div>
      </div>

      {/* The 4 hero slots */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {state.heroes.map(hero => {
          const d = HERO_DEFAULTS[hero.klass];
          const owned = !!hero.playerId;
          const mine = hero.playerId === currentUserId;
          const willAutofill = !owned && fillPreview[hero.seat];
          const accent = owned ? safeAccent(hero.accent_color) : '#7a6a40';
          return (
            <button
              key={hero.seat}
              onClick={() => !disabled && !mine && onClaimHero(hero.seat)}
              disabled={disabled || mine}
              className={`group relative flex flex-col overflow-hidden rounded-lg border-2 p-3 text-left transition ${
                mine
                  ? 'border-amber-400 shadow-[0_0_22px_rgba(250,176,84,0.55)]'
                  : owned
                  ? 'border-amber-900/50 hover:border-amber-700/80'
                  : 'border-amber-900/30 hover:border-amber-600/80 hover:shadow-[0_0_18px_rgba(250,176,84,0.3)]'
              }`}
              style={{
                background: mine
                  ? PARCHMENT_BG
                  : 'linear-gradient(180deg, #1a1410 0%, #050505 100%)',
                color: mine ? '#3a2408' : '#e8d8b8',
                cursor: !mine && !disabled ? 'pointer' : 'default',
              }}
            >
              {/* Top badge: who controls this slot */}
              <div
                className="absolute right-1 top-1 rounded-md px-1.5 py-0.5 text-[8px] uppercase tracking-widest"
                style={{
                  background: owned ? `${accent}cc` : 'rgba(60,40,20,0.6)',
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                }}
              >
                {mine ? 'You' : owned ? hero.username : willAutofill ? `Auto → ${willAutofill}` : 'Unclaimed'}
              </div>

              {/* Portrait */}
              <div className="mx-auto my-1 h-24 w-24">
                <HeroToken
                  klass={hero.klass}
                  size={96}
                  color={accent}
                  ring={mine ? '#ffd84d' : undefined}
                />
              </div>

              {/* Name */}
              <div className="text-center text-lg font-bold uppercase tracking-wider" style={{ fontFamily: 'Georgia, serif' }}>
                {d.name}
              </div>

              {/* Stats */}
              <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
                <span className="flex items-center gap-1"><HeartIcon size={11} /> {d.bodyMax} BP</span>
                <span className="flex items-center gap-1"><MindIcon size={11} /> {d.mindMax} MP</span>
                <span className="flex items-center gap-1"><SwordIcon size={11} /> Atk {d.baseAttack}</span>
                <span className="flex items-center gap-1"><ShieldIcon size={11} /> Def {d.baseDefense}</span>
              </div>

              {/* Description */}
              <p className="mt-2 text-[10px] leading-snug" style={{ opacity: 0.85 }}>{d.description}</p>

              {/* Footer action hint */}
              {!mine && !disabled && (
                <div className="mt-2 text-center text-[10px] uppercase tracking-widest" style={{ color: mine ? '#5a3a08' : '#facc15', opacity: 0.7 }}>
                  Tap to claim
                </div>
              )}
            </button>
          );
        })}
      </div>

      {isHost && (
        <button
          onClick={onStart}
          disabled={!canStart || disabled}
          className="w-full rounded-md border-2 border-amber-600 px-4 py-3 text-base font-bold uppercase tracking-widest transition disabled:opacity-40"
          style={{
            background: canStart
              ? 'linear-gradient(180deg, #d4a043 0%, #8a6020 100%)'
              : '#3a3a3a',
            color: '#1a0a00',
            fontFamily: 'Georgia, serif',
            textShadow: '0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          {canStart ? '⚔ Begin the Quest ⚔' : 'Waiting for at least 1 player…'}
        </button>
      )}
    </div>
  );
}

/** Predict who'd take each unclaimed seat at start_game (mirrors the engine
    auto-fill logic) so the lobby can show "Auto → Alice" tags. */
function previewAutofill(state: HQState): Record<number, string> {
  const claimers = state.heroes.filter(h => h.playerId);
  if (claimers.length === 0) return {};
  let cursor = 0;
  const out: Record<number, string> = {};
  for (const slot of state.heroes) {
    if (!slot.playerId) {
      out[slot.seat] = claimers[cursor % claimers.length].username;
      cursor += 1;
    }
  }
  return out;
}
