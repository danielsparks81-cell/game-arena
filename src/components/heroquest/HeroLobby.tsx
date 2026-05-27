'use client';

// HeroQuest lobby — class picker with parchment styling + hero portrait cards.

import {
  type HQState,
  type HeroClass,
  HERO_DEFAULTS,
} from '@/lib/games/heroquest';
import { HeroToken, HeartIcon, MindIcon, SwordIcon, ShieldIcon } from './Art';
import { safeAccent } from '@/lib/accentColors';

const PARCHMENT_BG = `
  radial-gradient(ellipse at top, #f3e5c2 0%, #d8b884 80%),
  linear-gradient(135deg, #d8b884 0%, #b8945a 100%)
`;

export default function HeroLobby({
  state, currentUserId, isHost, disabled,
  onSetClass, onRandomClasses, onStart,
}: {
  state: HQState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onSetClass: (klass: HeroClass) => void;
  onRandomClasses: () => void;
  onStart: () => void;
}) {
  const myHero = state.heroes.find(h => h.playerId === currentUserId);
  const taken = new Set(state.heroes.map(h => h.klass));
  const canStart = isHost && state.heroes.length >= 1;
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
            {state.quest.name}
          </h2>
          <p className="mt-2 text-sm">{state.quest.briefing}</p>
        </div>
      </div>

      {/* Party roster */}
      <div className="rounded-xl border border-amber-900/40 bg-neutral-900 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-amber-200/70" style={{ fontFamily: 'serif' }}>
            Party of {state.heroes.length}
          </div>
          {isHost && (
            <button
              onClick={onRandomClasses}
              disabled={disabled}
              className="rounded-md border border-amber-700/60 bg-amber-900/30 px-2 py-1 text-xs text-amber-200 hover:bg-amber-800/40 disabled:opacity-40"
            >
              ⚂ Randomise classes
            </button>
          )}
        </div>
        <ul className="space-y-1.5">
          {state.heroes.map(h => (
            <li
              key={h.playerId}
              className="flex items-center gap-3 rounded-md bg-amber-950/20 px-2 py-1.5"
            >
              <HeroToken klass={h.klass} size={26} color={safeAccent(h.accent_color)} />
              <span className="font-medium" style={{ color: safeAccent(h.accent_color) }}>{h.username}</span>
              <span className="ml-auto rounded-md bg-amber-900/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-100" style={{ fontFamily: 'serif' }}>
                {HERO_DEFAULTS[h.klass].name}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Class picker */}
      {myHero && (
        <div className="rounded-xl border border-amber-900/40 bg-neutral-900 p-3">
          <div className="mb-3 text-xs uppercase tracking-widest text-amber-200/70" style={{ fontFamily: 'serif' }}>
            Choose your hero
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['barbarian', 'dwarf', 'elf', 'wizard'] as HeroClass[]).map(klass => {
              const d = HERO_DEFAULTS[klass];
              const claimed = taken.has(klass) && myHero.klass !== klass;
              const me = myHero.klass === klass;
              return (
                <button
                  key={klass}
                  onClick={() => !claimed && onSetClass(klass)}
                  disabled={disabled || claimed}
                  className={`group relative overflow-hidden rounded-lg border-2 p-2 text-left transition ${
                    me
                      ? 'border-amber-400 shadow-[0_0_20px_rgba(250,176,84,0.5)]'
                      : claimed
                      ? 'border-neutral-800 opacity-40'
                      : 'border-amber-900/40 hover:border-amber-600/80 hover:shadow-[0_0_18px_rgba(250,176,84,0.3)]'
                  }`}
                  style={{
                    background: me ? PARCHMENT_BG : 'linear-gradient(180deg, #1a1410 0%, #050505 100%)',
                    color: me ? '#3a2408' : '#e8d8b8',
                  }}
                >
                  <div className="mx-auto w-20 h-20 mb-1.5">
                    <HeroToken klass={klass} size={80} />
                  </div>
                  <div className="text-center text-base font-bold uppercase tracking-wider" style={{ fontFamily: 'Georgia, serif' }}>
                    {d.name}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
                    <span className="flex items-center gap-1"><HeartIcon size={10} /> {d.bodyMax}</span>
                    <span className="flex items-center gap-1"><MindIcon size={10} /> {d.mindMax}</span>
                    <span className="flex items-center gap-1"><SwordIcon size={10} /> {d.baseAttack}</span>
                    <span className="flex items-center gap-1"><ShieldIcon size={10} /> {d.baseDefense}</span>
                  </div>
                  <p className="mt-2 text-[10px] leading-snug" style={{ opacity: 0.85 }}>{d.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
          {canStart ? '⚔ Begin the Quest ⚔' : 'Waiting for at least 1 hero…'}
        </button>
      )}
    </div>
  );
}
