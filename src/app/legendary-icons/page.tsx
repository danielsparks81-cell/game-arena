// Team icon design gallery — pick a style for the five hero teams.
// Visit /legendary-icons to preview all options.

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Team Icon Gallery — Legendary' };

// ─── Team data ────────────────────────────────────────────────────────────────
type TeamDef = {
  key: string;
  label: string;
  token: string;
  letter: string;
  abbr: string;
  pri: string; // background / fill colour
  acc: string; // accent / foreground colour
};

const TEAMS: TeamDef[] = [
  { key: 'avengers',       label: 'Avengers',       token: '[avengers]',       letter: 'A', abbr: 'AV', pri: '#1a3370', acc: '#f5a623' },
  { key: 'x-men',          label: 'X-Men',           token: '[x-men]',          letter: 'X', abbr: 'XM', pri: '#002D72', acc: '#FFD700' },
  { key: 'spider-friends', label: 'Spider-Friends',  token: '[spider-friends]', letter: 'S', abbr: 'SF', pri: '#7f1d1d', acc: '#fef2f2' },
  { key: 'fantastic-four', label: 'Fantastic Four',  token: '[fantastic-four]', letter: '4', abbr: 'FF', pri: '#003A70', acc: '#FF6B00' },
  { key: 'shield',         label: 'S.H.I.E.L.D.',   token: '[shield]',         letter: 'S', abbr: 'SH', pri: '#1e293b', acc: '#60a5fa' },
];

// ─── Style A — Rounded square, bold letter (current) ─────────────────────────
function StyleSquare({ t, s }: { t: TeamDef; s: number }) {
  return (
    <div style={{
      width: s, height: s, borderRadius: Math.round(s * 0.18),
      backgroundColor: t.pri, color: t.acc,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(s * 0.52), fontWeight: 900,
      fontFamily: '"Arial Black", Arial, sans-serif',
      flexShrink: 0,
    }}>
      {t.letter}
    </div>
  );
}

// ─── Style B — Circle with double-ring border ─────────────────────────────────
function StyleRing({ t, s }: { t: TeamDef; s: number }) {
  const bw = Math.max(2, Math.round(s * 0.06));
  return (
    <div style={{
      width: s, height: s, borderRadius: '50%',
      backgroundColor: t.pri, color: t.acc,
      border: `${bw}px solid ${t.acc}`,
      outline: `${Math.max(1, Math.round(s * 0.04))}px solid ${t.acc}30`,
      outlineOffset: `${bw + 1}px`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(s * 0.48), fontWeight: 900,
      fontFamily: '"Arial Black", Arial, sans-serif',
      flexShrink: 0,
    }}>
      {t.letter}
    </div>
  );
}

// ─── Style C — SVG emblem, team-specific symbol ───────────────────────────────
function StyleEmblem({ t, s }: { t: TeamDef; s: number }) {
  if (t.key === 'avengers') return (
    <svg width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="24" cy="24" r="24" fill={t.pri} />
      {/* faint inner ring */}
      <circle cx="24" cy="24" r="19.5" fill="none" stroke={t.acc} strokeWidth="1" opacity="0.45" />
      {/* Serif italic A — Avengers-logo feel */}
      <text x="24" y="34.5" textAnchor="middle" fill={t.acc}
            fontSize="30" fontWeight="900" fontFamily="Georgia, serif" fontStyle="italic">A</text>
    </svg>
  );

  if (t.key === 'x-men') return (
    <svg width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      {/* Classic blue field */}
      <rect width="48" height="48" rx="7" fill={t.pri} />
      {/* Yellow circle ring — classic X-Men logo element */}
      <circle cx="24" cy="24" r="16.5" fill="none" stroke={t.acc} strokeWidth="2.5" />
      {/* Bold X */}
      <line x1="14.5" y1="14.5" x2="33.5" y2="33.5" stroke={t.acc} strokeWidth="5" strokeLinecap="round" />
      <line x1="33.5" y1="14.5" x2="14.5" y2="33.5" stroke={t.acc} strokeWidth="5" strokeLinecap="round" />
    </svg>
  );

  if (t.key === 'spider-friends') return (
    <svg width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="24" cy="24" r="24" fill={t.pri} />
      {/* Spider abdomen */}
      <ellipse cx="24" cy="30" rx="6.5" ry="7.5" fill={t.acc} />
      {/* Spider head / cephalothorax */}
      <circle cx="24" cy="18.5" r="4.5" fill={t.acc} />
      {/* Legs — 3 pairs */}
      <line x1="18" y1="24" x2="5"  y2="17" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="18" y1="29" x2="5"  y2="30" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="19" y1="34" x2="8"  y2="42" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="30" y1="24" x2="43" y2="17" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="30" y1="29" x2="43" y2="30" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="29" y1="34" x2="40" y2="42" stroke={t.acc} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );

  if (t.key === 'fantastic-four') return (
    <svg width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      <rect width="48" height="48" rx="7" fill={t.pri} />
      {/* Circle ring */}
      <circle cx="24" cy="24" r="16.5" fill="none" stroke={t.acc} strokeWidth="2.5" />
      {/* Bold "4" */}
      <text x="24" y="36" textAnchor="middle" fill={t.acc}
            fontSize="28" fontWeight="900" fontFamily='"Arial Black", Arial, sans-serif'>4</text>
    </svg>
  );

  // S.H.I.E.L.D. — eagle-over-shield
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0 }}>
      {/* Shield / crest shape */}
      <path d="M24 3 L43 11 V27 C43 38 34 45 24 46 C14 45 5 38 5 27 V11 Z"
            fill={t.pri} stroke={t.acc} strokeWidth="2.5" strokeLinejoin="round" />
      {/* Eagle wingspan */}
      <path d="M12 21 C16 17 20 19.5 24 19.5 C28 19.5 32 17 36 21"
            fill="none" stroke={t.acc} strokeWidth="2" strokeLinecap="round" />
      {/* Eagle head */}
      <circle cx="24" cy="18" r="2.5" fill={t.acc} />
      {/* Body + tail */}
      <line x1="24" y1="20.5" x2="24" y2="35" stroke={t.acc} strokeWidth="2" strokeLinecap="round" />
      <path d="M19 35 L24 35 L29 35" stroke={t.acc} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Style D — Outlined, no fill ─────────────────────────────────────────────
