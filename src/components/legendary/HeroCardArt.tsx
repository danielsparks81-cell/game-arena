// Pure-visual hero card render. Takes a HeroCardDef and produces the card
// exactly as it appears in the live game's hand. Extracted so the sandbox
// preview can't drift from in-game — both code paths render through this.
//
// No interaction props (onClick, disabled) — those are the caller's job. Wrap
// in a <button> if you want a clickable card, leave bare for static preview.

import React, { useLayoutEffect, useRef } from 'react';
import type { HeroClass, HeroCardDef, Team } from '@/lib/games/legendary';

// ─── Auto-fit hook ───────────────────────────────────────────────────────────
/**
 * Attach the returned ref to a fixed-height text container. The hook measures
 * scrollHeight vs clientHeight on every dep change and steps the container's
 * font-size down (in 0.5px increments from `maxPx` to `minPx`) until the
 * content stops overflowing.
 *
 * Children must NOT set their own font-size (no `text-[11px]` etc.) — they
 * inherit from the container so scaling cascades through. Run inside a
 * useLayoutEffect so the size is correct before paint (no flash).
 */
export function useAutoFitFontSize(
  maxPx: number,
  minPx: number,
  deps: React.DependencyList,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    // Step down until content fits or we hit the minimum.
    while (size > minPx && el.scrollHeight > el.clientHeight) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

// ─── Class colors ────────────────────────────────────────────────────────────
// Colors as they appear in the game UI (dot next to the hero class name):
//   Tech      = black
//   Covert    = red
//   Instinct  = yellow
//   Ranged    = blue
//   Strength  = green

export const CLASS_COLORS: Record<HeroClass, string> = {
  tech:     '#4a5568',  // slate (dark, visible border on dark UI)
  covert:   '#ef4444',  // red
  instinct: '#eab308',  // yellow
  ranged:   '#3b82f6',  // blue (matches ranged icon color)
  strength: '#22c55e',  // green
};

/** Chip dot colors — what the player sees next to the hero class name. */
export const CLASS_CHIP_COLORS: Record<HeroClass, string> = {
  tech:     '#1a1a1a',  // black
  covert:   '#ef4444',  // red
  instinct: '#eab308',  // yellow
  ranged:   '#3b82f6',  // blue
  strength: '#22c55e',  // green
};

export const CLASS_LABELS: Record<HeroClass, string> = {
  strength: 'Strength', covert: 'Covert', ranged: 'Ranged', tech: 'Tech', instinct: 'Instinct',
};

// ─── Class icons ──────────────────────────────────────────────────────────────
// Actual pixel-art icons from the physical game, cropped to transparent PNGs
// and served from /legendary/class-{class}.png.

export const CLASS_ICONS: Record<HeroClass, React.ReactElement> = {
  // Strength G — double chevron up
  strength: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <polygon points="8,2 14,8.5 12,8.5 8,4.5 4,8.5 2,8.5" fill="#22c55e"/>
      <polygon points="8,7 14,13.5 12,13.5 8,9.5 4,13.5 2,13.5" fill="#22c55e" opacity="0.6"/>
    </svg>
  ),
  // Instinct D — animal eye with slit pupil
  instinct: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <path d="M1.5,8 Q4,3 8,3 Q12,3 14.5,8 Q12,13 8,13 Q4,13 1.5,8 Z" fill="#eab308" opacity="0.9"/>
      <circle cx="8" cy="8" r="3.2" fill="#ca8a04"/>
      <ellipse cx="8" cy="8" rx="1.1" ry="2.8" fill="#1a0a00"/>
      <ellipse cx="6.8" cy="6.5" rx="0.8" ry="0.5" fill="#fde047" opacity="0.5"/>
    </svg>
  ),
  // Covert G — crossed blades ×
  covert: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <rect x="7" y="2" width="2" height="12" rx="0.8" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.4" transform="rotate(45,8,8)"/>
      <rect x="7" y="2" width="2" height="12" rx="0.8" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.4" transform="rotate(-45,8,8)"/>
      <circle cx="8" cy="8" r="1.8" fill="#7f1d1d" stroke="#ef4444" strokeWidth="0.6"/>
    </svg>
  ),
  // Tech v2 original — microchip with pins
  tech: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <rect x="4"    y="4"    width="8"   height="8"   rx="1.2" fill="#374151" stroke="#9ca3af" strokeWidth="0.8"/>
      <rect x="5.8"  y="5.8"  width="4.4" height="4.4" rx="0.6" fill="#6b7280"/>
      <rect x="6.6"  y="6.6"  width="1.2" height="1.2" rx="0.2" fill="#9ca3af"/>
      <rect x="8.2"  y="6.6"  width="1.2" height="1.2" rx="0.2" fill="#9ca3af"/>
      <rect x="6.6"  y="8.2"  width="1.2" height="1.2" rx="0.2" fill="#9ca3af"/>
      <rect x="8.2"  y="8.2"  width="1.2" height="1.2" rx="0.2" fill="#9ca3af"/>
      <rect x="6.4"  y="1.8"  width="1.1" height="2.4" rx="0.4" fill="#9ca3af"/>
      <rect x="8.5"  y="1.8"  width="1.1" height="2.4" rx="0.4" fill="#9ca3af"/>
      <rect x="6.4"  y="11.8" width="1.1" height="2.4" rx="0.4" fill="#9ca3af"/>
      <rect x="8.5"  y="11.8" width="1.1" height="2.4" rx="0.4" fill="#9ca3af"/>
      <rect x="1.8"  y="6.4"  width="2.4" height="1.1" rx="0.4" fill="#9ca3af"/>
      <rect x="1.8"  y="8.5"  width="2.4" height="1.1" rx="0.4" fill="#9ca3af"/>
      <rect x="11.8" y="6.4"  width="2.4" height="1.1" rx="0.4" fill="#9ca3af"/>
      <rect x="11.8" y="8.5"  width="2.4" height="1.1" rx="0.4" fill="#9ca3af"/>
    </svg>
  ),
  // Ranged B bullseye — darker blue #3b82f6
  ranged: (
    <svg viewBox="0 0 16 16" fill="none" width="100%" height="100%">
      <circle cx="8" cy="8" r="6.5" stroke="#3b82f6" strokeWidth="1.2" fill="none"/>
      <circle cx="8" cy="8" r="4.2" stroke="#3b82f6" strokeWidth="1.2" fill="none"/>
      <circle cx="8" cy="8" r="2"   fill="#3b82f6" opacity="0.9"/>
      <line x1="8"   y1="0.5"  x2="8"    y2="3"    stroke="#3b82f6" strokeWidth="1" strokeLinecap="round"/>
      <line x1="8"   y1="13"   x2="8"    y2="15.5" stroke="#3b82f6" strokeWidth="1" strokeLinecap="round"/>
      <line x1="0.5" y1="8"    x2="3"    y2="8"    stroke="#3b82f6" strokeWidth="1" strokeLinecap="round"/>
      <line x1="13"  y1="8"    x2="15.5" y2="8"    stroke="#3b82f6" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
};

