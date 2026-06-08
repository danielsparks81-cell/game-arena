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
  // Hero accent — deep navy base for tokens (less cartoonish than bright blue)
  heroBlue: '#1c2e4a',
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

/** Classic HeroQuest spiral-staircase fan — concentric stone step-bands radiating
 *  from the top-left corner over the whole w×h area (a 2×2 space drawn as one
 *  staircase, not four tiles). Returns SVG elements so it can fill a standalone
 *  <svg> (the editor/board overlay) or be dropped into an existing one (gallery). */
export function stairsFanEls(w: number, h: number): React.ReactNode[] {
  const R = Math.hypot(w, h);     // reach the far corner
  const n = 7;                    // number of steps
  const els: React.ReactNode[] = [
    <rect key="base" width={w} height={h} fill="#5b636e" />,
    <rect key="base2" width={w} height={h} fill="#262b32" opacity="0.4" />,
  ];
  for (let i = 0; i < n; i++) {
    const ro = (R * (n - i)) / n, ri = (R * (n - i - 1)) / n;
    els.push(
      <path
        key={`step${i}`}
        d={`M ${ro} 0 A ${ro} ${ro} 0 0 1 0 ${ro} L 0 ${ri} A ${ri} ${ri} 0 0 0 ${ri} 0 Z`}
        fill={i % 2 === 0 ? '#aab2bd' : '#828b96'}
        stroke="#3a4049"
        strokeWidth={Math.max(0.5, R * 0.007)}
      />,
    );
  }
  // warm landing glow at the foot of the stairs (far corner)
  els.push(<circle key="glow" cx={w} cy={h} r={R * 0.28} fill={HQ_COLORS.torchGold} opacity="0.18" />);
  return els;
}

/** The fan as a standalone tile (for an absolute-positioned overlay). */
export function StairsFan({ w, h }: { w: number; h: number }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }} aria-hidden>
      {stairsFanEls(w, h)}
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

// Dark silhouette style — bold shapes readable at 28 px, one accent colour each.
// Base fill is near-black; accent = the ONE coloured feature that identifies the character.

const BarbarianArt = () => (
  <g>
    {/* Horns — gold/bone, the most distinctive silhouette feature */}
    <path d="M 12,17 Q 5,3 10,2 Q 14,7 15,14" fill="#c8a042" />
    <path d="M 28,17 Q 35,3 30,2 Q 26,7 25,14" fill="#c8a042" />
    {/* Helm dome */}
    <path d="M 12,18 Q 12,8 20,8 Q 28,8 28,18 Q 24,21 20,21 Q 16,21 12,18 Z" fill="#0f0d08" />
    {/* Helm brim */}
    <rect x="11" y="18" width="18" height="2.5" rx="1" fill="#0a0907" />
    {/* Nasal guard */}
    <rect x="19" y="15" width="2" height="6" rx="0.5" fill="#080706" />
    {/* Face shadow */}
    <ellipse cx="20" cy="24" rx="5" ry="4.5" fill="#0f0d08" />
    {/* Beard mass */}
    <path d="M 15,25 Q 13,36 20,37 Q 27,36 25,25 Q 22,29 20,28 Q 18,29 15,25 Z" fill="#0a0907" />
    {/* Shoulders */}
    <path d="M 7,39 Q 9,27 20,26 Q 31,27 33,39 Z" fill="#0a0907" />
    {/* Sword pommel at right shoulder */}
    <rect x="29" y="20" width="2" height="10" rx="1" fill="#6a6a7a" />
    <rect x="26" y="24" width="8" height="2" rx="0.5" fill="#6a6a7a" />
  </g>
);

const DwarfArt = () => (
  <g>
    {/* Iron helm dome */}
    <path d="M 11,17 Q 11,8 20,8 Q 29,8 29,17 L 27,20 Q 20,21 13,20 Z" fill="#0f0f0f" />
    {/* Cheek guards + helm brim */}
    <path d="M 11,17 L 12,23 L 16,21 Q 20,22 24,21 L 28,23 L 29,17" fill="#0a0a0a" />
    {/* Nasal bar */}
    <rect x="19.2" y="14" width="1.6" height="8" fill="#080808" />
    {/* Amber fire eyes beneath helm */}
    <ellipse cx="16" cy="17" rx="1.8" ry="1.2" fill="#c05010" />
    <ellipse cx="24" cy="17" rx="1.8" ry="1.2" fill="#c05010" />
    {/* Massive beard — defines the silhouette */}
    <path d="M 11,22 Q 8,38 20,39 Q 32,38 29,22 Q 25,30 20,27 Q 15,30 11,22 Z" fill="#1a1208" />
    {/* Beard shaping crease */}
    <path d="M 13,27 Q 17,33 20,31 Q 23,33 27,27" fill="none" stroke="#0f0c08" strokeWidth="1.2" />
    {/* Short stocky body */}
    <path d="M 9,30 Q 10,24 13,22 L 13,39 L 27,39 L 27,22 Q 30,24 31,30 L 32,39 Q 20,40 8,39 Z" fill="#0f0f0f" />
    {/* Axe shaft */}
    <rect x="27.5" y="11" width="1.8" height="14" rx="0.9" fill="#1a1006" />
    {/* Axe blade — silver accent */}
    <path d="M 28.5,10 Q 36,7 37,14 Q 36,20 28.5,17 Z" fill="#9a9aaa" />
  </g>
);