function StyleOutlined({ t, s }: { t: TeamDef; s: number }) {
  return (
    <div style={{
      width: s, height: s, borderRadius: Math.round(s * 0.18),
      backgroundColor: 'transparent', color: t.acc,
      border: `${Math.max(2, Math.round(s * 0.07))}px solid ${t.acc}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(s * 0.48), fontWeight: 900,
      fontFamily: '"Arial Black", Arial, sans-serif',
      flexShrink: 0,
    }}>
      {t.letter}
    </div>
  );
}

// ─── Style E — Two-letter monogram ────────────────────────────────────────────
function StyleMonogram({ t, s }: { t: TeamDef; s: number }) {
  return (
    <div style={{
      height: s, borderRadius: Math.round(s * 0.2),
      padding: `0 ${Math.round(s * 0.22)}px`,
      minWidth: Math.round(s * 1.5),
      backgroundColor: t.pri, color: t.acc,
      border: `${Math.max(1, Math.round(s * 0.05))}px solid ${t.acc}50`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(s * 0.38), fontWeight: 900,
      fontFamily: '"Arial Black", Arial, sans-serif',
      letterSpacing: '1.5px',
      flexShrink: 0,
    }}>
      {t.abbr}
    </div>
  );
}

// ─── Style registry ───────────────────────────────────────────────────────────
type IconProps = { t: TeamDef; s: number };
type StyleEntry = {
  id: string;
  label: string;
  desc: string;
  Comp: (p: IconProps) => React.ReactElement | null;
};

const STYLES: StyleEntry[] = [
  { id: 'A', label: 'A — Square',   desc: 'Rounded rect, bold letter — current approach',  Comp: StyleSquare   },
  { id: 'B', label: 'B — Ring',     desc: 'Circle with double accent border',               Comp: StyleRing     },
  { id: 'C', label: 'C — Emblem',   desc: 'Team-specific SVG symbol',                       Comp: StyleEmblem   },
  { id: 'D', label: 'D — Outlined', desc: 'Transparent fill, accent border only',           Comp: StyleOutlined },
  { id: 'E', label: 'E — Monogram', desc: 'Two-letter abbreviation on solid field',         Comp: StyleMonogram },
];

const av = TEAMS[0]; // Avengers — for inline preview
const xm = TEAMS[1]; // X-Men    — for inline preview

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LegendaryIconsPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-8 py-12 text-neutral-100">
      <div className="mx-auto max-w-5xl">

        <h1 className="mb-1 text-xl font-bold tracking-tight">Team Icon Gallery</h1>
        <p className="mb-10 text-sm text-neutral-400">
          Five design options for each hero team. Each icon is shown at full size (48 px) and at the
          real inline card-text size (13 px). Tell me which style — or mix — to go with.
        </p>

        {/* ── Main grid ─────────────────────────────────────────────────────── */}
        <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-800">
                <th className="py-4 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 w-44">
                  Style
                </th>
                {TEAMS.map(t => (
                  <th key={t.key} className="py-4 px-5 text-center">
                    <div className="font-semibold text-neutral-200">{t.label}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-neutral-500">{t.token}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STYLES.map(({ id, label, desc, Comp }) => (
                <tr key={id} className="border-b border-neutral-800 last:border-0">
                  <td className="py-6 pl-6 pr-4 align-top">
                    <div className="font-semibold text-neutral-200">{label}</div>
                    <div className="mt-0.5 text-xs leading-snug text-neutral-500">{desc}</div>
                  </td>
                  {TEAMS.map(t => (
                    <td key={t.key} className="py-6 px-5 align-middle">
                      <div className="flex flex-col items-center gap-3">
                        {/* 48 px — easy to evaluate */}
                        <Comp t={t} s={48} />
                        {/* 13 px — actual inline usage size */}
                        <Comp t={t} s={13} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Inline card-text preview ───────────────────────────────────────── */}
        <div className="mt-10">
          <h2 className="mb-5 text-base font-semibold text-neutral-300">Inline card text preview</h2>
          <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            {STYLES.map(({ id, label, Comp }) => (
              <div key={id} className="flex items-center gap-4">
                <span className="w-28 shrink-0 text-xs font-semibold text-neutral-500">{label}</span>
                <span className="flex flex-wrap items-center gap-0.5 text-xs leading-snug text-neutral-300">
                  Each <Comp t={av} s={13} /> Hero you play, draw a card.
                  &nbsp;Fight: Reveal an <Comp t={xm} s={13} /> Hero or gain a Wound.
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </main>
  );
}