// ─── Team icons ──────────────────────────────────────────────────────────────
// Single-letter monogram + background color for each team. Rendered as a tiny
// square chip to the left of the card name. Teamless cards reserve the same
// horizontal space so all card names stay left-aligned.

type TeamIconDatum = { abbr: string; color: string; textColor?: string };

export const TEAM_ICON_DATA: Record<string, TeamIconDatum> = {
  'avengers':           { abbr: 'A',  color: '#f59e0b', textColor: '#000' },   // amber
  'x-men':              { abbr: 'X',  color: '#DC143C', textColor: '#fff' },   // crimson
  'spider-friends':     { abbr: 'S',  color: '#ef4444', textColor: '#fff' },   // red
  'fantastic-four':     { abbr: '4',  color: '#3b82f6', textColor: '#fff' },   // blue
  'shield':             { abbr: '★',  color: '#94a3b8', textColor: '#000' },   // slate
  'shield-officer':     { abbr: '★',  color: '#94a3b8', textColor: '#000' },
  'shield-agent':       { abbr: '★',  color: '#94a3b8', textColor: '#000' },
  'shield-trooper':     { abbr: '★',  color: '#94a3b8', textColor: '#000' },
  'hydra':              { abbr: 'H',  color: '#22c55e', textColor: '#000' },   // green
  'brotherhood':        { abbr: 'B',  color: '#8b5cf6', textColor: '#fff' },   // violet
  'masters-of-evil':    { abbr: 'M',  color: '#dc2626', textColor: '#fff' },   // red
  'enemies-of-asgard':  { abbr: 'E',  color: '#475569', textColor: '#fff' },   // slate-600
  'skrulls':            { abbr: 'K',  color: '#16a34a', textColor: '#000' },   // green — Skrulls' iconic skin color
  'spider-foes':        { abbr: 'F',  color: '#7c2d12', textColor: '#fef2f2' }, // dark red — Spider-Man's classic enemies
  'radiation':          { abbr: 'R',  color: '#84cc16', textColor: '#000' },   // bright lime — gamma-radiation green
};

