'use client';

// HeroQuest art kit — self-contained inline SVG components for heroes,
// monsters, furniture, dice, and decorative elements. No external assets.
// Style brief: faithful to the 1989 Stephen Baker / John Blanche art —
// muted earth tones, chunky cardboard-token silhouettes, top-down
// perspective on the board pieces.

import type { CSSProperties } from 'react';
import type React from 'react';
import type { HeroClass, MonsterKind, DieFace } from '@/lib/games/heroquest';

// ============================================================================
// Color palette (faithful to the classic 1989 HeroQuest art)
// ============================================================================

export const HQ_COLORS = {
  // Dungeon stone
  wallDark:  '#1a1814',
  wallMid:   '#2a2620',
  wallLight: '#3a342c',
  mortar:    '#0e0c08',
  // Floor flagstone
  floorDark:  '#3d352a',
  floorMid:   '#4a4035',
  floorLight: '#5c5045',
  // Wood
  woodDark:  '#3d2515',
  woodMid:   '#5b3a1f',
  woodLight: '#8b5a2b',
  iron:      '#3a3a3a',
  ironLight: '#6a6a6a',
  // Lighting
  torchGold:    '#ffb84d',
  torchOrange:  '#e87d2b',
  fog:          '#050505',
  // Hero accent
  heroBlue: '#3b6bc4',
  // Combat
  bloodRed:  '#a01a1a',
  shieldBlue: '#2a4a7a',
} as const;

// ============================================================================
// Tile decorations — used by the board canvas as inline SVG patterns
// ============================================================================

/** Decorative stone-wall SVG fill for a single cell. Drop into the cell
    div as `background-image: url(svgDataUrlOf(<WallTexture />))` OR use as
    an inline component (cleaner for React). */
export function WallTile({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id="wallGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={HQ_COLORS.wallLight} />
          <stop offset="0.5" stopColor={HQ_COLORS.wallMid} />
          <stop offset="1" stopColor={HQ_COLORS.wallDark} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" fill="url(#wallGrad)" />
      {/* Brick courses — two staggered rows */}
      <g stroke={HQ_COLORS.mortar} strokeWidth="1.2">
        <line x1="0" y1="13" x2="40" y2="13" />
        <line x1="0" y1="27" x2="40" y2="27" />
        {/* Vertical mortars - top course */}
        <line x1="12" y1="0" x2="12" y2="13" />
        <line x1="28" y1="0" x2="28" y2="13" />
        {/* Middle course (offset) */}
        <line x1="6"  y1="13" x2="6"  y2="27" />
        <line x1="20" y1="13" x2="20" y2="27" />
        <line x1="34" y1="13" x2="34" y2="27" />
        {/* Bottom course */}
        <line x1="12" y1="27" x2="12" y2="40" />
        <line x1="28" y1="27" x2="28" y2="40" />
      </g>
      {/* Subtle highlights on a few stones */}
      <g fill="none" stroke={HQ_COLORS.wallLight} strokeOpacity="0.25" strokeWidth="0.5">
        <line x1="1" y1="2"  x2="11" y2="2" />
        <line x1="13" y1="14" x2="27" y2="14" />
      </g>
    </svg>
  );
}

/** Floor flagstone tile. `tl`/`br` override the gradient colors (used to give
 *  corridors a light slate and each room its own shade). */
export function FloorTile({ size, variant = 0, tl, br }: { size: number; variant?: number; tl?: string; br?: string }) {
  // Three subtle variants so a tiled floor isn't a flat repeat.
  const variants = [
    { tl: HQ_COLORS.floorLight, br: HQ_COLORS.floorDark },
    { tl: HQ_COLORS.floorMid,   br: HQ_COLORS.floorDark },
    { tl: HQ_COLORS.floorMid,   br: HQ_COLORS.floorMid },
  ];
  const v = variants[variant % variants.length];
  const top = tl ?? v.tl, bot = br ?? v.br;
  // Unique gradient id per color pair so different room shades don't collide.
  const gid = `fl_${top}_${bot}_${variant}`.replace(/[^a-zA-Z0-9_]/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bot} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" fill={`url(#${gid})`} />
      {/* Flagstone cracks — a single L-shape */}
      <g stroke={HQ_COLORS.wallDark} strokeWidth="0.6" fill="none" opacity="0.6">
        <line x1="0"  y1="20" x2="20" y2="20" />
        <line x1="20" y1="20" x2="20" y2="40" />
      </g>
      {/* Tiny speckle for stone texture */}
      <g fill={HQ_COLORS.wallDark} opacity="0.3">
        <circle cx="8"  cy="6"  r="0.5" />
        <circle cx="32" cy="11" r="0.6" />
        <circle cx="14" cy="30" r="0.5" />
        <circle cx="29" cy="34" r="0.7" />
        <circle cx="6"  cy="36" r="0.5" />
      </g>
    </svg>
  );
}

export type FloorStyle = 'flag' | 'brick' | 'checker' | 'diag' | 'cobble' | 'slate' | 'plank' | 'herringbone';

/** A single floor cell rendered as part of a CONTINUOUS pattern (keyed off the
 *  global x/y so adjacent cells join up — no per-cell "box"). Each room picks a
 *  (style, color) so the dungeon floor varies like the printed board. */