const ElfArt = () => (
  <g>
    {/* Dark hood */}
    <path d="M 12,20 Q 11,7 20,6 Q 29,7 28,20 L 26,23 L 14,23 Z" fill="#121e0a" />
    {/* Hood inner shadow */}
    <path d="M 14,23 Q 14,19 20,18 Q 26,19 26,23 Z" fill="#0a1407" />
    {/* Pointed ears */}
    <path d="M 14,19 L 10,14 L 13,22 Z" fill="#b89060" />
    <path d="M 26,19 L 30,14 L 27,22 Z" fill="#b89060" />
    {/* Face */}
    <ellipse cx="20" cy="23" rx="5" ry="5.5" fill="#121e0a" />
    {/* Vivid green eyes — the accent */}
    <ellipse cx="17.5" cy="22" rx="1.8" ry="1.3" fill="#20a020" />
    <ellipse cx="22.5" cy="22" rx="1.8" ry="1.3" fill="#20a020" />
    <circle cx="17.5" cy="22" r="0.7" fill="#050805" />
    <circle cx="22.5" cy="22" r="0.7" fill="#050805" />
    {/* Body */}
    <path d="M 10,39 Q 12,27 20,25 Q 28,27 30,39 Z" fill="#121e0a" />
    {/* Bow arc — dark wood */}
    <path d="M 30,9 Q 38,20 32,33" fill="none" stroke="#1e1008" strokeWidth="3.5" strokeLinecap="round" />
    {/* Bow string — gold glint */}
    <line x1="30" y1="10" x2="32" y2="32" stroke="#c0a030" strokeWidth="0.8" strokeOpacity="0.9" />
  </g>
);

const WizardArt = () => (
  <g>
    {/* Tall pointed hat — very distinctive silhouette */}
    <path d="M 14,18 L 20,2 L 26,18 Z" fill="#0c0820" />
    <ellipse cx="20" cy="18" rx="10" ry="2.5" fill="#14102a" />
    {/* Star accent — gold */}
    <path d="M20,7 L21.3,10.2 L24.5,10.2 L22,12.2 L23,15 L20,13.2 L17,15 L18,12.2 L15.5,10.2 L18.7,10.2 Z" fill="#ffe040" />
    {/* Face */}
    <ellipse cx="20" cy="24" rx="4.5" ry="5" fill="#0c0820" />
    {/* Aged eyes */}
    <ellipse cx="17.5" cy="23" rx="1.3" ry="1" fill="#3a50a0" />
    <ellipse cx="22.5" cy="23" rx="1.3" ry="1" fill="#3a50a0" />
    {/* Long white beard */}
    <path d="M 15,26 Q 13,38 20,39 Q 27,38 25,26 Q 22,31 20,30 Q 18,31 15,26 Z" fill="#c0c0c0" />
    {/* Robes */}
    <path d="M 10,39 Q 12,30 20,28 Q 28,30 30,39 Z" fill="#0c0820" />
    {/* Staff */}
    <rect x="27.5" y="16" width="2.5" height="23" rx="1" fill="#1a1008" />
    {/* Orb — glowing blue accent */}
    <circle cx="28.8" cy="14" r="3.5" fill="#1030a0" />
    <circle cx="27.3" cy="12.5" r="1.3" fill="#6090ff" fillOpacity="0.85" />
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
      {/* Base plate — deep blood red for monsters */}
      <circle cx="20" cy="20" r="18" fill="#2a0808" stroke="#160404" strokeWidth="1.5" />
      <R />
    </svg>
  );
}