/** Team icon chip — shows the first team's icon, or reserves blank space
 *  so card names stay horizontally aligned across teamless cards. */
export function TeamChip({ teams }: { teams: Team[] }) {
  const firstTeam = teams[0];
  const S = 15;

  // Teamless (e.g. Deadpool) — invisible placeholder preserving spacing
  if (!firstTeam) return <div style={{ width: S, height: S, flexShrink: 0 }} aria-hidden />;

  // Avengers — Style C: navy circle, faint gold ring, serif italic A
  if (firstTeam === 'avengers') return (
    <span title="Avengers" aria-label="Avengers" style={{ display: 'inline-flex', flexShrink: 0 }}>
      <svg width={S} height={S} viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="24" fill="#1a3370"/>
        <circle cx="24" cy="24" r="19.5" fill="none" stroke="#f5a623" strokeWidth="1.5" opacity="0.45"/>
        <text x="24" y="34.5" textAnchor="middle" fill="#f5a623" fontSize="30" fontWeight="900" fontFamily="Georgia, serif" fontStyle="italic">A</text>
      </svg>
    </span>
  );

  // X-Men — Style C red: red square, black circle ring, bold black X
  if (firstTeam === 'x-men') return (
    <span title="X-Men" aria-label="X-Men" style={{ display: 'inline-flex', flexShrink: 0 }}>
      <svg width={S} height={S} viewBox="0 0 48 48">
        <rect width="48" height="48" rx="7" fill="#b91c1c"/>
        <circle cx="24" cy="24" r="16.5" fill="none" stroke="#000" strokeWidth="2.5"/>
        <line x1="14.5" y1="14.5" x2="33.5" y2="33.5" stroke="#000" strokeWidth="5" strokeLinecap="round"/>
        <line x1="33.5" y1="14.5" x2="14.5" y2="33.5" stroke="#000" strokeWidth="5" strokeLinecap="round"/>
      </svg>
    </span>
  );

  // Spider-Friends — Style B: dark red circle, white border, white S
  if (firstTeam === 'spider-friends') return (
    <span title="Spider-Friends" aria-label="Spider-Friends" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: S, height: S, borderRadius: '50%',
      backgroundColor: '#7f1d1d', color: '#fef2f2',
      border: '1.5px solid #fef2f2',
      fontSize: '7px', fontWeight: 900, fontFamily: '"Arial Black", Arial, sans-serif', lineHeight: 1,
      flexShrink: 0,
    }}>S</span>
  );

  // S.H.I.E.L.D. variants — silver circle with ★
  if (firstTeam === 'shield' || firstTeam === 'shield-officer' || firstTeam === 'shield-agent' || firstTeam === 'shield-trooper') return (
    <span
      title="S.H.I.E.L.D." aria-label="S.H.I.E.L.D."
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: S, height: S, borderRadius: '50%',
        backgroundColor: '#94a3b8', color: '#1e293b',
        fontSize: '7px', fontWeight: 900, lineHeight: 1,
        flexShrink: 0,
      }}
    >★</span>
  );

  // Fallback — letter badge for teams without a custom icon yet
  const data = TEAM_ICON_DATA[firstTeam];
  if (!data) return <div style={{ width: S, height: S, flexShrink: 0 }} aria-hidden />;
  return (
    <div
      style={{
        width: S, height: S, flexShrink: 0, borderRadius: 2,
        backgroundColor: data.color, color: data.textColor ?? '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 7, fontWeight: 900, lineHeight: 1,
      }}
      title={firstTeam} aria-label={firstTeam}
    >
      {data.abbr}
    </div>
  );
}