export function FloorCell({
  size, gx, gy, style, tl, br,
}: { size: number; gx: number; gy: number; style: FloorStyle; tl: string; br: string }) {
  // Deterministic per-cell hash → stable pseudo-random so a floor doesn't
  // shimmer on rerender but each cell differs subtly.
  const h = (((gx + 7) * 73856093) ^ ((gy + 13) * 19349663)) >>> 0;
  const rnd = (shift: number) => ((h >> (shift * 3)) & 0xff) / 255;
  const S = 40;
  // Soft interior decoration colour (kept faint so it never competes with the
  // crisp per-space grid drawn last).
  const soft = '#000000';
  const parts: React.ReactNode[] = [
    <rect key="base" width={S} height={S} fill={tl} />,
    // hash-driven shade wash so the fill isn't dead flat
    <rect key="wash" width={S} height={S} fill={br} opacity={0.18 + rnd(0) * 0.34} />,
  ];

  // ---- Soft decorative texture per style. These NEVER draw on the cell border
  // (the uniform grid below owns that) so the individual spaces stay legible. ----
  if (style === 'checker') {
    parts.push((gx + gy) % 2 === 0
      ? <rect key="c" width={S} height={S} fill="#ffffff" opacity={0.06} />
      : <rect key="c" width={S} height={S} fill="#000000" opacity={0.11} />);
  } else if (style === 'brick') {
    const off = (gy % 2) * 20;
    parts.push(<g key="g" stroke={soft} strokeOpacity="0.15" strokeWidth="1">
      <line x1="0" y1="20" x2={S} y2="20" />
      <line x1={(off + 0.5) % S} y1="0" x2={(off + 0.5) % S} y2="20" />
      <line x1={(off + 20.5) % S} y1="20" x2={(off + 20.5) % S} y2={S} />
    </g>);
  } else if (style === 'diag') {
    parts.push(<g key="g" stroke={soft} strokeOpacity="0.13" strokeWidth="0.9">
      <line x1="0" y1="0" x2={S} y2={S} />
      <line x1="0" y1={S} x2={S} y2="0" />
    </g>);
  } else if (style === 'cobble') {
    parts.push(<g key="g" stroke="#00000030" strokeWidth="0.9" fill="#ffffff" fillOpacity="0.04">
      <circle cx="11" cy="11" r="8.5" />
      <circle cx="30" cy="12" r="7.5" />
      <circle cx="12" cy="30" r="7.5" />
      <circle cx="30" cy="30" r="8.5" />
    </g>);
  } else if (style === 'plank') {
    parts.push(<g key="g" stroke={soft} strokeOpacity="0.15" strokeWidth="0.9">
      <line x1="0" y1="13.3" x2={S} y2="13.3" />
      <line x1="0" y1="26.6" x2={S} y2="26.6" />
    </g>);
    parts.push(<g key="grain" stroke="#000000" strokeOpacity="0.07" strokeWidth="0.4">
      <line x1="0" y1="6.5" x2={S} y2="6.5" /><line x1="0" y1="20" x2={S} y2="20" /><line x1="0" y1="33" x2={S} y2="33" />
    </g>);
  } else if (style === 'herringbone') {
    parts.push(<g key="g" stroke={soft} strokeOpacity="0.13" strokeWidth="0.8">
      {(gx + gy) % 2 === 0
        ? <><line x1="0" y1="20" x2="20" y2="0" /><line x1="20" y1={S} x2={S} y2="20" /></>
        : <><line x1="0" y1="20" x2="20" y2={S} /><line x1="20" y1="0" x2={S} y2="20" /></>}
    </g>);
  } else if (style === 'slate') {
    // organic irregular cracks — reads as natural stone
    const a = (8 + rnd(2) * 24).toFixed(1), b = (rnd(4) * S).toFixed(1), c = (8 + rnd(6) * 24).toFixed(1);
    parts.push(<path key="crack" d={`M0 ${a} L ${(S * 0.5).toFixed(1)} ${b} L ${S} ${c}`} stroke="#00000040" strokeWidth="0.7" fill="none" />);
    parts.push(<g key="sp" fill="#000" opacity="0.18">
      <circle cx={(rnd(1) * S).toFixed(1)} cy={(rnd(2) * S).toFixed(1)} r="0.6" />
      <circle cx={(rnd(5) * S).toFixed(1)} cy={(rnd(7) * S).toFixed(1)} r="0.5" />
    </g>);
  } else { // 'flag' — subtle top-left bevel highlight only
    parts.push(<line key="hl" x1="1.6" y1="1.6" x2={S - 2} y2="1.6" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="0.8" />);
  }

  // ---- Uniform per-space grid: the SAME crisp boundary on every tile so each
  // square stands out clearly regardless of the room's decorative pattern. ----
  parts.push(<g key="grid" stroke="#000000" strokeOpacity="0.34" strokeWidth="1">
    <line x1="0.5" y1="0" x2="0.5" y2={S} />
    <line x1="0" y1="0.5" x2={S} y2="0.5" />
  </g>);

  return <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }} aria-hidden>{parts}</svg>;
}

/** Stairway tile — chevron of steps with a glow. */
export function StairsTile({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id="stairBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3340" />
          <stop offset="1" stopColor="#171a22" />
        </linearGradient>
        <radialGradient id="stairGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={HQ_COLORS.torchGold} stopOpacity="0.35" />
          <stop offset="1" stopColor={HQ_COLORS.torchGold} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="40" height="40" fill="url(#stairBg)" />
      <rect width="40" height="40" fill="url(#stairGlow)" />
      {/* Steps */}
      <g fill="#4a5a72" stroke="#0a0d14" strokeWidth="0.8">
        <rect x="4"  y="6"  width="32" height="4" />
        <rect x="6"  y="14" width="28" height="4" />
        <rect x="8"  y="22" width="24" height="4" />
        <rect x="10" y="30" width="20" height="4" />
      </g>
    </svg>
  );
}