const GoblinArt = () => (
  <g>
    {/* Wide pointy ears — widest silhouette feature */}
    <path d="M 10,18 Q 3,9 7,7 Q 10,12 13,17 Z" fill="#0d1208" />
    <path d="M 30,18 Q 37,9 33,7 Q 30,12 27,17 Z" fill="#0d1208" />
    {/* Head */}
    <ellipse cx="20" cy="21" rx="10" ry="10" fill="#0d1208" />
    {/* Brow ridge */}
    <path d="M 12,18 Q 20,15 28,18" fill="none" stroke="#080c06" strokeWidth="1.5" />
    {/* Sulfur-yellow eyes */}
    <ellipse cx="16.5" cy="20" rx="2.8" ry="2.2" fill="#b0a000" />
    <ellipse cx="23.5" cy="20" rx="2.8" ry="2.2" fill="#b0a000" />
    <ellipse cx="16.5" cy="20" rx="1.3" ry="1.6" fill="#060806" />
    <ellipse cx="23.5" cy="20" rx="1.3" ry="1.6" fill="#060806" />
    {/* Wide grin + jagged teeth */}
    <path d="M 13,25 Q 20,30 27,25" fill="#060806" />
    <path d="M 14,25 L 15,28 L 17,25 L 19,27 L 21,25 L 23,27 L 25,25 L 26,28 L 27,25"
          fill="none" stroke="#c8c8a0" strokeWidth="0.9" />
    {/* Scrawny body */}
    <path d="M 12,39 Q 13,30 20,29 Q 27,30 28,39 Z" fill="#0a0e07" />
    {/* Dagger */}
    <path d="M 26,29 L 32,22 L 33,23 L 27,31 Z" fill="#7a7a88" />
  </g>
);

const OrcArt = () => (
  <g>
    {/* Iron helm */}
    <path d="M 10,18 Q 10,8 20,8 Q 30,8 30,18 L 28,21 Q 20,22 12,21 Z" fill="#0a0a0a" />
    {/* Helm brim */}
    <path d="M 10,18 L 11,21 L 29,21 L 30,18" fill="#070707" />
    {/* Nasal guard */}
    <rect x="19.2" y="14" width="1.6" height="8" fill="#060606" />
    {/* Blood-red eyes */}
    <ellipse cx="16" cy="17.5" rx="2" ry="1.5" fill="#b81010" />
    <ellipse cx="24" cy="17.5" rx="2" ry="1.5" fill="#b81010" />
    <circle cx="16" cy="17.5" r="0.7" fill="#040404" />
    <circle cx="24" cy="17.5" r="0.7" fill="#040404" />
    {/* Heavy jaw */}
    <path d="M 12,21 Q 12,32 20,33 Q 28,32 28,21 Q 24,26 20,24 Q 16,26 12,21 Z" fill="#0a0a0a" />
    {/* Tusks */}
    <path d="M 16,29 L 14,35 L 18,33 Z" fill="#d0d0b8" />
    <path d="M 24,29 L 26,35 L 22,33 Z" fill="#d0d0b8" />
    {/* Heavy body */}
    <path d="M 7,39 Q 9,27 20,26 Q 31,27 33,39 Z" fill="#0a0a0a" />
  </g>
);

const AbominationArt = () => (
  <g>
    {/* Lumpy asymmetric body outline */}
    <path d="M 7,22 Q 5,10 12,7 Q 18,5 22,7 Q 28,5 32,11 Q 37,17 34,25 Q 33,35 24,37 Q 16,38 11,33 Q 6,29 7,22 Z" fill="#0d100a" />
    {/* Lumpy growths */}
    <circle cx="10" cy="14" r="3" fill="#0f1208" />
    <circle cx="31" cy="19" r="3.5" fill="#0c0e0a" />
    {/* Big eye — left, the defining feature */}
    <circle cx="15" cy="18" r="4.5" fill="#090c08" />
    <circle cx="15" cy="18" r="3" fill="#98b808" fillOpacity="0.75" />
    <circle cx="15" cy="18" r="1.2" fill="#050705" />
    {/* Small eye — right, asymmetric */}
    <circle cx="26" cy="21" r="2.8" fill="#090c08" />
    <circle cx="26" cy="21" r="1.8" fill="#98b808" fillOpacity="0.65" />
    <circle cx="26" cy="21" r="0.7" fill="#050705" />
    {/* Gaping maw */}
    <path d="M 11,27 Q 20,33 29,28" fill="#080808" />
    <path d="M 12,27 L 13,30 L 15,27 L 17,30 L 19,27 L 21,29 L 23,27 L 25,30 L 27,27"
          fill="none" stroke="#c8c8a0" strokeWidth="0.9" />
    {/* Claw arm */}
    <path d="M 7,25 Q 1,23 0,28 Q 3,27 7,27 Z" fill="#0d100a" />
    <path d="M 0,28 L -2,26 M 0,28 L -1,31 M 0,28 L 2,30" stroke="#8a8a70" strokeWidth="1.2" strokeLinecap="round" />
  </g>
);