// ─── SHIELD helpers ──────────────────────────────────────────────────────────
/** SHIELD starters get a silver border + suppressed class/team chips — they're
 *  basic utility cards, not recruitable heroes. */
export const SHIELD_SILVER = '#c0c0c0';
export function isShieldStarter(className: string): boolean {
  return className === 'S.H.I.E.L.D.';
}

// ─── Class background tints ───────────────────────────────────────────────────
// Dark, saturated gradient derived from each class color. Applied as the
// default card background so the class is immediately readable at a glance.
// `extraStyle` (passed by callers for SHIELD grey, etc.) overrides this.

const CLASS_DARK_BG: Record<HeroClass, readonly [string, string]> = {
  tech:     ['#1e1e1e', '#111111'],  // dark charcoal / near-black
  covert:   ['#2e0f0f', '#140808'],  // dark red
  instinct: ['#2e2808', '#141204'],  // dark amber
  ranged:   ['#0f1a2e', '#060a14'],  // dark navy
  strength: ['#0f2e18', '#080f0a'],  // dark green
};

/** Returns a linear-gradient background for a card based on its classes. */
export function classBg(classes: HeroClass[]): string {
  if (classes.length === 0) return 'linear-gradient(135deg, #1c1c1c, #111111)';
  const [from] = CLASS_DARK_BG[classes[0]];
  const [, to]  = CLASS_DARK_BG[classes[classes.length - 1]];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

// ─── Border helpers ───────────────────────────────────────────────────────────

export function classBorderStyle(classes: HeroClass[], className: string): React.CSSProperties {
  if (isShieldStarter(className)) return { borderColor: SHIELD_SILVER };
  if (classes.length === 0) return { borderColor: '#404040' };
  if (classes.length === 1) return { borderColor: CLASS_COLORS[classes[0]] };
  const stops = classes.map(c => CLASS_COLORS[c]).join(', ');
  return {
    borderImage: `linear-gradient(135deg, ${stops}) 1`,
    borderStyle: 'solid',
  };
}

// ─── Class chips ──────────────────────────────────────────────────────────────

export function ClassChips({ classes, size = 'sm' }: { classes: HeroClass[]; size?: 'sm' | 'xs' }) {
  const sz = size === 'sm' ? 'h-[15px] w-[15px]' : 'h-[11px] w-[11px]';
  return (
    <div className="flex gap-0.5">
      {classes.length === 0
        ? /* invisible placeholder — keeps className text left-aligned with chipped cards */
          <span className={`inline-block ${sz} shrink-0`} aria-hidden />
        : classes.map(c => (
            <span
              key={c}
              title={CLASS_LABELS[c]}
              aria-label={CLASS_LABELS[c]}
              className={`inline-flex shrink-0 items-center justify-center ${sz}`}
            >
              {CLASS_ICONS[c]}
            </span>
          ))
      }
    </div>
  );
}

// ─── Strike icon — three claw scratch marks ──────────────────────────────────
function StrikeIcon({ size = 16 }: { size?: number }) {
  const h = Math.round(size * 14 / 16);
  return (
    <svg
      width={size} height={h} viewBox="0 0 16 14"
      style={{ display: 'inline-block', verticalAlign: 'middle', filter: 'drop-shadow(0 0 2px #991b1b)' }}
      aria-label="strike"
    >
      <g stroke="#ef4444" strokeLinecap="round" fill="none" strokeWidth="1.8">
        <path d="M1 1 C2 5 4 9 7 13" />
        <path d="M5.5 1 C6.5 5 8.5 9 11 13" />
        <path d="M10 1 C11 5 13 9 15 13" />
      </g>
    </svg>
  );
}

// ─── Card-text token parser ───────────────────────────────────────────────────
//
// Card text is stored as a string with lightweight markup tokens so the author
// can embed icons without writing JSX directly. Supported tokens:
//
//   [strength]  [covert]  [ranged]  [tech]  [instinct]
//       → renders the class's colored dot (same chip style as the header)
//
//   [strike]
//       → renders the red claw-mark SVG inline
//
//   [recruit]
//       → renders the amber ★ recruit symbol
//
// Example:  "[covert] Rescue a Bystander. +1[strike] per Bystander in VP."
//
// This is intentionally minimal — the parser is a simple regex split so the
// text field stays a plain TypeScript string (no JSX needed in card defs).

const TOKEN_RE = /(\[(?:strength|covert|ranged|tech|instinct|strike|recruit|cost|avengers|x-men|spider-friends|shield|hydra|vp3\*|vp)\]|\n|(?:Fight|Escape|Ambush|Rescue|Recruit|Setup|Evil Wins|Twist(?:\s+\d+-\d+)?|Master Strike):)/g;

/** Matches the trigger keyword tokens emitted by TOKEN_RE. */
const TRIGGER_KW_RE = /^(?:Fight|Escape|Ambush|Rescue|Recruit|Setup|Evil Wins|Twist(?:\s+\d+-\d+)?|Master Strike):$/;

export function CardText({ text, lightBg }: { text: string; lightBg?: boolean }) {
  const parts = text.split(TOKEN_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (part === '\n') return <span key={i} style={{ display: 'block', height: '4px' }} />;
        if (part === '[strike]') {
          return (
            <span key={i} style={{ display: 'inline-block', marginLeft: '3px' }}>
              <StrikeIcon size={15} />
            </span>
          );
        }
        if (part === '[recruit]') {
          return (
            <span key={i} style={{ color: '#A8893E', fontSize: '15px', lineHeight: 1, marginLeft: '3px' }}>★</span>
          );
        }
        if (part === '[avengers]') {
          // Style C — navy circle, faint gold inner ring, serif italic "A"
          return (
            <span key={i} title="Avengers" aria-label="Avengers" style={{ display: 'inline-flex', verticalAlign: 'middle', margin: '0 1px', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="24" fill="#1a3370"/>
                <circle cx="24" cy="24" r="19.5" fill="none" stroke="#f5a623" strokeWidth="1.5" opacity="0.45"/>
                <text x="24" y="34.5" textAnchor="middle" fill="#f5a623" fontSize="30" fontWeight="900" fontFamily="Georgia, serif" fontStyle="italic">A</text>
              </svg>
            </span>
          );
        }
        if (part === '[x-men]') {
          // Style C — red square, black circle ring, bold black X
          return (
            <span key={i} title="X-Men" aria-label="X-Men" style={{ display: 'inline-flex', verticalAlign: 'middle', margin: '0 1px', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 48 48">
                <rect width="48" height="48" rx="7" fill="#b91c1c"/>
                <circle cx="24" cy="24" r="16.5" fill="none" stroke="#000" strokeWidth="2.5"/>
                <line x1="14.5" y1="14.5" x2="33.5" y2="33.5" stroke="#000" strokeWidth="5" strokeLinecap="round"/>
                <line x1="33.5" y1="14.5" x2="14.5" y2="33.5" stroke="#000" strokeWidth="5" strokeLinecap="round"/>
              </svg>
            </span>
          );
        }
        if (part === '[spider-friends]') {
          // Style B — dark red circle, white "S", white border
          return (
            <span key={i} title="Spider-Friends" aria-label="Spider-Friends" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '15px', height: '15px', borderRadius: '50%',
              backgroundColor: '#7f1d1d', color: '#fef2f2',
              border: '1.5px solid #fef2f2',
              fontSize: '7px', fontWeight: 900, fontFamily: '"Arial Black", Arial, sans-serif', lineHeight: 1,
              verticalAlign: 'middle', margin: '0 1px', flexShrink: 0,
            }}>S</span>
          );
        }
        if (part === '[shield]') {
          // Silver circle with ★ — matches the Teams tab badge
          return (
            <span
              key={i}
              title="S.H.I.E.L.D." aria-label="S.H.I.E.L.D."
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '15px', height: '15px', borderRadius: '50%',
                backgroundColor: '#94a3b8', color: '#1e293b',
                fontSize: '7px', fontWeight: 900, lineHeight: 1,
                verticalAlign: 'middle', margin: '0 1px', flexShrink: 0,
              }}
            >★</span>
          );
        }
        if (part === '[hydra]') {
          // Green circle with H — matches HYDRA's team color
          return (
            <span
              key={i}
              title="HYDRA" aria-label="HYDRA"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '15px', height: '15px', borderRadius: '50%',
                backgroundColor: '#16a34a', color: '#fff',
                fontSize: '7px', fontWeight: 900, lineHeight: 1,
                verticalAlign: 'middle', margin: '0 1px', flexShrink: 0,
              }}
            >H</span>
          );
        }
        if (part === '[vp3*]') {
          // Red VP badge with "3*" — reserved for explicit use
          return (
            <span key={i} style={{ display: 'inline-flex', verticalAlign: 'middle', margin: '0 1px', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="17" fill="#b91c1c" stroke="#ef4444" strokeWidth="1.5"/>
                <text x="18" y="23" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="900" fontFamily='"Arial Black", Arial, sans-serif'>3*</text>
              </svg>
            </span>
          );
        }
        if (part === '[vp]') {
          // Plain red VP circle — no number, matches the VP badge on villain cards
          return (
            <span key={i} style={{ display: 'inline-flex', verticalAlign: 'middle', margin: '0 1px', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 32 32">
                <circle cx="16" cy="16" r="15" fill="#b91c1c" stroke="#ef4444" strokeWidth="1.5"/>
              </svg>
            </span>
          );
        }
        if (part === '[cost]') {
          return (
            <span
              key={i}
              title="cost"
              aria-label="cost"
              style={{
                display: 'inline-block',
                width: '11px', height: '11px', borderRadius: '50%',
                backgroundColor: '#7A6330',
                border: '1px solid #A8893E',
                boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
                verticalAlign: 'middle', margin: '0 1px',
                flexShrink: 0,
              }}
            />
          );
        }
        // Trigger keyword labels (Fight:, Escape:, etc.) — rendered bold
        if (TRIGGER_KW_RE.test(part)) {
          return (
            <strong key={i} className={`font-bold ${lightBg ? 'text-white' : 'text-neutral-100'}`}>
              {part}
            </strong>
          );
        }
        const clsMatch = part.match(/^\[(strength|covert|ranged|tech|instinct)\]$/);
        if (clsMatch) {
          const cls = clsMatch[1] as HeroClass;
          return (
            <span
              key={i}
              aria-label={CLASS_LABELS[cls]}
              title={CLASS_LABELS[cls]}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '15px',
                height: '15px',
                verticalAlign: 'middle',
                marginRight: '1px',
                flexShrink: 0,
              }}
            >
              {CLASS_ICONS[cls]}
            </span>
          );
        }
        return <span key={i} className={lightBg ? 'text-white' : 'text-neutral-300'}>{part}</span>;
      })}
    </>
  );
}