/** Door tile — wooden plank with iron bands. */
export function DoorTile({ size, open, horizontal }: { size: number; open: boolean; horizontal: boolean }) {
  const W = 40, H = 40;
  // Door shape: thin rectangle along the wall it sits on. Horizontal door
  // (between rooms north/south of a corridor) is a thin horizontal plank.
  // Vertical door (east/west) is a thin vertical plank.
  const planks = horizontal ? (
    <g>
      <rect x="3" y="14" width="34" height="12" fill={open ? HQ_COLORS.woodDark : HQ_COLORS.woodMid} stroke={HQ_COLORS.iron} strokeWidth="1" />
      {/* Iron bands */}
      <rect x="3" y="14" width="34" height="2" fill={HQ_COLORS.iron} />
      <rect x="3" y="24" width="34" height="2" fill={HQ_COLORS.iron} />
      {/* Plank seams */}
      <line x1="14" y1="14" x2="14" y2="26" stroke={HQ_COLORS.woodDark} strokeWidth="0.8" />
      <line x1="26" y1="14" x2="26" y2="26" stroke={HQ_COLORS.woodDark} strokeWidth="0.8" />
      {/* Handle */}
      {!open && <circle cx="20" cy="20" r="1.5" fill={HQ_COLORS.ironLight} />}
    </g>
  ) : (
    <g>
      <rect x="14" y="3" width="12" height="34" fill={open ? HQ_COLORS.woodDark : HQ_COLORS.woodMid} stroke={HQ_COLORS.iron} strokeWidth="1" />
      <rect x="14" y="3" width="2" height="34" fill={HQ_COLORS.iron} />
      <rect x="24" y="3" width="2" height="34" fill={HQ_COLORS.iron} />
      <line x1="14" y1="14" x2="26" y2="14" stroke={HQ_COLORS.woodDark} strokeWidth="0.8" />
      <line x1="14" y1="26" x2="26" y2="26" stroke={HQ_COLORS.woodDark} strokeWidth="0.8" />
      {!open && <circle cx="20" cy="20" r="1.5" fill={HQ_COLORS.ironLight} />}
    </g>
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} aria-hidden>
      {/* Floor underneath (visible through open door) */}
      <rect width="40" height="40" fill={HQ_COLORS.floorDark} />
      {planks}
    </svg>
  );
}

// ============================================================================
// Hero portraits (top-down board tokens, ~28px target size)
// ============================================================================

export function HeroToken({ klass, size, color, ring }: {
  klass: HeroClass;
  size: number;
  color?: string;
  ring?: string;
}) {
  const Render = HERO_RENDERERS[klass];
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }} aria-hidden>
      <defs>
        <radialGradient id={`ringGrad-${klass}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.7" stopColor={ring ?? '#000'} stopOpacity="0" />
          <stop offset="1" stopColor={ring ?? '#000'} stopOpacity="0.8" />
        </radialGradient>
      </defs>
      {/* Base plate */}
      <circle cx="20" cy="20" r="18" fill={color ?? HQ_COLORS.heroBlue} stroke="#0a0d14" strokeWidth="1.5" />
      {ring && <circle cx="20" cy="20" r="19" fill={`url(#ringGrad-${klass})`} />}
      <Render />
    </svg>
  );
}

const BarbarianArt = () => (
  <g>
    {/* Horned helm */}
    <path d="M 10,16 Q 7,8 14,10 Q 20,4 26,10 Q 33,8 30,16 Q 28,18 20,18 Q 12,18 10,16 Z" fill="#5a4a3a" stroke="#1a1408" strokeWidth="0.8" />
    {/* Horns */}
    <path d="M 8,10 Q 4,4 10,4 Q 11,8 12,10" fill="#d6c08a" stroke="#1a1408" strokeWidth="0.6" />
    <path d="M 32,10 Q 36,4 30,4 Q 29,8 28,10" fill="#d6c08a" stroke="#1a1408" strokeWidth="0.6" />
    {/* Face */}
    <ellipse cx="20" cy="21" rx="5" ry="5" fill="#d9a87a" stroke="#1a1408" strokeWidth="0.5" />
    {/* Mouth/beard */}
    <path d="M 16,24 Q 20,28 24,24 L 24,28 Q 20,30 16,28 Z" fill="#3a2a18" />
    {/* Sword across the back */}
    <g transform="translate(20 20) rotate(35)">
      <rect x="-1" y="-16" width="2" height="22" fill="#c4c4c4" stroke="#000" strokeWidth="0.4" />
      <rect x="-4" y="6"  width="8" height="2" fill="#3d2515" />
      <rect x="-1" y="8"  width="2" height="5" fill="#3d2515" />
    </g>
  </g>
);

const DwarfArt = () => (
  <g>
    {/* Helmet */}
    <ellipse cx="20" cy="14" rx="9" ry="5" fill="#4a4a4a" stroke="#0a0a0a" strokeWidth="0.6" />
    <rect x="11" y="14" width="18" height="2" fill="#6a6a6a" />
    {/* Face */}
    <ellipse cx="20" cy="22" rx="5.5" ry="5" fill="#d9a87a" stroke="#1a1408" strokeWidth="0.4" />
    {/* Massive beard */}
    <path d="M 12,22 Q 12,32 20,34 Q 28,32 28,22 Q 24,26 20,25 Q 16,26 12,22 Z" fill="#a05a25" stroke="#3a1a08" strokeWidth="0.5" />
    {/* Eyes */}
    <circle cx="18" cy="20" r="0.5" fill="#1a1408" />
    <circle cx="22" cy="20" r="0.5" fill="#1a1408" />
    {/* Axe head behind */}
    <g transform="translate(20 20) rotate(-25)">
      <rect x="-0.7" y="-14" width="1.4" height="14" fill="#5b3a1f" />
      <path d="M -5,-13 L 0,-15 L 5,-13 L 5,-10 L 0,-8 L -5,-10 Z" fill="#9a9a9a" stroke="#000" strokeWidth="0.4" />
    </g>
  </g>
);

