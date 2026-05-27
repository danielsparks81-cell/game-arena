'use client';

// Parchment-styled quest briefing modal — shown on demand (e.g. user clicks
// "Mentor's words" button). Faithful to the 1989 art: aged paper texture,
// chunky serif headings, drop-cap initial, wax seal at the bottom.

import type { QuestDef } from '@/lib/games/heroquest';

const PARCHMENT_BG = `
  radial-gradient(ellipse at 30% 20%, #fdf3d8 0%, #e8cf94 60%, #c9a560 100%),
  linear-gradient(135deg, #e8cf94 0%, #b08840 100%)
`;

export default function QuestBriefing({
  quest, onClose,
}: {
  quest: QuestDef;
  onClose: () => void;
}) {
  // Drop-cap split: extract leading word as the illuminated letter, rest as body.
  const [firstWord, ...rest] = quest.briefing.split(' ');
  const restText = rest.join(' ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-lg shadow-2xl"
        style={{
          background: PARCHMENT_BG,
          border: '4px double #5a3a08',
          boxShadow: '0 30px 90px rgba(0,0,0,0.8), inset 0 0 60px rgba(120,80,20,0.3)',
          color: '#3a2408',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Burnt edges */}
        <div className="pointer-events-none absolute inset-0 rounded-lg"
          style={{
            boxShadow: 'inset 0 0 30px rgba(80,40,8,0.5), inset 0 0 80px rgba(80,40,8,0.25)',
          }}
        />

        {/* Quest title */}
        <div className="px-8 pt-7 pb-2 text-center">
          <div className="text-[10px] uppercase tracking-[0.4em] text-amber-900/70">A Quest from Mentor</div>
          <h1
            className="mt-1 text-3xl font-bold uppercase tracking-wide"
            style={{
              color: '#5a1a08',
              textShadow: '0 1px 0 rgba(255,255,255,0.5)',
              letterSpacing: '0.04em',
            }}
          >
            {quest.name}
          </h1>
          <div className="mx-auto mt-2 h-px w-32 bg-amber-900/40" />
        </div>

        {/* Body with drop-cap */}
        <div className="px-10 py-4 text-[15px] leading-relaxed">
          <span
            className="float-left mr-2 leading-none"
            style={{
              fontSize: '52px',
              fontFamily: '"Times New Roman", serif',
              fontWeight: 700,
              color: '#5a1a08',
              textShadow: '1px 1px 0 rgba(0,0,0,0.15)',
              padding: '4px 2px 0 0',
            }}
          >
            {firstWord.charAt(0)}
          </span>
          <span style={{ fontVariant: 'small-caps' }}>{firstWord.slice(1)} </span>
          {restText}
        </div>

        {/* Wax seal */}
        <div className="flex justify-center pb-6 pt-2">
          <div
            className="relative h-16 w-16 rounded-full"
            style={{
              background: 'radial-gradient(circle at 35% 35%, #d6402a 0%, #8a1010 70%, #5a0808 100%)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5), inset 0 -3px 8px rgba(0,0,0,0.4)',
            }}
          >
            <div
              className="absolute inset-2 rounded-full flex items-center justify-center"
              style={{ background: 'radial-gradient(circle at 35% 35%, #ed5040, #7a0808)' }}
            >
              <span style={{ fontSize: 22, color: '#ffe0c0', fontFamily: 'serif', fontWeight: 700 }}>M</span>
            </div>
          </div>
        </div>

        {/* Begin button */}
        <div className="flex justify-center px-8 pb-7">
          <button
            onClick={onClose}
            className="rounded-md border-2 px-6 py-2 text-sm font-bold uppercase tracking-widest transition hover:scale-105"
            style={{
              background: 'linear-gradient(180deg, #d4a043 0%, #8a6020 100%)',
              borderColor: '#5a3a08',
              color: '#1a0a00',
              textShadow: '0 1px 0 rgba(255,255,255,0.3)',
              fontFamily: 'Georgia, serif',
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
