// Pure-visual hero card render. Takes a HeroCardDef and produces the card
// exactly as it appears in the live game's hand. Extracted so the sandbox
// preview can't drift from in-game — both code paths render through this.
//
// No interaction props (onClick, disabled) — those are the caller's job. Wrap
// in a <button> if you want a clickable card, leave bare for static preview.

import type { HeroClass, HeroCardDef, Team } from '@/lib/games/legendary';

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
  ranged:   '#3b82f6',  // blue
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
};

/** Team icon chip — shows the first team's monogram, or reserves blank space
 *  so card names stay horizontally aligned across teamless cards. */
export function TeamChip({ teams }: { teams: Team[] }) {
  const firstTeam = teams[0];
  const data = firstTeam ? TEAM_ICON_DATA[firstTeam] : null;

  // Always reserve the same width so card names line up.
  const base = 'flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-sm text-[7px] font-black leading-none';

  if (!data) {
    // Teamless (e.g. Deadpool) — invisible placeholder
    return <div className={base} aria-hidden />;
  }

  return (
    <div
      className={base}
      title={firstTeam}
      aria-label={firstTeam}
      style={{ backgroundColor: data.color, color: data.textColor ?? '#000' }}
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
  const sz = size === 'sm' ? 'h-2.5 w-2.5' : 'h-2 w-2';
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
              className={`inline-block ${sz} rounded-full border border-black/40 shadow-[inset_0_0_2px_rgba(0,0,0,0.4)]`}
              style={{ backgroundColor: CLASS_CHIP_COLORS[c] }}
            />
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

const TOKEN_RE = /(\[(?:strength|covert|ranged|tech|instinct|strike|recruit)\]|\n)/g;

export function CardText({ text, lightBg }: { text: string; lightBg?: boolean }) {
  const parts = text.split(TOKEN_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (part === '\n') return <br key={i} />;
        if (part === '[strike]') {
          return <StrikeIcon key={i} size={13} />;
        }
        if (part === '[recruit]') {
          return (
            <span key={i} style={{ color: '#A8893E', fontSize: '13px', lineHeight: 1 }}>★</span>
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
                display: 'inline-block',
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                backgroundColor: CLASS_CHIP_COLORS[cls],
                border: '1px solid rgba(0,0,0,0.4)',
                verticalAlign: 'middle',
                marginRight: '1px',
              }}
            />
          );
        }
        return <span key={i} className={lightBg ? 'text-neutral-700' : 'text-neutral-300'}>{part}</span>;
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
  height = 'h-40',
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
  height?: 'h-28' | 'h-32' | 'h-36' | 'h-40';
  className?: string;
  /** Optional style overrides — use `background` to tint the card body. */
  style?: React.CSSProperties;
  /** Set true when the card has a light background so secondary text stays readable. */
  lightBg?: boolean;
}) {
  const widthClass = wide ? 'w-full' : 'w-[220px]';
  const isShield = isShieldStarter(def.className);
  // Rare (1 copy) cards get sharp corners as a visual rarity signal.
  const corners = copies === 1 ? 'rounded-none' : 'rounded-lg';

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

      {/* Card text — parsed for inline icons via CardText */}
      {def.text && (
        <div className="my-1 flex-1 px-1 text-[12px] leading-snug">
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