const ElfArt = () => (
  <g>
    {/* Hood / hair */}
    <path d="M 10,16 Q 8,8 20,7 Q 32,8 30,16 L 28,20 L 12,20 Z" fill="#2a5a2a" stroke="#0a1a08" strokeWidth="0.6" />
    {/* Face */}
    <ellipse cx="20" cy="21" rx="4.5" ry="5" fill="#e8c8a8" stroke="#1a1408" strokeWidth="0.4" />
    {/* Pointed ears */}
    <path d="M 15.5,19 L 13,17 L 16,21 Z" fill="#e8c8a8" stroke="#1a1408" strokeWidth="0.3" />
    <path d="M 24.5,19 L 27,17 L 24,21 Z" fill="#e8c8a8" stroke="#1a1408" strokeWidth="0.3" />
    {/* Eyes */}
    <circle cx="18" cy="20" r="0.6" fill="#1a4a1a" />
    <circle cx="22" cy="20" r="0.6" fill="#1a4a1a" />
    {/* Bow */}
    <g transform="translate(20 20) rotate(20)">
      <path d="M -12,-14 Q -8,-3 -12,8" fill="none" stroke="#5b3a1f" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="-11" y1="-13" x2="-11" y2="7" stroke="#d6c08a" strokeWidth="0.4" />
    </g>
  </g>
);

const WizardArt = () => (
  <g>
    {/* Pointed wizard hat */}
    <path d="M 14,16 L 20,2 L 26,16 Z" fill="#3a2a6a" stroke="#0a0418" strokeWidth="0.6" />
    {/* Hat brim */}
    <ellipse cx="20" cy="16" rx="10" ry="2" fill="#2a1a4a" />
    {/* Star on hat */}
    <path d="M 19,9 L 20,7 L 21,9 L 23,9.2 L 21.4,10.4 L 22,12 L 20,11 L 18,12 L 18.6,10.4 L 17,9.2 Z" fill="#ffd84d" />
    {/* Face */}
    <ellipse cx="20" cy="22" rx="4.5" ry="4.5" fill="#e8c8a8" stroke="#1a1408" strokeWidth="0.4" />
    {/* Long white beard */}
    <path d="M 14,23 Q 12,33 20,33 Q 28,33 26,23 Q 22,28 20,26 Q 18,28 14,23 Z" fill="#e8e8e8" stroke="#9a9a9a" strokeWidth="0.4" />
    {/* Eyes */}
    <circle cx="18" cy="21" r="0.5" fill="#1a1408" />
    <circle cx="22" cy="21" r="0.5" fill="#1a1408" />
    {/* Staff */}
    <g transform="translate(20 20) rotate(-15)">
      <rect x="-0.7" y="-16" width="1.4" height="22" fill="#5b3a1f" />
      <circle cx="0" cy="-16" r="2.5" fill="#3a6bc4" stroke="#0a1a40" strokeWidth="0.4" />
    </g>
  </g>
);

const HERO_RENDERERS: Record<HeroClass, () => React.ReactElement> = {
  barbarian: BarbarianArt,
  dwarf:     DwarfArt,
  elf:       ElfArt,
  wizard:    WizardArt,
};

// ============================================================================
// Monster tokens
// ============================================================================

export function MonsterToken({ kind, size, dim }: {
  kind: MonsterKind;
  size: number;
  dim?: boolean;
}) {
  const R = MONSTER_RENDERERS[kind];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ display: 'block', opacity: dim ? 0.5 : 1 }}
      aria-hidden
    >
      {/* Base plate — bloodier red for monsters */}
      <circle cx="20" cy="20" r="18" fill="#5a1a1a" stroke="#1a0808" strokeWidth="1.5" />
      <R />
    </svg>
  );
}

const GoblinArt = () => (
  <g>
    {/* Goblin head: green grinning thing */}
    <ellipse cx="20" cy="22" rx="9" ry="10" fill="#5a8a3a" stroke="#1a3a08" strokeWidth="0.8" />
    {/* Big ears */}
    <path d="M 11,18 L 6,14 L 11,22 Z" fill="#5a8a3a" stroke="#1a3a08" strokeWidth="0.6" />
    <path d="M 29,18 L 34,14 L 29,22 Z" fill="#5a8a3a" stroke="#1a3a08" strokeWidth="0.6" />
    {/* Yellow eyes */}
    <circle cx="17" cy="20" r="1.5" fill="#ffd84d" />
    <circle cx="23" cy="20" r="1.5" fill="#ffd84d" />
    <circle cx="17" cy="20" r="0.6" fill="#000" />
    <circle cx="23" cy="20" r="0.6" fill="#000" />
    {/* Sharp teeth grin */}
    <path d="M 14,26 L 17,28 L 20,26 L 23,28 L 26,26 L 26,28 L 14,28 Z" fill="#fff" stroke="#1a1408" strokeWidth="0.4" />
  </g>
);

const OrcArt = () => (
  <g>
    {/* Bigger meaner orc */}
    <ellipse cx="20" cy="22" rx="10" ry="11" fill="#4a6a2a" stroke="#0a2008" strokeWidth="0.8" />
    {/* Tusks */}
    <path d="M 16,28 L 16,32 L 18,30 Z" fill="#fff" stroke="#1a1408" strokeWidth="0.3" />
    <path d="M 24,28 L 24,32 L 22,30 Z" fill="#fff" stroke="#1a1408" strokeWidth="0.3" />
    {/* Iron helm */}
    <path d="M 10,16 Q 20,8 30,16 L 30,18 Q 20,14 10,18 Z" fill="#3a3a3a" stroke="#0a0a0a" strokeWidth="0.6" />
    {/* Red eyes */}
    <ellipse cx="17" cy="21" rx="1.8" ry="1.2" fill="#d61010" />
    <ellipse cx="23" cy="21" rx="1.8" ry="1.2" fill="#d61010" />
    {/* Mouth */}
    <rect x="16" y="26" width="8" height="1.5" fill="#1a1408" />
  </g>
);