// ─── Cost badge ───────────────────────────────────────────────────────────────
/** Amber disc, bottom-right. 20% smaller than the original design. */
export function CostBadge({ cost }: { cost: number }) {
  return (
    <div
      aria-label={`Cost ${cost} recruit`}
      className="absolute bottom-1 right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full font-sans text-[12px] font-bold shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
      style={{
        backgroundColor: '#7A6330',
        border: '1px solid #A8893E',
        color: '#ffffff',
      }}
    >
      {cost}
    </div>
  );
}

// ─── Card art ─────────────────────────────────────────────────────────────────
/**
 * Renders the card visual ONLY — no click, no hover, no affordability state.
 * Caller wraps in <button> for interactivity.
 *
 * Default size is the "in hand" landscape format (h-28 w-48). Pass `wide`
 * to flex the width to its container (useful when slotted into a CSS grid
 * cell like the HQ row).
 */
export function HeroCardArt({
  def,
  wide = false,
  copies,
  height = 'h-[165px]',
  className: extraClassName = '',
  style: extraStyle,
  lightBg = false,
}: {
  def: HeroCardDef;
  /** Stretch width to parent. Used in HQ slots. */
  wide?: boolean;
  /** Copy count from the class definition — drives the rarity corner style.
   *  Rare (1 copy) = sharp corners; common/uncommon = rounded. Omit to default
   *  to rounded (safe for unknown / draft cards). */
  copies?: number;
  /** Card height override. Default h-36; pass h-40 for extra-tall slots. */
  height?: 'h-28' | 'h-32' | 'h-36' | 'h-40' | 'h-[165px]';
  className?: string;
  /** Optional style overrides — use `background` to tint the card body. */
  style?: React.CSSProperties;
  /** Set true when the card has a light background so secondary text stays readable. */
  lightBg?: boolean;
}) {
  const widthClass = wide ? 'w-full' : 'w-[230px]';
  const isShield = isShieldStarter(def.className);
  // Rare (1 copy) cards get sharp corners as a visual rarity signal.
  const corners = copies === 1 ? 'rounded-none' : 'rounded-lg';
  // Auto-shrink the body text so long cards (e.g. Gambit's Hypnotic Charm)
  // don't get clipped by the fixed card height. Steps 12px → 8px until the
  // text stops overflowing its container.
  const textFitRef = useAutoFitFontSize(12, 8, [def.text, height, wide]);

  return (
    <div
      style={{ borderWidth: 2, background: classBg(def.classes), ...classBorderStyle(def.classes, def.className), ...extraStyle }}
      className={`relative flex ${height} ${widthClass} flex-col items-stretch ${corners} p-2 text-left ${extraClassName}`}
    >
      {/* Line 1: [Team icon] [Card name] */}
      <div className="flex items-center gap-1 min-w-0">
        {!isShield && <TeamChip teams={def.teams} />}
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold leading-tight text-neutral-100">
          {def.cardName}
        </span>
      </div>

      {/* Line 2: [Class chips] [Hero class name] */}
      {!isShield && (
        <div className="flex items-center gap-1">
          <ClassChips classes={def.classes} size="sm" />
          <span className={`text-[12px] font-medium ${lightBg ? 'text-white' : 'text-neutral-300'}`}>{def.className}</span>
        </div>
      )}

      {/* Card text — parsed for inline icons via CardText. Font-size is set on
           the container (not the children) so the auto-fit hook can scale it. */}
      {def.text && (
        <div
          ref={textFitRef}
          className="mb-1 flex-1 overflow-hidden pl-3 pr-2 pt-3 leading-snug"
          style={{ fontSize: 12 }}
        >
          <CardText text={def.text} lightBg={lightBg} />
        </div>
      )}

      {/* Stat footer — Recruit first, Strike second. 25% larger than original text-[10px].
           Use !== undefined so 0+ cards (baseAttack/Recruit = 0, …Scales = true) render. */}
      <div className="mt-auto flex gap-2 text-[12px] text-neutral-500">
        {def.baseRecruit !== undefined && (
          <span className="font-semibold">
            <span style={{ color: '#ffffff' }}>{def.baseRecruit}{def.baseRecruitScales ? '+' : ''}</span>
            <span style={{ color: '#A8893E', fontSize: '16px', lineHeight: 1, marginLeft: '2px' }}>★</span>
          </span>
        )}
        {def.baseAttack !== undefined && (
          <span className="font-semibold">
            <span style={{ color: '#ffffff' }}>{def.baseAttack}{def.baseAttackScales ? '+' : ''}</span>
            <span className="ml-1"><StrikeIcon /></span>
          </span>
        )}
      </div>

      {/* Cost badge — 20% smaller than original */}
      <CostBadge cost={def.cost} />
    </div>
  );
}