const SkeletonArt = () => (
  <g>
    {/* Cranium */}
    <ellipse cx="20" cy="17" rx="9.5" ry="10.5" fill="#0f0f0f" />
    {/* Eye sockets — large, defining feature */}
    <ellipse cx="15.5" cy="16" rx="3.5" ry="3.2" fill="#060606" />
    <ellipse cx="24.5" cy="16" rx="3.5" ry="3.2" fill="#060606" />
    {/* Pale bone glow in sockets */}
    <ellipse cx="15.5" cy="16" rx="2" ry="1.8" fill="#c8c8a0" fillOpacity="0.3" />
    <ellipse cx="24.5" cy="16" rx="2" ry="1.8" fill="#c8c8a0" fillOpacity="0.3" />
    {/* Nasal void */}
    <path d="M 18.5,21 L 20,23.5 L 21.5,21 Z" fill="#060606" />
    {/* Jaw */}
    <rect x="12" y="24" width="16" height="7" rx="2" fill="#0f0f0f" />
    {/* Teeth — bone white, very visible */}
    <rect x="13" y="25" width="2.5" height="4.5" rx="0.5" fill="#c8c8a0" />
    <rect x="16.5" y="25" width="2.5" height="4.5" rx="0.5" fill="#c8c8a0" />
    <rect x="20" y="25" width="2.5" height="4.5" rx="0.5" fill="#c8c8a0" />
    <rect x="23.5" y="25" width="2.5" height="4.5" rx="0.5" fill="#c8c8a0" />
    {/* Body */}
    <path d="M 12,31 Q 12,39 20,40 Q 28,39 28,31 Z" fill="#0f0f0f" />
  </g>
);

const ZombieArt = () => (
  <g>
    {/* Head */}
    <ellipse cx="20" cy="19" rx="9" ry="10" fill="#0d0d0a" />
    {/* Sunken eye sockets */}
    <ellipse cx="15.5" cy="18" rx="2.8" ry="2.3" fill="#0a0a08" />
    <ellipse cx="24.5" cy="18" rx="2.8" ry="2.3" fill="#0a0a08" />
    {/* Dull red pupils */}
    <circle cx="15.5" cy="18" r="1.2" fill="#900808" fillOpacity="0.7" />
    <circle cx="24.5" cy="18" r="1.2" fill="#900808" fillOpacity="0.7" />
    {/* Slack jaw */}
    <path d="M 13,22 Q 13,30 20,30 Q 27,30 27,22 Q 23,26 20,25 Q 17,26 13,22 Z" fill="#0d0d0a" />
    {/* Body */}
    <path d="M 8,39 Q 10,29 20,28 Q 30,29 32,39 Z" fill="#0d0d0a" />
    {/* Reaching arm */}
    <path d="M 9,27 Q 3,23 2,18 Q 5,21 9,26 Z" fill="#0a0a08" />
    {/* Fingers */}
    <path d="M 2,18 L 0,16 M 2,18 L 1,21 M 2,18 L 4,20" stroke="#0a0a08" strokeWidth="1.4" strokeLinecap="round" />
  </g>
);

const MummyArt = () => (
  <g>
    {/* Stiff wrapped head */}
    <ellipse cx="20" cy="19" rx="9" ry="10" fill="#1a1408" />
    {/* Horizontal bandage wrap lines */}
    <line x1="11" y1="12" x2="29" y2="12" stroke="#262010" strokeWidth="1.6" />
    <line x1="11" y1="15.5" x2="29" y2="15.5" stroke="#262010" strokeWidth="1.6" />
    <line x1="11" y1="19" x2="29" y2="19" stroke="#262010" strokeWidth="1.6" />
    <line x1="11" y1="22.5" x2="29" y2="22.5" stroke="#262010" strokeWidth="1.6" />
    {/* Eye slit — amber glow accent */}
    <rect x="13" y="16" width="14" height="3" rx="1" fill="#0a0808" />
    <rect x="13.5" y="16.3" width="13" height="2.4" fill="#c07808" fillOpacity="0.7" />
    {/* Rigid body */}
    <path d="M 11,29 Q 11,39 20,40 Q 29,39 29,29 L 29,25 Q 20,27 11,25 Z" fill="#1a1408" />
    {/* Body wraps */}
    <line x1="11" y1="30" x2="29" y2="30" stroke="#262010" strokeWidth="1.6" />
    <line x1="11" y1="34" x2="29" y2="34" stroke="#262010" strokeWidth="1.6" />
    {/* Outstretched arm */}
    <path d="M 11,25 Q 5,24 4,28 Q 7,29 11,27 Z" fill="#1a1408" />
    <line x1="11" y1="26" x2="5" y2="25" stroke="#262010" strokeWidth="1.4" />
  </g>
);