const FimirArt = () => (
  <g>
    {/* Reptilian body */}
    <ellipse cx="20" cy="22" rx="11" ry="11" fill="#3a5a4a" stroke="#0a1a14" strokeWidth="0.8" />
    {/* Single Cyclops eye */}
    <circle cx="20" cy="20" r="3.5" fill="#ffd84d" stroke="#000" strokeWidth="0.5" />
    <ellipse cx="20" cy="20" rx="1.3" ry="2.5" fill="#000" />
    {/* Crocodile-like jaw */}
    <path d="M 12,28 L 28,28 L 26,32 L 14,32 Z" fill="#2a4a3a" stroke="#0a1a08" strokeWidth="0.6" />
    <g stroke="#fff" strokeWidth="0.6">
      <line x1="14" y1="30" x2="14" y2="32" />
      <line x1="17" y1="30" x2="17" y2="32" />
      <line x1="20" y1="30" x2="20" y2="32" />
      <line x1="23" y1="30" x2="23" y2="32" />
      <line x1="26" y1="30" x2="26" y2="32" />
    </g>
    {/* Horns */}
    <path d="M 12,16 L 10,10 L 14,14 Z" fill="#2a3a2a" />
    <path d="M 28,16 L 30,10 L 26,14 Z" fill="#2a3a2a" />
  </g>
);

const SkeletonArt = () => (
  <g>
    <ellipse cx="20" cy="22" rx="9" ry="10" fill="#dac8a8" stroke="#3a2a18" strokeWidth="0.8" />
    {/* Eye sockets */}
    <ellipse cx="17" cy="20" rx="2" ry="2.5" fill="#000" />
    <ellipse cx="23" cy="20" rx="2" ry="2.5" fill="#000" />
    {/* Nose */}
    <path d="M 19,24 L 20,26 L 21,24 Z" fill="#000" />
    {/* Teeth */}
    <rect x="14" y="28" width="12" height="2" fill="#fff" stroke="#3a2a18" strokeWidth="0.3" />
    <line x1="17" y1="28" x2="17" y2="30" stroke="#3a2a18" strokeWidth="0.4" />
    <line x1="20" y1="28" x2="20" y2="30" stroke="#3a2a18" strokeWidth="0.4" />
    <line x1="23" y1="28" x2="23" y2="30" stroke="#3a2a18" strokeWidth="0.4" />
  </g>
);

const ZombieArt = () => (
  <g>
    {/* Grey-green decayed body */}
    <ellipse cx="20" cy="22" rx="10" ry="11" fill="#5a6a4a" stroke="#1a2010" strokeWidth="0.8" />
    {/* Hollow eyes */}
    <circle cx="17" cy="20" r="2" fill="#1a1408" />
    <circle cx="23" cy="20" r="2" fill="#1a1408" />
    <circle cx="17" cy="20" r="0.7" fill="#d61010" />
    <circle cx="23" cy="20" r="0.7" fill="#d61010" />
    {/* Drooling jaw */}
    <path d="M 14,26 L 20,32 L 26,26 L 24,30 L 16,30 Z" fill="#1a1408" />
    <line x1="18" y1="30" x2="18" y2="34" stroke="#5a8a3a" strokeWidth="0.6" />
  </g>
);

const MummyArt = () => (
  <g>
    {/* Wrapped head */}
    <ellipse cx="20" cy="22" rx="10" ry="11" fill="#c8b890" stroke="#5a4a30" strokeWidth="0.8" />
    {/* Bandage wraps — diagonal strips */}
    <g stroke="#9a8a60" strokeWidth="1.2" fill="none">
      <line x1="11" y1="16" x2="29" y2="14" />
      <line x1="10" y1="22" x2="30" y2="20" />
      <line x1="11" y1="28" x2="29" y2="26" />
    </g>
    {/* Glowing eye slit */}
    <rect x="14" y="20" width="12" height="2" fill="#000" />
    <rect x="14" y="20" width="12" height="2" fill="#5a3a0a" />
    <circle cx="17" cy="21" r="0.6" fill="#ffb84d" />
    <circle cx="23" cy="21" r="0.6" fill="#ffb84d" />
  </g>
);

const ChaosWarriorArt = () => (
  <g>
    {/* Dark armored figure */}
    <ellipse cx="20" cy="22" rx="11" ry="11" fill="#1a1a2a" stroke="#0a0a14" strokeWidth="0.8" />
    {/* Spiked helm */}
    <path d="M 10,18 L 14,8 L 16,14 L 20,4 L 24,14 L 26,8 L 30,18 Z" fill="#2a2a3a" stroke="#0a0a14" strokeWidth="0.6" />
    {/* Skull face mask */}
    <ellipse cx="20" cy="22" rx="5" ry="5" fill="#dac8a8" />
    <circle cx="17" cy="22" r="1.5" fill="#000" />
    <circle cx="23" cy="22" r="1.5" fill="#000" />
    <path d="M 18,26 L 20,28 L 22,26 Z" fill="#000" />
    {/* Chaos star */}
    <g stroke="#d61010" strokeWidth="0.6" fill="none">
      <line x1="20" y1="32" x2="20" y2="36" />
      <line x1="18" y1="34" x2="22" y2="34" />
      <line x1="18" y1="32" x2="22" y2="36" />
      <line x1="22" y1="32" x2="18" y2="36" />
    </g>
  </g>
);

