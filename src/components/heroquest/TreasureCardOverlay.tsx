'use client';

// Treasure card flip-reveal animation + sound.
// Triggered whenever state.lastTreasureFx has a new seq number.
// The card slides in face-down, flips to reveal the result, holds for a
// moment, then fades out. A synthesised sound cue plays on flip.

import { useEffect, useRef, useState } from 'react';
import type { TreasureFx } from '@/lib/games/heroquest';

// ── icons / colours by card kind ─────────────────────────────────────────────

const KIND_ICON: Record<TreasureFx['kind'], string> = {
  gold:      '💰',
  gem:       '💎',
  jewels:    '💍',
  potion:    '🧪',
  hazard:    '💀',
  wandering: '⚔️',
  fixed:     '📦',
};

const KIND_STYLE: Record<TreasureFx['kind'], { card: string; glow: string }> = {
  gold:      { card: 'from-yellow-700 to-amber-950 border-yellow-400',  glow: 'shadow-[0_0_40px_rgba(251,191,36,0.6)]' },
  gem:       { card: 'from-cyan-700 to-blue-950 border-cyan-400',       glow: 'shadow-[0_0_40px_rgba(34,211,238,0.6)]' },
  jewels:    { card: 'from-violet-700 to-purple-950 border-violet-400', glow: 'shadow-[0_0_40px_rgba(167,139,250,0.6)]' },
  potion:    { card: 'from-emerald-700 to-green-950 border-emerald-400',glow: 'shadow-[0_0_40px_rgba(52,211,153,0.6)]' },
  hazard:    { card: 'from-red-800 to-rose-950 border-red-500',         glow: 'shadow-[0_0_40px_rgba(239,68,68,0.6)]'  },
  wandering: { card: 'from-orange-700 to-red-950 border-orange-500',    glow: 'shadow-[0_0_40px_rgba(249,115,22,0.6)]' },
  fixed:     { card: 'from-yellow-700 to-amber-950 border-yellow-400',  glow: 'shadow-[0_0_40px_rgba(251,191,36,0.6)]' },
};

// ── Web Audio sound synthesis ─────────────────────────────────────────────────

function playTreasureSound(kind: TreasureFx['kind']): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = new ((window as any).AudioContext ?? (window as any).webkitAudioContext)() as AudioContext;

    const play = (freq: number, type: OscillatorType, t: number, dur: number, vol = 0.25) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
    };

    const now = ctx.currentTime;

    if (kind === 'gold') {
      // Rising coin arpeggio — C E G C
      [523, 659, 784, 1047].forEach((f, i) => play(f, 'sine', now + i * 0.09, 0.35));
    } else if (kind === 'gem') {
      // Sparkling high chime — E A E (octave up)
      [659, 880, 1319].forEach((f, i) => play(f, 'sine', now + i * 0.1, 0.4, 0.2));
    } else if (kind === 'jewels') {
      // Rich jewel shimmer — G D G (high)
      [784, 1175, 1568].forEach((f, i) => play(f, 'sine', now + i * 0.08, 0.45, 0.22));
    } else if (kind === 'potion') {
      // Gentle ascending bubble
      play(330, 'sine', now,        0.15, 0.15);
      play(440, 'sine', now + 0.1,  0.15, 0.15);
      play(550, 'sine', now + 0.2,  0.25, 0.15);
    } else if (kind === 'hazard') {
      // Heavy descending thud
      play(160, 'sawtooth', now,       0.12, 0.3);
      play(90,  'sawtooth', now + 0.1, 0.35, 0.3);
      play(55,  'square',   now + 0.2, 0.4,  0.2);
    } else if (kind === 'wandering') {
      // Dramatic monster sting — three descending square pulses
      [220, 165, 110].forEach((f, i) => play(f, 'square', now + i * 0.18, 0.3, 0.25));
    } else {
      // Fixed chest — short shimmer
      [523, 784].forEach((f, i) => play(f, 'sine', now + i * 0.1, 0.3, 0.2));
    }
  } catch {
    // AudioContext not available (SSR / restricted context) — silently skip.
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'in' | 'flip' | 'show' | 'out';

export function TreasureCardOverlay({ fx }: { fx: TreasureFx | null | undefined }) {
  const seqRef  = useRef(-1);
  const [active, setActive] = useState<TreasureFx | null>(null);
  const [phase,  setPhase]  = useState<Phase>('idle');

  useEffect(() => {
    if (!fx || fx.seq === seqRef.current) return;
    seqRef.current = fx.seq;
    setActive(fx);
    setPhase('in');

    const ts: ReturnType<typeof setTimeout>[] = [
      // slight delay so the card slides in before flipping
      setTimeout(() => { setPhase('flip'); playTreasureSound(fx.kind); }, 250),
      // hold the revealed face
      setTimeout(() => setPhase('out'),  2600),
      // clean up after exit transition
      setTimeout(() => setPhase('idle'), 3200),
    ];
    return () => ts.forEach(clearTimeout);
  }, [fx?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'idle' || !active) return null;

  const style  = KIND_STYLE[active.kind];
  const icon   = KIND_ICON[active.kind];
  const leaving = phase === 'out';
  const flipped = phase === 'show' || leaving || phase === 'flip';
  // "flip" is a transient phase — the CSS transition handles the rotation;
  // treat it the same as "show" for the front-face visiblity
  const showFront = phase === 'flip' || phase === 'show' || leaving;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center overflow-hidden">
      {/* Dim backdrop */}
      <div
        className="absolute inset-0 bg-black/60 transition-opacity duration-300"
        style={{ opacity: leaving ? 0 : 1 }}
      />

      {/* Card wrapper — slides in from above, fades out upward */}
      <div
        className="relative transition-all duration-500"
        style={{
          transform: leaving
            ? 'translateY(-40px) scale(0.75)'
            : phase === 'in'
              ? 'translateY(-20px) scale(0.9)'
              : 'translateY(0) scale(1)',
          opacity: leaving ? 0 : 1,
        }}
      >
        {/* 3-D flip container */}
        <div
          className="relative h-52 w-40"
          style={{ perspective: '700px' }}
        >
          <div
            className="absolute inset-0 transition-transform duration-[550ms] ease-in-out"
            style={{
              transformStyle: 'preserve-3d',
              transform: showFront ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            {/* ── Card BACK ── */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border-2 border-amber-700/80 bg-gradient-to-br from-stone-900 to-black"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div className="text-5xl opacity-25 select-none" style={{ fontFamily: 'Georgia, serif' }}>⚔</div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-amber-600/50">Treasure</div>
            </div>

            {/* ── Card FRONT ── */}
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 bg-gradient-to-br p-4 text-center ${style.card} ${style.glow}`}
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="text-5xl drop-shadow-lg select-none">{icon}</div>
              <div
                className="text-base font-bold text-white drop-shadow-md leading-tight"
                style={{ fontFamily: 'Georgia, serif' }}
              >
                {active.label}
              </div>
              {active.subtitle && (
                <div className="text-xs text-white/75 leading-snug">{active.subtitle}</div>
              )}
            </div>
          </div>
        </div>

        {/* "Treasure Card" label below the card */}
        <div className="mt-2 text-center text-[10px] uppercase tracking-widest text-amber-300/60">
          Treasure Card
        </div>
      </div>
    </div>
  );
}