const DreadWarriorArt = () => (
  <g>
    {/* Full plate helm — imposing, angular */}
    <path d="M 10,20 Q 10,7 20,7 Q 30,7 30,20 L 28,23 Q 20,25 12,23 Z" fill="#080808" />
    {/* Helm horns */}
    <path d="M 12,13 Q 8,4 12,3 Q 14,7 14,13" fill="#0c0c0c" />
    <path d="M 28,13 Q 32,4 28,3 Q 26,7 26,13" fill="#0c0c0c" />
    {/* Visor slot */}
    <rect x="12" y="17" width="16" height="3.5" rx="0.5" fill="#050505" />
    {/* Red glowing eyes — two bright slits */}
    <rect x="12.5" y="17.5" width="6" height="2.5" rx="0.5" fill="#cc0000" fillOpacity="0.95" />
    <rect x="21.5" y="17.5" width="6" height="2.5" rx="0.5" fill="#cc0000" fillOpacity="0.95" />
    {/* Face plate center bar */}
    <rect x="19.5" y="15" width="1" height="7" fill="#040404" />
    {/* Massive armored body */}
    <path d="M 6,39 Q 8,25 20,24 Q 32,25 34,39 Z" fill="#080808" />
    {/* Pauldrons */}
    <ellipse cx="9" cy="27" rx="5.5" ry="4" fill="#0c0c0c" />
    <ellipse cx="31" cy="27" rx="5.5" ry="4" fill="#0c0c0c" />
    {/* Sword */}
    <rect x="30" y="13" width="2.5" height="20" rx="1" fill="#282830" />
    <rect x="27" y="19" width="9" height="2.5" rx="0.5" fill="#282830" />
  </g>
);

const GargoyleArt = () => (
  <g>
    {/* Wing tips peeking above shoulders */}
    <path d="M 8,22 Q 3,10 7,6 Q 11,14 13,20 Z" fill="#0c0c0c" />
    <path d="M 32,22 Q 37,10 33,6 Q 29,14 27,20 Z" fill="#0c0c0c" />
    {/* Stone body */}
    <ellipse cx="20" cy="21" rx="11" ry="11" fill="#0c0c0c" />
    {/* Horns */}
    <path d="M 14,13 Q 11,4 14,3 Q 16,8 16,13" fill="#0a0a0a" />
    <path d="M 26,13 Q 29,4 26,3 Q 24,8 24,13" fill="#0a0a0a" />
    {/* Deep red eyes */}
    <ellipse cx="15.5" cy="19" rx="2.8" ry="2.3" fill="#0a0808" />
    <ellipse cx="24.5" cy="19" rx="2.8" ry="2.3" fill="#0a0808" />
    <ellipse cx="15.5" cy="19" rx="1.8" ry="1.4" fill="#b81818" fillOpacity="0.9" />
    <ellipse cx="24.5" cy="19" rx="1.8" ry="1.4" fill="#b81818" fillOpacity="0.9" />
    <circle cx="15.5" cy="19" r="0.6" fill="#040404" />
    <circle cx="24.5" cy="19" r="0.6" fill="#040404" />
    {/* Fanged maw */}
    <path d="M 13,24 Q 20,29 27,24" fill="#0a0808" />
    <path d="M 14,24 L 15,27 L 17,24 L 19,26 L 21,24 L 23,27 L 25,24 L 26,27 L 27,24"
          fill="none" stroke="#2a2820" strokeWidth="0.8" />
    {/* Body */}
    <path d="M 8,39 Q 9,28 20,27 Q 31,28 32,39 Z" fill="#0c0c0c" />
  </g>
);

const MONSTER_RENDERERS: Record<MonsterKind, () => React.ReactElement> = {
  goblin:        GoblinArt,
  orc:           OrcArt,
  abomination:   AbominationArt,
  skeleton:      SkeletonArt,
  zombie:        ZombieArt,
  mummy:         MummyArt,
  dread_warrior: DreadWarriorArt,
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