const GargoyleArt = () => (
  <g>
    {/* Massive stone body */}
    <ellipse cx="20" cy="22" rx="12" ry="11" fill="#3a3a3a" stroke="#0a0a0a" strokeWidth="0.8" />
    {/* Wings */}
    <path d="M 8,14 Q 2,8 4,18 Q 8,18 12,16 Z" fill="#2a2a2a" stroke="#0a0a0a" strokeWidth="0.6" />
    <path d="M 32,14 Q 38,8 36,18 Q 32,18 28,16 Z" fill="#2a2a2a" stroke="#0a0a0a" strokeWidth="0.6" />
    {/* Horns */}
    <path d="M 13,12 L 11,4 L 15,10 Z" fill="#1a1a1a" stroke="#000" strokeWidth="0.3" />
    <path d="M 27,12 L 29,4 L 25,10 Z" fill="#1a1a1a" stroke="#000" strokeWidth="0.3" />
    {/* Red glowing eyes */}
    <circle cx="16" cy="20" r="2" fill="#d61010" />
    <circle cx="24" cy="20" r="2" fill="#d61010" />
    <circle cx="16" cy="20" r="0.6" fill="#fff" />
    <circle cx="24" cy="20" r="0.6" fill="#fff" />
    {/* Fanged maw */}
    <path d="M 14,26 L 17,30 L 20,28 L 23,30 L 26,26 L 24,28 L 16,28 Z" fill="#fff" stroke="#000" strokeWidth="0.4" />
  </g>
);

const MONSTER_RENDERERS: Record<MonsterKind, () => React.ReactElement> = {
  goblin:        GoblinArt,
  orc:           OrcArt,
  fimir:         FimirArt,
  skeleton:      SkeletonArt,
  zombie:        ZombieArt,
  mummy:         MummyArt,
  chaos_warrior: ChaosWarriorArt,
  gargoyle:      GargoyleArt,
};

// ============================================================================
// Furniture
// ============================================================================

export function FurnitureToken({ kind, size, searched }: {
  kind: 'chest' | 'table' | 'cupboard' | 'rack' | 'bookshelf' | 'throne' | 'tomb' | 'altar' | 'bench' | 'fireplace';
  size: number;
  searched?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ display: 'block', opacity: searched ? 0.55 : 1 }}
      aria-hidden
    >
      {FURN_RENDERERS[kind]()}
    </svg>
  );
}

const ChestArt = () => (
  <g>
    {/* Wooden chest with rounded lid + iron bands */}
    <rect x="6" y="18" width="28" height="16" fill={HQ_COLORS.woodMid} stroke="#0a0408" strokeWidth="0.8" />
    <path d="M 6,18 Q 20,8 34,18 L 34,22 L 6,22 Z" fill={HQ_COLORS.woodLight} stroke="#0a0408" strokeWidth="0.8" />
    <rect x="6"  y="18" width="28" height="2" fill={HQ_COLORS.iron} />
    <rect x="6"  y="32" width="28" height="2" fill={HQ_COLORS.iron} />
    {/* Lock */}
    <rect x="18" y="22" width="4" height="6" fill={HQ_COLORS.ironLight} stroke="#000" strokeWidth="0.4" />
    <circle cx="20" cy="25" r="1" fill="#1a1408" />
  </g>
);

const TableArt = () => (
  <g>
    {/* Rectangle table from above */}
    <rect x="4" y="14" width="32" height="12" fill={HQ_COLORS.woodMid} stroke="#0a0408" strokeWidth="0.8" rx="1" />
    {/* Wood grain */}
    <line x1="4" y1="18" x2="36" y2="18" stroke={HQ_COLORS.woodDark} strokeWidth="0.3" />
    <line x1="4" y1="22" x2="36" y2="22" stroke={HQ_COLORS.woodDark} strokeWidth="0.3" />
    {/* Cup */}
    <circle cx="12" cy="20" r="2" fill="#9a7a5a" stroke="#000" strokeWidth="0.3" />
    {/* Bread loaf */}
    <ellipse cx="26" cy="20" rx="3" ry="2" fill="#c8a060" stroke="#5a3a1a" strokeWidth="0.3" />
  </g>
);

const CupboardArt = () => (
  <g>
    {/* Tall vertical cabinet seen from above */}
    <rect x="8" y="8" width="24" height="24" fill={HQ_COLORS.woodMid} stroke="#0a0408" strokeWidth="0.8" />
    {/* Double doors */}
    <line x1="20" y1="8" x2="20" y2="32" stroke={HQ_COLORS.woodDark} strokeWidth="1" />
    {/* Handles */}
    <circle cx="17" cy="20" r="1" fill={HQ_COLORS.ironLight} />
    <circle cx="23" cy="20" r="1" fill={HQ_COLORS.ironLight} />
    {/* Drawer top */}
    <rect x="8" y="8" width="24" height="3" fill={HQ_COLORS.woodLight} />
  </g>
);

const RackArt = () => (
  <g>
    {/* Weapons rack */}
    <rect x="6" y="6" width="28" height="28" fill="none" stroke={HQ_COLORS.woodMid} strokeWidth="1" />
    {/* Top + bottom rails */}
    <rect x="6" y="6"  width="28" height="2" fill={HQ_COLORS.woodMid} />
    <rect x="6" y="32" width="28" height="2" fill={HQ_COLORS.woodMid} />
    {/* Hanging weapons */}
    <line x1="12" y1="8" x2="12" y2="30" stroke="#888" strokeWidth="1" />
    <line x1="20" y1="8" x2="20" y2="30" stroke="#888" strokeWidth="1" />
    <line x1="28" y1="8" x2="28" y2="30" stroke="#888" strokeWidth="1" />
    {/* Weapon heads */}
    <polygon points="11,8 13,8 12,4" fill="#9a9a9a" stroke="#000" strokeWidth="0.3" />
    <polygon points="19,8 21,8 20,4" fill="#9a9a9a" stroke="#000" strokeWidth="0.3" />
    <polygon points="27,8 29,8 28,4" fill="#9a9a9a" stroke="#000" strokeWidth="0.3" />
  </g>
);

const BookshelfArt = () => (
  <g>
    <rect x="6" y="6" width="28" height="28" fill={HQ_COLORS.woodDark} stroke="#0a0408" strokeWidth="0.8" />
    {/* Shelves */}
    <line x1="6" y1="15" x2="34" y2="15" stroke={HQ_COLORS.woodLight} strokeWidth="1" />
    <line x1="6" y1="24" x2="34" y2="24" stroke={HQ_COLORS.woodLight} strokeWidth="1" />
    {/* Books — colored spines */}
    {[6, 9, 12, 15, 18, 21, 24, 27, 30].map((x, i) => (
      <rect key={i} x={x} y={8} width={2.5} height={6} fill={['#a02020', '#205070', '#208030', '#a07020', '#702070'][i % 5]} />
    ))}
    {[6, 9, 12, 15, 18, 21, 24, 27, 30].map((x, i) => (
      <rect key={`b-${i}`} x={x} y={17} width={2.5} height={6} fill={['#205070', '#a07020', '#a02020', '#702070', '#208030'][i % 5]} />
    ))}
  </g>
);

const ThroneArt = () => (
  <g>
    {/* High-backed throne from above */}
    <rect x="10" y="6" width="20" height="6" fill={HQ_COLORS.woodLight} stroke="#0a0408" strokeWidth="0.6" />
    <rect x="10" y="12" width="20" height="20" fill={HQ_COLORS.woodMid} stroke="#0a0408" strokeWidth="0.6" />
    <circle cx="20" cy="22" r="4" fill="#a02020" stroke="#000" strokeWidth="0.4" />
    {/* Gold trim */}
    <line x1="10" y1="14" x2="30" y2="14" stroke="#ffd84d" strokeWidth="0.6" />
  </g>
);

const TombArt = () => (
  <g>
    {/* Stone sarcophagus from above */}
    <rect x="6" y="8" width="28" height="24" fill="#5a5a5a" stroke="#0a0a0a" strokeWidth="0.8" />
    {/* Carved figure */}
    <ellipse cx="20" cy="14" rx="5" ry="3" fill="#3a3a3a" />
    <rect x="17" y="17" width="6" height="10" fill="#3a3a3a" />
    {/* Cross etching */}
    <line x1="20" y1="20" x2="20" y2="26" stroke="#1a1a1a" strokeWidth="0.6" />
    <line x1="18" y1="23" x2="22" y2="23" stroke="#1a1a1a" strokeWidth="0.6" />
    {/* Highlight */}
    <line x1="6" y1="10" x2="34" y2="10" stroke="#9a9a9a" strokeWidth="0.6" />
  </g>
);

const AltarArt = () => (
  <g>
    <rect x="6" y="14" width="28" height="16" fill="#3a3a3a" stroke="#0a0a0a" strokeWidth="0.8" />
    <rect x="6" y="14" width="28" height="3" fill="#5a5a5a" />
    {/* Pentagram */}
    <g stroke="#d61010" strokeWidth="0.7" fill="none">
      <circle cx="20" cy="22" r="5" />
      <path d="M 20,17 L 24,25 L 16,21 L 24,21 L 16,25 Z" />
    </g>
  </g>
);

const BenchArt = () => (
  <g>
    {/* Alchemy / workbench */}
    <rect x="4" y="14" width="32" height="12" fill={HQ_COLORS.woodMid} stroke="#0a0408" strokeWidth="0.8" />
    {/* Bottles */}
    <rect x="8"  y="10" width="3" height="6" fill="#10a070" stroke="#000" strokeWidth="0.3" />
    <rect x="14" y="9"  width="3" height="7" fill="#a01070" stroke="#000" strokeWidth="0.3" />
    <rect x="20" y="10" width="3" height="6" fill="#1070a0" stroke="#000" strokeWidth="0.3" />
    <rect x="26" y="9"  width="3" height="7" fill="#a07010" stroke="#000" strokeWidth="0.3" />
  </g>
);

const FireplaceArt = () => (
  <g>
    {/* Stone hearth */}
    <rect x="6" y="6" width="28" height="28" fill="#3a3a3a" stroke="#0a0a0a" strokeWidth="0.8" />
    {/* Opening */}
    <rect x="12" y="14" width="16" height="18" fill="#1a0808" />
    {/* Flames */}
    <path d="M 14,32 Q 16,22 18,28 Q 20,18 22,26 Q 24,20 26,30 L 26,32 Z" fill="#ff8030" />
    <path d="M 15,32 Q 17,26 19,30 Q 21,22 23,28 Q 25,24 26,32 Z" fill="#ffd84d" />
    {/* Hood */}
    <path d="M 6,14 L 12,14 L 12,8 L 28,8 L 28,14 L 34,14 L 34,6 L 6,6 Z" fill="#4a4a4a" stroke="#0a0a0a" strokeWidth="0.4" />
  </g>
);

const FURN_RENDERERS: Record<string, () => React.ReactElement> = {
  chest:      ChestArt,
  table:      TableArt,
  cupboard:   CupboardArt,
  rack:       RackArt,
  bookshelf:  BookshelfArt,
  throne:     ThroneArt,
  tomb:       TombArt,
  altar:      AltarArt,
  bench:      BenchArt,
  fireplace:  FireplaceArt,
};

// ============================================================================
// Combat dice — big chunky 3D-ish faces with skull / white shield / black shield
// ============================================================================

export function CombatDie({ face, size = 48, rolling }: {
  face: DieFace | null;
  size?: number;
  rolling?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        perspective: '200px',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          transition: rolling ? 'transform 0.4s ease-out' : undefined,
          transform: rolling ? `rotateX(${360 + Math.random() * 360}deg) rotateY(${360 + Math.random() * 360}deg)` : undefined,
        }}
      >
        <DieFaceArt face={face} size={size} />
      </div>
    </div>
  );
}

function DieFaceArt({ face, size }: { face: DieFace | null; size: number }) {
  const bg = face === 'black_shield' ? '#1a1a1a' : '#f3eada';
  const fg = face === 'black_shield' ? '#f3eada' : '#1a1a1a';
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" style={{ display: 'block' }} aria-label={face ?? 'die'}>
      <defs>
        <linearGradient id="diefaceBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bg} stopOpacity="1" />
          <stop offset="1" stopColor={bg} stopOpacity="0.8" />
        </linearGradient>
        <filter id="dieshadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodOpacity="0.4" />
        </filter>
      </defs>
      <rect
        x="2" y="2" width="46" height="46" rx="6"
        fill="url(#diefaceBg)"
        stroke="#0a0a0a"
        strokeWidth="2"
        filter="url(#dieshadow)"
      />
      {face === 'skull' && (
        <g transform="translate(25 26) scale(0.7)" fill={fg}>
          {/* Skull silhouette */}
          <ellipse cx="0" cy="-2" rx="14" ry="13" />
          <ellipse cx="-5" cy="0" rx="3.5" ry="4.5" fill={bg} />
          <ellipse cx="5"  cy="0" rx="3.5" ry="4.5" fill={bg} />
          <polygon points="-2,4 2,4 0,9" fill={bg} />
          <rect x="-8" y="8" width="16" height="6" fill={fg} />
          <line x1="-5" y1="8" x2="-5" y2="14" stroke={bg} strokeWidth="1.5" />
          <line x1="0"  y1="8" x2="0"  y2="14" stroke={bg} strokeWidth="1.5" />
          <line x1="5"  y1="8" x2="5"  y2="14" stroke={bg} strokeWidth="1.5" />
        </g>
      )}
      {(face === 'white_shield' || face === 'black_shield') && (
        <g transform="translate(25 24)" fill={fg}>
          {/* Shield silhouette */}
          <path d="M 0,-14 Q 12,-14 12,-6 Q 12,8 0,16 Q -12,8 -12,-6 Q -12,-14 0,-14 Z" />
          <path d="M 0,-12 Q 10,-12 10,-5 Q 10,7 0,13 Q -10,7 -10,-5 Q -10,-12 0,-12 Z" fill={bg} />
          {/* Inner emblem (cross) */}
          <rect x="-1.2" y="-8" width="2.4" height="14" fill={fg} />
          <rect x="-5" y="-3" width="10" height="2.4" fill={fg} />
        </g>
      )}
      {!face && (
        <text x="25" y="32" textAnchor="middle" fontSize="20" fill={fg} fontFamily="serif">?</text>
      )}
    </svg>
  );
}

// ============================================================================
// Decorative borders & icons
// ============================================================================

/** Small heart for BP display. */
export function HeartIcon({ size = 14, filled = true }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 21s-7-4.35-9.5-9.5C.66 7.65 3 4 7 4c2 0 3.5 1.2 5 3 1.5-1.8 3-3 5-3 4 0 6.34 3.65 4.5 7.5C19 16.65 12 21 12 21z"
        fill={filled ? '#d61010' : 'none'}
        stroke="#3a0808"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Small brain icon for MP display. */
export function MindIcon({ size = 14, filled = true }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M9 3a4 4 0 0 0-4 4v2a3 3 0 0 0-3 3v2a3 3 0 0 0 3 3v2a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-2a3 3 0 0 0 3-3v-2a3 3 0 0 0-3-3V7a4 4 0 0 0-4-4H9z"
        fill={filled ? '#a040d0' : 'none'}
        stroke="#3a0840"
        strokeWidth="1.4"
      />
      <path d="M9 9c1 2 5 2 6 0" stroke="#3a0840" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

/** Decorative coin icon. */
export function CoinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#ffd84d" stroke="#7a5a08" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="7"  fill="none" stroke="#7a5a08" strokeWidth="0.8" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#7a5a08" fontFamily="serif">G</text>
    </svg>
  );
}

/** Sword icon for the attack stat. */
export function SwordIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M14 2l8 8-2 2-2-2-9 9-3-3 9-9-2-2 1-3z" fill="#dcdcdc" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M5 17l-2 4 4-2 1-1-2-2z" fill="#9a7a5a" stroke="#3a2a18" strokeWidth="1" />
      <path d="M14 2l1-1 1 1-1 1z" fill="#ff8030" />
    </svg>
  );
}

/** Shield icon for the defense stat. */
export function ShieldIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2L4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z" fill="#3b6bc4" stroke="#0a1a40" strokeWidth="1.4" />
      <path d="M12 6v12" stroke="#ffd84d" strokeWidth="1.5" />
      <path d="M7 12h10" stroke="#ffd84d" strokeWidth="1.5" />
    </svg>
  );
}

/** Hand-drawn fleur-de-lis used as a section divider on the character sheet. */
export function FleurDivider({ width = 200 }: { width?: number }) {
  return (
    <svg width={width} height={12} viewBox="0 0 200 12" aria-hidden>
      <line x1="0"   y1="6" x2="85"  y2="6" stroke="#7a5a08" strokeWidth="1" />
      <line x1="115" y1="6" x2="200" y2="6" stroke="#7a5a08" strokeWidth="1" />
      <path d="M 100,2 Q 96,6 100,10 Q 104,6 100,2 M 96,6 Q 100,4 104,6 Q 100,8 96,6" fill="#7a5a08" />
    </svg>
  );
}

// Suppress unused-style warnings (style prop is used in CombatDie when rolling).
export type _StyleAck = CSSProperties;
