'use client';

// HeroScape board — slice 2 (Master Game rounds on the Training Field).
// Each round: secretly place order markers 1/2/3/X → d20 initiative → three
// turns per player, each driven by the automatically revealed marker. All
// legality comes from the engine's pure helpers so the highlights can never
// disagree with the server's validation. The state arriving here is already
// PROJECTED: an opponent's unrevealed markers are literally 'hidden' — the
// board renders every one of them as the same face-down chip (X included).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  type HSState,
  type Figure,
  type CombatFace,
  type LastAttack,
  type LastRoll,
  type HexKey,
  type OrderMarker,
  type OrderMarkerValue,
  type HSChoiceResolution,
  type HSMode,
  MAPS,
  HS_CARDS,
  HS_DRAFT_POOL,
  HS_GLYPHS,
  POWER_DESCRIPTIONS,
  POINT_BUDGETS,
  MIN_POINT_BUDGET,
  MAX_POINT_BUDGET,
  legalDestinations,
  grappleDestinations,
  canFireLine,
  fireLineSpaces,
  canMindShackle,
  mindShackleTargets,
  canChomp,
  chompTargets,
  canGrenade,
  grenadeTargets,
  // Airborne Elite THE DROP (slice 8).
  canTheDrop,
  theDropHexes,
  // Big Heroes special powers (slice 8b).
  iceShardTargets,
  queglixTargets,
  queglixDiceLeft,
  wildSwingTargets,
  acidBreathTargets,
  throwTargets,
  throwLandingHexes,
  carryPassengers,
  legalTargets,
  placeableHexes,
  placeable2Leads,
  orientationOptions,
  figureLabel,
  getActiveCardUid,
  axialToOffset,
  offsetToAxial,
  hexKey,
  parseHexKey,
  neighborKeys,
  mapSupportsCount,
  teamBudgetForSeat,
  teamSpentInDraft,
  teamRemainingInDraft,
  isoTopCenter,
  isoTopHexCorners,
  isoSideFaces,
  isoSortByDepth,
  isoSceneBounds,
} from '@/lib/games/heroscape';

// The 3D board (React Three Fiber) is a heavy WebGL bundle — load it lazily and
// CLIENT-ONLY, so three.js ships only when a player actually opens the 3D view.
const HeroBoard3D = dynamic(() => import('./HeroBoard3D'), { ssr: false });

const HEX = 34; // px size of a unit hex
const PAD = 26;

// One DISTINCT team colour per seat (up to 8). Used when a player has no
// explicit accent_color — without a full palette here, seats 3+ all collapsed to
// the same grey, making figures indistinguishable at 3-6 players. Chosen for
// mutual contrast AND contrast against the board's grass/sand/water terrain.
const SEAT_COLORS = [
  '#ef4444', // 1 red
  '#3b82f6', // 2 blue
  '#eab308', // 3 yellow
  '#a855f7', // 4 purple
  '#ec4899', // 5 pink
  '#14b8a6', // 6 teal
  '#f97316', // 7 orange
  '#84cc16', // 8 lime
];
// Team colours (allies share one) — index = team id − 1 (lobby assigns ids 1/2/3).
const TEAM_COLORS = ['#f87171', '#60a5fa', '#4ade80']; // Team A / B / C
const teamColorById = (team: number) => TEAM_COLORS[(team - 1) % TEAM_COLORS.length] ?? '#a3a3a3';
const MARKERS: readonly OrderMarkerValue[] = ['1', '2', '3', 'X'];

type Assignment = { marker: OrderMarkerValue; cardUid: string };

/**
 * Terrain + elevation hex fill. Grass/rock/sand get a base hue that lightens
 * with height (so a 4-tier hill reads as a hill); water is a flat blue. A
 * matching darker stroke separates the tiers. Keeps the slice-2 grass look at
 * height 1 while making the slice-3 maps legible at a glance.
 */
function hexFill(terrain: string, height: number, isDest: boolean): { fill: string; stroke: string } {
  if (isDest) return { fill: '#155e3b', stroke: '#34d399' };
  if (terrain === 'water') return { fill: '#1e3a5f', stroke: '#2c5a8c' };
  // Lightness ramp by height (1→4). Hue per terrain.
  const lift = Math.min(Math.max(height - 1, 0), 3); // 0..3
  if (terrain === 'rock') {
    const fills = ['#3a3f45', '#4a5159', '#5b636d', '#6c7682'];
    return { fill: fills[lift], stroke: '#23262a' };
  }
  if (terrain === 'sand') {
    const fills = ['#7a6a3f', '#8c7b49', '#9e8c54', '#b09d60'];
    return { fill: fills[lift], stroke: '#3a3322' };
  }
  // grass
  const fills = ['#2f4a2a', '#3a5a33', '#46693c', '#527845'];
  return { fill: fills[lift], stroke: '#1c2c1a' };
}

/** Multiply a #rrggbb color by a 0..1+ factor (clamped to 255) for the iso
 *  side-face shading. Pure string→string; keeps the prism's columns a darker
 *  shade of the terrain top, with the per-face form factor folded in. */
function shadeHex(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((n & 0xff) * factor));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Iso prism colors for a cell: the terrain TOP fill (reusing the flat palette so
 * the look matches), the top OUTLINE stroke, and the base SIDE color the
 * per-face shade multiplies. Water keeps its flat blue top and (being height-0
 * visually) renders no tall column. `isDest` paints the legal-move green top.
 */
function isoTileColors(terrain: string, height: number, isDest: boolean): { top: string; stroke: string; side: string } {
  const { fill, stroke } = hexFill(terrain, height, isDest);
  // Side base = the top fill darkened ~30%; the per-face shade (0.52…0.82) is
  // then applied on top for left/right form. Dest-green tiles use a green side.
  return { top: fill, stroke, side: shadeHex(fill, 0.7) };
}

type Props = {
  state: HSState;
  currentUserId: string;
  isHost: boolean;
  disabled?: boolean;
  onStart: (mapId?: string, pointBudget?: number, mode?: HSMode) => void;
  onSetLobbyConfig: (cfg: { mapId?: string; pointBudget?: number; mode?: HSMode; teams?: Record<number, number>; teamBudgets?: Record<number, number> }) => void;
  onPlaceMarkers: (assignments: Assignment[]) => void;
  onMoveFigure: (figureId: string, to: HexKey) => void;
  onGrappleMove: (figureId: string, to: HexKey) => void;
  onFireLine: (attackerId: string, dir: number) => void;
  onOrient: (figureId: string, dir: number) => void;
  onAttack: (attackerId: string, targetId: string) => void;
  onBerserkerCharge: () => void;
  onWaterClone: () => void;
  onMindShackle: (targetId: string) => void;
  onChomp: (targetId: string) => void;
  onGrenade: () => void;
  onGrenadeThrow: (targetId: string) => void;
  // Big Heroes special powers (slice 8b).
  onIceShard: (attackerId: string, targetId: string) => void;
  onQueglix: (attackerId: string, targetId: string, dice: 1 | 2 | 3) => void;
  onWildSwing: (attackerId: string, targetId: string) => void;
  onAcidBreath: (attackerId: string, targetIds: string[]) => void;
  onThrow: (attackerId: string, targetId: string, to: HexKey) => void;
  onCarry: (figureId: string, to: HexKey, passengerId: string, passengerTo: HexKey) => void;
  onTheDrop: (placements: HexKey[]) => void;
  onResolveChoice: (choice: HSChoiceResolution) => void;
  onEndTurn: () => void;
  onDraftCard: (cardId: string) => void;
  onDraftPass: () => void;
  onPlaceFigure: (figureId: string, to: HexKey) => void;
  onUnplaceFigure: (figureId: string) => void;
  onPlacementReady: () => void;
};

/** Is it my live turn (in 'turns', I am the turn seat)? */
function myTurnReady(state: HSState, me: { seat: number } | undefined): boolean {
  return state.phase === 'playing' && state.subPhase === 'turns' && !!me && state.turnSeat === me.seat;
}

/** Colored badge per glyph letter (matches the rulebook's Glyphs Key). */
const GLYPH_BADGE: Record<string, { bg: string; ring: string }> = {
  A: { bg: '#b91c1c', ring: '#fca5a5' }, // Astrid (attack)
  G: { bg: '#1d4ed8', ring: '#93c5fd' }, // Gerda (defense)
  I: { bg: '#7c3aed', ring: '#c4b5fd' }, // Ivor (range)
  V: { bg: '#047857', ring: '#6ee7b7' }, // Valda (move)
  D: { bg: '#b45309', ring: '#fcd34d' }, // Dagmar (initiative)
  K: { bg: '#0e7490', ring: '#67e8f9' }, // Kelda (heal)
  E: { bg: '#52525b', ring: '#a1a1aa' }, // Erland (deferred)
  M: { bg: '#52525b', ring: '#a1a1aa' }, // Mitonsoul (deferred)
  B: { bg: '#52525b', ring: '#a1a1aa' }, // Brandar (scenario)
};

function DieFace({ face, size = 22 }: { face: CombatFace; size?: number }) {
  const fill = face === 'skull' ? '#7f1d1d' : face === 'shield' ? '#1e3a8a' : '#404040';
  const glyph = face === 'skull' ? '💀' : face === 'shield' ? '🛡' : '';
  return (
    <span
      className="inline-flex items-center justify-center rounded border border-neutral-600 bg-neutral-100/10"
      style={{ width: size, height: size, fontSize: size * 0.55, background: fill }}
      title={face}
    >
      {glyph}
    </span>
  );
}

/** One order-marker chip. A projected 'hidden' marker renders as the same
 *  anonymous face-down chip every time — the X decoy must be visually
 *  indistinguishable from 1/2/3 (slice-2 spec §Projection). */
function MarkerChip({ m, size = 16 }: { m: OrderMarker; size?: number }) {
  const faceDown = m.marker === 'hidden';
  return (
    <span
      className={
        'inline-flex shrink-0 items-center justify-center rounded-full border font-bold ' +
        (faceDown
          ? 'border-neutral-600 bg-neutral-800 text-neutral-800'
          : m.revealed
            ? 'border-amber-400 bg-amber-500/90 text-neutral-950'
            : 'border-amber-700/70 bg-neutral-900 text-amber-300/90')
      }
      style={{ width: size, height: size, fontSize: size * 0.62 }}
      title={
        faceDown
          ? 'Face-down order marker'
          : `Order marker ${m.marker}${m.revealed ? ' (revealed)' : ''}`
      }
    >
      {faceDown ? '' : m.marker}
    </span>
  );
}

/** Small figure-cutout portrait for the compact army card: tries the transparent
 *  cut-out png, then the card-art jpg crop, then a colored letter. object-top
 *  keeps the figure's head/torso in frame (not its base). */
function Portrait({ cardId, letter, accent }: { cardId: string; letter: string; accent: string }) {
  const [mode, setMode] = useState<'png' | 'jpg' | 'none'>('png');
  if (mode === 'none') {
    return (
      <div className="flex h-full w-full items-center justify-center text-xl font-black" style={{ color: accent }}>
        {letter}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/heroscape/figures/${cardId}.${mode}`}
      alt=""
      loading="lazy"
      className="h-full w-full object-cover object-top"
      onError={() => setMode(mode === 'png' ? 'jpg' : 'none')}
    />
  );
}

/** One colour-coded stat pill in the compact army card. `tone` is a tailwind
 *  bg+text pair (e.g. "bg-rose-950/60 text-rose-300"). */
function StatPill({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className={'flex items-center justify-between rounded px-1 py-px ' + tone}>
      <span className="text-[8px] uppercase tracking-wide opacity-80">{label}</span>
      <span className="text-[11px] font-bold tabular-nums">{value}</span>
    </div>
  );
}

/** Scanned army-card art, served from /public/heroscape/cards/<cardId>.png. The
 *  path is derived purely from the card id (no per-card config). If the image is
 *  missing or fails to load, it hides itself (onError) so the surrounding text /
 *  stat layout shows through as a graceful fallback. */
function CardArt({ cardId, className }: { cardId: string; className?: string }) {
  // next/image serves a thumbnail-sized variant matched to the ~280px draft slot
  // (and a bigger one on retina / when the browser is zoomed in to read a card),
  // so the card stays crisp at 100% instead of a 1404px scan being crushed down by
  // the browser's weak downscaler. NO ?v= cache-bust query: Vercel's image
  // optimizer 400s on a query string for local files (-> the card would 404 to the
  // text fallback). Unlike the long-cached static jpg, the optimized variants carry
  // a short TTL and revalidate on their own when a card file is replaced (a
  // hard-refresh forces it immediately). Hides on error so the text/stat card
  // behind it shows through. `fill` => the positioned panel sets the size.
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      src={`/heroscape/cards/${cardId}.jpg`}
      alt=""
      fill
      sizes="(max-width: 640px) 50vw, 340px"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * A figure STANDEE for the 2.5D iso board (slice-iso-spec §Figures). Anchored at
 * the tile's iso TOP-face center `(cx, cy)`, it draws (bottom-up):
 *   • a soft drop-SHADOW ellipse on the tile,
 *   • a player-accent BASE ellipse (ownership is unmistakable),
 *   • an upright BILLBOARD sprite (/heroscape/figures/<cardId>.jpg), ~1.7×HEX
 *     tall, bottom-anchored on the base so the figure "stands" on the tile.
 * If the sprite is missing/fails to load it falls back (CardArt-style onError)
 * to the legacy colored DISC + letter so the board never breaks. The ring /
 * selection / target / wound / squad-index overlays are drawn by the caller,
 * re-anchored to this same center. `clipId` must be unique per figure (the
 * billboard is clipped to a rounded card so the painted card background reads as
 * a tidy standee, hiding the crop seams — v1 accepts the painted background).
 */
const STANDEE_BASE_HEIGHT = 5;
/** Visual scale of a standee = card HEIGHT (cards.md) / human baseline (5),
 *  clamped. A height-9 Mimring / height-11 Grimnak looms over a height-5 human;
 *  a height-4 Marro sits a touch lower — the board reads true to the models.
 *  Affects ONLY the sprite — the base footprint stays tied to the hex(es) the
 *  figure occupies (1 or 2), so range/occupancy are unchanged. */
function standeeScale(height: number | undefined): number {
  return Math.max(0.78, Math.min(2.3, (height ?? STANDEE_BASE_HEIGHT) / STANDEE_BASE_HEIGHT));
}
function FigureStandee({
  cardId, cx, cy, hex, accent, fallbackLabel, billboard, cx2, cy2, squadIndex, facingVec,
}: {
  cardId: string;
  cx: number;
  cy: number;
  hex: number;
  accent: string;
  fallbackLabel: string;
  billboard: boolean; // false → squad/extra: skip the sprite, just disc+label
  /** Second hex center for a DOUBLE-SPACE figure — when present the standee is
   *  centred on the midpoint of (cx,cy)-(cx2,cy2) with a wider, rotated base. */
  cx2?: number;
  cy2?: number;
  /** Squad figure index (1-based): tries a per-trooper sprite
   *  `<cardId>-<index>.png` first so each squad member keeps its own pose. */
  squadIndex?: number;
  /** Cosmetic FACING for a 1-hex figure — a normalised SCREEN-space vector toward
   *  the hex the figure faces (the parent projects the facing neighbour). Drawn
   *  as a small notch on the base rim so a player can see which way it points. A
   *  2-hex figure shows its facing through the elongated base, so this is null. */
  facingVec?: { dx: number; dy: number } | null;
}) {
  // Sprite source chain, best → fallback:
  //   'pngIdx' = a per-squad-member cut-out (<cardId>-<index>.png) so each trooper
  //              shows its OWN pose; 'png' = the shared clean cut-out (frameless);
  //   'jpg' = the card-art crop (framed); 'disc' = the colored disc + letter.
  // onError walks down the chain, so a missing file never breaks.
  const [mode, setMode] = useState<'pngIdx' | 'png' | 'jpg' | 'disc'>(
    billboard ? (squadIndex != null ? 'pngIdx' : 'png') : 'disc',
  );
  // Base ellipse footprint (squashed, sits flat on the iso top face). Sized to
  // FILL most of the projected hex (~0.97×0.54·hex) like the real moulded disc,
  // so a figure clearly "owns" its hex — while staying inside it so it never
  // bleeds into the east/west neighbours.
  const baseRx = hex * 0.58;
  const baseRy = hex * 0.31;
  // DOUBLE-SPACE figures pass a second hex center: the standee centres on the
  // midpoint, its base is elongated + rotated along the two-hex axis, and the
  // billboard grows so the big model reads across both spaces.
  const wide = cx2 != null && cy2 != null;
  const mx = wide ? (cx + cx2!) / 2 : cx;
  const my = wide ? (cy + cy2!) / 2 : cy;
  const span = wide ? Math.hypot(cx2! - cx, cy2! - cy) : 0;
  const baseAngle = wide ? (Math.atan2(cy2! - cy, cx2! - cx) * 180) / Math.PI : 0;
  const wideRx = wide ? baseRx + span / 2 : baseRx;
  // Billboard at BASE size: ~1.1×HEX wide / ~1.7×HEX tall (1-hex); a 2-hex figure
  // grows by the span. Bottom rests just above the base.
  const spriteW = wide ? hex * 1.15 + span : hex * 1.15;
  const spriteH = wide ? hex * 2.0 : hex * 1.7;
  const spriteX = mx - spriteW / 2;
  const spriteY = my - spriteH + baseRy * 0.4;
  const clipId = `hs-fig-clip-${cardId}-${Math.round(mx)}-${Math.round(my)}`;
  // HEIGHT scaling: a taller card stands taller. We put the multiple on HEIGHT,
  // not width — a big model that also grew ~2× WIDE would shove into neighbouring
  // hexes. So meet-fit the art at base size (never squashed), then scale the whole
  // billboard up around its FEET: the full multiple vertically, only a gentle
  // fraction of it horizontally. Humans (height 5 ⇒ 1.0×) are untouched.
  const figScale = standeeScale(HS_CARDS[cardId]?.height);
  const figWidthScale = 1 + (figScale - 1) * 0.3;
  const footY = my + baseRy * 0.4; // the billboard's bottom edge (the figure's feet)
  const billboardTransform =
    Math.abs(figScale - 1) < 0.001
      ? undefined
      : `translate(${mx} ${footY}) scale(${figWidthScale.toFixed(3)} ${figScale.toFixed(3)}) translate(${-mx} ${-footY})`;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* drop shadow — elongated + rotated for a double-space figure */}
      <ellipse
        cx={mx} cy={my + baseRy * 0.5} rx={wideRx * 1.02} ry={baseRy * 0.8}
        fill="#000000" opacity={0.26}
        transform={wide ? `rotate(${baseAngle} ${mx} ${my + baseRy * 0.5})` : undefined}
      />
      {/* OWNERSHIP COLOUR — a figure's own moulded base is SMALLER than the hex
       *  footprint, so we ring it in the owner's team colour. A soft ground AURA
       *  plus a bold colour chip make "whose figure is this?" read at a glance
       *  even with 3-6 players sharing the board: the sprite's real base sits on
       *  top, leaving a clear colour band around it. Both rotate along the long
       *  axis for a double-space figure so the colour spans both hexes. */}
      <ellipse
        cx={mx} cy={my} rx={wideRx + hex * 0.10} ry={baseRy + hex * 0.06}
        fill={accent} opacity={0.30}
        transform={wide ? `rotate(${baseAngle} ${mx} ${my})` : undefined}
      />
      <ellipse
        cx={mx} cy={my} rx={wideRx} ry={baseRy}
        fill={accent} stroke="#0a0a0a" strokeWidth={2} opacity={0.97}
        transform={wide ? `rotate(${baseAngle} ${mx} ${my})` : undefined}
      />
      <ellipse
        cx={mx} cy={my} rx={wideRx} ry={baseRy}
        fill="none" stroke="#ffffff" strokeWidth={1} opacity={0.28}
        transform={wide ? `rotate(${baseAngle} ${mx} ${my})` : undefined}
      />
      {/* FACING notch (1-hex cosmetic facing) — a small wedge on the colour rim
       *  pointing the way the figure faces. Sits at the chip rim (outside the
       *  figure's own smaller base) so it stays visible. */}
      {facingVec && !wide && (() => {
        const { dx, dy } = facingVec;
        const px = mx + dx * baseRx, py = my + dy * baseRy;
        return (
          <polygon
            points={`${px + dx * 5},${py + dy * 5} ${px - dy * 3.5},${py + dx * 3.5} ${px + dy * 3.5},${py - dx * 3.5}`}
            fill="#f5f5f5" stroke="#0a0a0a" strokeWidth={0.75} opacity={0.92}
          />
        );
      })()}
      {mode === 'disc' ? (
        // Fallback: the legacy colored disc + letter (sprite missing or a squad's
        // extra figures we keep as discs). A flat marker — NOT height-scaled (a
        // stretched disc + letter would just look wrong).
        <>
          <circle cx={mx} cy={my - hex * 0.18} r={hex * 0.42} fill={accent} stroke="#0a0a0a" strokeWidth={1.5} />
          <text
            x={mx} y={my - hex * 0.18 + 1}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={hex * 0.42} fontWeight={800} fill="#0a0a0a"
            style={{ userSelect: 'none' }}
          >
            {fallbackLabel}
          </text>
        </>
      ) : (
        // The standee billboard, grown around its feet by the card's Height
        // (`billboardTransform`): tall multiple, gentle width — see above.
        <g transform={billboardTransform}>
          {mode === 'pngIdx' || mode === 'png' ? (
            // Clean cut-out: no frame — the figure standing on its base, bottom-
            // anchored (xMidYMax) and shown whole (meet). A squad member tries its
            // own <cardId>-<index>.png, then <cardId>.png, then the framed jpg.
            <image
              href={mode === 'pngIdx' ? `/heroscape/figures/${cardId}-${squadIndex}.png` : `/heroscape/figures/${cardId}.png`}
              x={spriteX} y={spriteY} width={spriteW} height={spriteH}
              preserveAspectRatio="xMidYMax meet"
              onError={() => setMode(mode === 'pngIdx' ? 'png' : 'jpg')}
            />
          ) : (
            <>
              <defs>
                <clipPath id={clipId}>
                  <rect x={spriteX} y={spriteY} width={spriteW} height={spriteH} rx={hex * 0.16} ry={hex * 0.16} />
                </clipPath>
              </defs>
              {/* card-art crop — clipped to a rounded card to hide the seams */}
              {/* eslint-disable-next-line @next/next/no-img-element is N/A for SVG image */}
              <image
                href={`/heroscape/figures/${cardId}.jpg`}
                x={spriteX} y={spriteY} width={spriteW} height={spriteH}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${clipId})`}
                onError={() => setMode('disc')}
              />
              {/* thin frame around the standee so it reads as a stand-up piece */}
              <rect
                x={spriteX} y={spriteY} width={spriteW} height={spriteH}
                rx={hex * 0.16} ry={hex * 0.16}
                fill="none" stroke={accent} strokeWidth={1.5} opacity={0.9}
              />
            </>
          )}
        </g>
      )}
    </g>
  );
}

/** A draft-pool card. The scanned card ART now FILLS a portrait panel (the art
 *  shows the name + full stat line). Draft-only bits overlay the image: a
 *  translucent bottom bar with name + points (so you can still scan budgets), a
 *  "⚡ powers WIP" corner badge for stat-only cards, and a dim "✓ taken by X"
 *  overlay when drafted. If the image fails to load it hides itself (CardArt
 *  onError) and the text/stat card layered BEHIND it shows through as a graceful
 *  fallback. Clicking an affordable, available card drafts it (when it's your
 *  pick). */
function DraftCard({
  cardId, taken, takenByLabel, affordable, clickable, onPick,
}: {
  cardId: string;
  taken: boolean;
  takenByLabel?: string;
  affordable: boolean;
  clickable: boolean;
  onPick: () => void;
}) {
  const def = HS_CARDS[cardId];
  const wip = def.power === 'wip';
  const dim = taken || !affordable;
  return (
    <div className="group relative aspect-[886/1432] w-full">
    <button
      onClick={() => clickable && onPick()}
      disabled={!clickable}
      title={
        taken
          ? `Drafted by ${takenByLabel ?? 'a player'}`
          : !affordable
            ? 'Over your remaining budget'
            : `Draft ${def.name} (${def.points} pts)`
      }
      className={
        'absolute inset-0 overflow-hidden rounded-lg border-2 text-left transition ' +
        (taken
          ? 'border-neutral-800 bg-neutral-900/40 opacity-50'
          : clickable
            ? 'border-amber-700 bg-neutral-900/60 hover:border-amber-400 hover:bg-amber-900/20'
            : 'border-neutral-800 bg-neutral-900/40 ' + (dim ? 'opacity-50' : ''))
      }
    >
      {/* Text/stat fallback — layered BEHIND the art. Shows through only if the
          scanned image fails to load (CardArt hides itself on error). */}
      <div className="absolute inset-0 flex flex-col items-stretch px-2 py-2">
        <div className="flex items-baseline justify-between gap-1">
          <span className={'text-sm font-bold leading-tight ' + (taken ? 'text-neutral-500 line-through' : 'text-neutral-100')}>
            {def.name}
          </span>
          <span className="shrink-0 text-base font-extrabold tabular-nums text-amber-300">{def.points}</span>
        </div>
        <div className="mt-1 text-[11px] text-neutral-400 tabular-nums">
          {def.type === 'hero' ? '1 hero' : `${def.figures} figures`} · Mv {def.move} · Rg {def.range} · ⚔{def.attack} · 🛡{def.defense} · H{def.height}
        </div>
      </div>

      {/* Scanned card art — FILLS the panel edge-to-edge (object-cover). */}
      <CardArt cardId={cardId} className="object-cover" />

      {/* ⚡ powers WIP — corner badge over the art. */}
      {wip && !taken && (
        <span
          className="absolute right-1 top-1 rounded bg-neutral-950/80 px-1 py-0.5 text-[9px] font-semibold text-purple-300"
          title="Special power not yet implemented — fights with printed stats"
        >
          ⚡ WIP
        </span>
      )}

      {/* Translucent bottom bar — name + points, readable over the art. */}
      <div className="absolute inset-x-0 bottom-0 flex items-baseline justify-between gap-1 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-1.5 pb-1 pt-3">
        <span className={'truncate text-[11px] font-bold leading-tight ' + (taken ? 'text-neutral-400 line-through' : 'text-neutral-50')}>
          {def.name}
        </span>
        <span className="shrink-0 text-sm font-extrabold tabular-nums text-amber-300">{def.points}</span>
      </div>

      {/* "✓ taken by X" — dim overlay with struck name when drafted. */}
      {taken && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/55 px-1 text-center">
          <span className="text-[10px] font-semibold text-neutral-200">✓ taken{takenByLabel ? ` by ${takenByLabel}` : ''}</span>
        </div>
      )}
    </button>
      {/* Clean text card on hover (not clipped — the group wrapper has no
          overflow-hidden, unlike the art button). Below the card so the top
          row's popover stays on-screen. */}
      <CardHoverPanel cardId={cardId} placement="below" />
    </div>
  );
}

/** ♥ pips for a hero: Life − wounds remaining. */
function WoundPips({ life, wounds }: { life: number; wounds: number }) {
  return (
    <span className="tracking-tight" title={`${life - wounds}/${life} Life`}>
      <span className="text-red-400">{'♥'.repeat(Math.max(0, life - wounds))}</span>
      <span className="text-neutral-700">{'♥'.repeat(Math.min(life, wounds))}</span>
    </span>
  );
}

/** Hover popover with the CLEAN TEXT army card: name, General/class, the whole
 *  stat grid, and every special power (name + printed text from
 *  POWER_DESCRIPTIONS). No image here — the roster/draft PANEL shows the scanned
 *  art; this hover is the readable detail view. Rendered as a CSS group-hover
 *  panel — the parent roster card carries the `group` class, this sits
 *  absolutely over the board (pointer-events-none so it never eats clicks),
 *  appearing above the card. */
function CardHoverPanel({ cardId, placement = 'above' }: { cardId: string; placement?: 'above' | 'below' }) {
  const def = HS_CARDS[cardId];
  if (!def) return null;
  const powers = POWER_DESCRIPTIONS[cardId] ?? [];
  return (
    <div
      className={
        'pointer-events-none absolute left-1/2 z-30 hidden max-h-[80vh] w-72 -translate-x-1/2 overflow-y-auto rounded-lg border-2 border-amber-700 bg-neutral-950/97 px-3 py-2.5 text-left shadow-xl shadow-black/60 group-hover:block ' +
        (placement === 'below' ? 'top-full mt-2' : 'bottom-full mb-2')
      }
    >
      <div className="text-sm font-bold leading-tight text-amber-100">{def.name}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {def.unitClass ?? (def.type === 'hero' ? 'Hero' : 'Squad')}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-neutral-300 tabular-nums">
        <span>Life <span className="font-bold text-neutral-100">{def.life}</span></span>
        <span>Move <span className="font-bold text-neutral-100">{def.move}</span></span>
        <span>Range <span className="font-bold text-neutral-100">{def.range}</span></span>
        <span>Attack <span className="font-bold text-neutral-100">{def.attack}</span></span>
        <span>Defense <span className="font-bold text-neutral-100">{def.defense}</span></span>
        <span>Height <span className="font-bold text-neutral-100">{def.height}</span></span>
        <span className="col-span-2">Points <span className="font-bold text-amber-300">{def.points}</span></span>
      </div>
      {powers.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-neutral-800 pt-1.5">
          {powers.map(p => (
            <div key={p.name}>
              <div className="text-[11px] font-bold text-amber-300">{p.name}</div>
              <div className="text-[10px] leading-snug text-neutral-300">{p.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 border-t border-neutral-800 pt-1.5 text-[10px] italic text-neutral-500">
          No special power.
        </div>
      )}
    </div>
  );
}

/** A big die face for the dramatic roll overlay — reuses DieFace's look (skull
 *  #7f1d1d/💀, shield #1e3a8a/🛡, blank gray) at large size, plus a quick
 *  tumble/scale-in as each die "lands". */
function BigDie({ face, landed }: { face: CombatFace; landed: boolean }) {
  const size = 60;
  const fill = face === 'skull' ? '#7f1d1d' : face === 'shield' ? '#1e3a8a' : '#404040';
  const glyph = face === 'skull' ? '💀' : face === 'shield' ? '🛡' : '';
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg border-2 border-neutral-600 shadow-lg shadow-black/50"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: fill,
        animation: landed ? 'hsDieIn 320ms cubic-bezier(0.34,1.56,0.64,1)' : undefined,
      }}
      title={face}
    >
      {glyph}
    </span>
  );
}

/** The dramatic centered DICE-ROLL overlay. Mounted (by the parent, keyed on
 *  lastAttack.seq) when a FRESH attack resolves; plays a sequence:
 *    header → reveal ATTACK dice one-at-a-time (running skull count) → attack
 *    total → reveal DEFENSE dice one-at-a-time (running shield count) → result.
 *  Auto-dismisses ~1.6s after the result; backdrop click or "Skip ▸" dismisses
 *  immediately. All timers are cleaned up on unmount (so a superseding attack —
 *  which remounts this via a new key — cancels the old sequence). Driven purely
 *  by the shared lastAttack, so BOTH players see it. */
function DiceRollOverlay({ attack, onDismiss }: { attack: LastAttack; onDismiss: () => void }) {
  const PER_DIE = 450; // ms between dice
  const attackN = attack.attackRoll.length;
  const defenseN = attack.defenseRoll.length;
  // 'attack' (revealing attack dice) → 'defense' (revealing defense dice) →
  // 'result'. shownA / shownD = how many dice of each are currently face-up.
  const [stage, setStage] = useState<'attack' | 'defense' | 'result'>('attack');
  const [shownA, setShownA] = useState(0);
  const [shownD, setShownD] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 250; // small beat before the first die lands
    // 1) ATTACK dice, one at a time.
    for (let i = 1; i <= attackN; i++) {
      timers.push(setTimeout(() => setShownA(i), t));
      t += PER_DIE;
    }
    // 2) DEFENSE phase, then its dice one at a time.
    t += 300;
    timers.push(setTimeout(() => setStage('defense'), t));
    for (let i = 1; i <= defenseN; i++) {
      t += PER_DIE;
      timers.push(setTimeout(() => setShownD(i), t));
    }
    // 3) RESULT.
    t += 350;
    timers.push(setTimeout(() => setStage('result'), t));
    // 4) Auto-dismiss ~1.6s after the result lands.
    t += 1600;
    timers.push(setTimeout(onDismiss, t));
    return () => { for (const id of timers) clearTimeout(id); };
    // attack is fixed for this mount (parent re-keys on seq); run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningSkulls = attack.attackRoll.slice(0, shownA).filter(f => f === 'skull').length;
  const runningShields = attack.defenseRoll.slice(0, shownD).filter(f => f === 'shield').length;
  const showDefense = stage === 'defense' || stage === 'result';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={onDismiss}
      role="dialog"
      aria-label="Attack roll"
    >
      {/* The keyframe for each die's tumble/scale-in (file has no global CSS). */}
      <style>{`@keyframes hsDieIn { 0% { transform: scale(0.2) rotate(-120deg); opacity: 0; } 70% { transform: scale(1.12) rotate(8deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); } }`}</style>
      <div
        className="relative w-full max-w-lg rounded-2xl border-2 border-amber-700/80 bg-neutral-950/95 px-6 py-6 text-center shadow-2xl shadow-black/70"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onDismiss}
          className="absolute right-3 top-3 rounded-md border border-neutral-700 px-2 py-0.5 text-xs font-semibold text-neutral-400 transition hover:border-neutral-400 hover:text-neutral-200"
        >
          Skip ▸
        </button>

        {/* Header: attacker ⚔ target */}
        <div className="text-lg font-extrabold text-neutral-100">
          <span className="text-orange-300">{attack.attackerLabel}</span>
          <span className="mx-2 text-neutral-400">⚔</span>
          <span className="text-sky-300">{attack.targetLabel}</span>
        </div>

        {/* ATTACK row */}
        <div className="mt-5">
          <div className="text-xs font-bold uppercase tracking-wider text-orange-300/90">Attack</div>
          <div className="mt-2 flex min-h-[64px] flex-wrap items-center justify-center gap-2">
            {attack.attackRoll.slice(0, shownA).map((f, i) => (
              <BigDie key={i} face={f} landed />
            ))}
          </div>
          <div className="mt-2 text-3xl font-black tabular-nums text-orange-300">
            💀 {runningSkulls}
            {stage !== 'attack' && (
              <span className="ml-2 text-base font-bold text-neutral-400">skulls</span>
            )}
          </div>
        </div>

        {/* DEFENSE row (revealed after the attack dice) */}
        {showDefense && (
          <div className="mt-5 border-t border-neutral-800 pt-4">
            <div className="text-xs font-bold uppercase tracking-wider text-sky-300/90">Defense</div>
            <div className="mt-2 flex min-h-[64px] flex-wrap items-center justify-center gap-2">
              {attack.defenseRoll.slice(0, shownD).map((f, i) => (
                <BigDie key={i} face={f} landed />
              ))}
            </div>
            <div className="mt-2 text-3xl font-black tabular-nums text-sky-300">
              🛡 {runningShields}
              {stage === 'result' && (
                <span className="ml-2 text-base font-bold text-neutral-400">shields</span>
              )}
            </div>
          </div>
        )}

        {/* RESULT */}
        {stage === 'result' && (
          <div className="mt-5 border-t border-neutral-800 pt-4">
            <div
              className={
                'text-2xl font-black ' +
                (attack.destroyed ? 'text-red-400' : attack.wounds > 0 ? 'text-orange-300' : 'text-neutral-300')
              }
            >
              {attack.destroyed
                ? `${attack.targetLabel} is destroyed!`
                : attack.wounds > 0
                  ? `${attack.wounds} wound${attack.wounds === 1 ? '' : 's'}!`
                  : 'Blocked!'}
            </div>
            {attack.counterWounds != null && attack.counterWounds > 0 && (
              <div className="mt-1.5 text-lg font-bold text-fuchsia-300">
                ⚔ Counter Strike: {attack.counterWounds} back!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Centered overlay for a non-combat d20 roll (initiative + every d20 special
 *  power), so these are as VISIBLE as attack rolls. Mounted (by the parent, keyed
 *  on lastRoll.seq) when a fresh roll resolves: the dice tumble in one at a time,
 *  then the outcome caption lands. Natural 20 glows gold, a 1 glows red. Auto-
 *  dismisses; backdrop / "Skip ▸" closes it. Driven by shared state ⇒ both see it. */
function D20RollOverlay({ roll, onDismiss }: { roll: LastRoll; onDismiss: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 200;
    for (let i = 1; i <= roll.dice.length; i++) { timers.push(setTimeout(() => setShown(i), t)); t += 350; }
    t += 1800;
    timers.push(setTimeout(onDismiss, t));
    return () => { for (const id of timers) clearTimeout(id); };
    // roll is fixed for this mount (parent re-keys on seq); run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const allShown = shown >= roll.dice.length;
  const resultColor = roll.success === true ? 'text-emerald-300' : roll.success === false ? 'text-rose-300' : 'text-amber-200';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={onDismiss} role="dialog" aria-label={`${roll.title} roll`}>
      <style>{`@keyframes hsD20In { 0% { transform: scale(0.2) rotate(-120deg); opacity: 0; } 70% { transform: scale(1.12) rotate(8deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); } }`}</style>
      <div className="relative w-full max-w-md rounded-2xl border-2 border-violet-700/80 bg-neutral-950/95 px-6 py-6 text-center shadow-2xl shadow-black/70" onClick={e => e.stopPropagation()}>
        <button onClick={onDismiss} className="absolute right-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-bold text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-300">Skip ▸</button>
        <div className="text-xs font-bold uppercase tracking-widest text-violet-300/90">{roll.title}</div>
        <div className="mt-4 flex min-h-[72px] flex-wrap items-end justify-center gap-3">
          {roll.dice.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-1" style={{ visibility: i < shown ? 'visible' : 'hidden' }}>
              <div
                className={'flex h-16 w-16 items-center justify-center rounded-xl border-2 bg-neutral-900 text-3xl font-black tabular-nums ' +
                  (d === 20 ? 'border-amber-400 text-amber-300' : d === 1 ? 'border-rose-700 text-rose-400' : 'border-neutral-700 text-neutral-100')}
                style={{ animation: i < shown ? 'hsD20In 350ms ease-out' : undefined }}
              >
                {d}
              </div>
              {roll.labels?.[i] && <div className="max-w-[5rem] truncate text-[10px] text-neutral-400">{roll.labels[i]}</div>}
            </div>
          ))}
        </div>
        {allShown && <div className={'mt-4 border-t border-neutral-800 pt-3 text-sm font-semibold ' + resultColor}>{roll.detail}</div>}
      </div>
    </div>
  );
}

export default function HeroScapeBoard({
  state, currentUserId, isHost, disabled,
  onStart, onSetLobbyConfig, onPlaceMarkers, onMoveFigure, onGrappleMove, onFireLine, onOrient, onAttack,
  onBerserkerCharge, onWaterClone, onMindShackle, onChomp, onGrenade, onGrenadeThrow, onResolveChoice, onEndTurn,
  onIceShard, onQueglix, onWildSwing, onAcidBreath, onThrow, onCarry, onTheDrop,
  onDraftCard, onDraftPass, onPlaceFigure, onUnplaceFigure, onPlacementReady,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // slice 7: Sgt. Drake's GRAPPLE GUN toggle. When on, his highlights switch to
  // the 1-space climb-anywhere set and a hex click routes to grapple_move.
  const [grappleMode, setGrappleMode] = useState(false);
  const [fireLineMode, setFireLineMode] = useState(false);
  // slice 8: Ne-Gok-Sa MIND SHACKLE targeting mode. When on, adjacent enemy
  // figures highlight as shackle targets and a figure click sends mind_shackle.
  const [shackleMode, setShackleMode] = useState(false);
  // slice 8: Grimnak CHOMP targeting mode (same idea — adjacent enemy click).
  const [chompMode, setChompMode] = useState(false);
  // slice 8b: Big-Hero special-power control panel — current dropdown selections
  // (figure / hex ids). A single object so each power's pickers are independent
  // without a hook per field. Defaults fill in from the first legal option.
  const [bh, setBh] = useState<{
    qDice?: 1 | 2 | 3; ice?: string; q?: string; wild?: string;
    acid?: string[]; throwTgt?: string; throwTo?: string;
    carryPass?: string; carryDest?: string; carryLand?: string;
  }>({});
  const patchBh = (p: Partial<typeof bh>) => setBh(s => ({ ...s, ...p }));
  // slice 8: Airborne Elite THE DROP — at round start the owner enters drop mode,
  // clicks the reserve-count legal empty hexes, then deploys (server rolls d20).
  const [dropMode, setDropMode] = useState(false);
  const [dropPicks, setDropPicks] = useState<HexKey[]>([]);
  // The 3D board (React Three Fiber) is THE board — there is no user-facing 2D
  // toggle. The 2D SVG remains ONLY as an automatic fallback for environments
  // without WebGL (older devices, and jsdom in tests). `can3D` starts false so
  // SSR + the first client paint render the SVG (no hydration mismatch); a
  // mount-time WebGL probe flips it on, after which 3D takes over.
  const [can3D, setCan3D] = useState(false);
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      setCan3D(!!(c.getContext('webgl2') || c.getContext('webgl')));
    } catch { /* no WebGL → stay on the 2D fallback */ }
  }, []);
  // Per-seat army-row expand override (opponent rosters collapse to fit 4-6
  // players; the user can toggle any). Keyed by seat; absent → default.
  const [openSeats, setOpenSeats] = useState<Record<number, boolean>>({});
  // The battle log is collapsible and minimized by default so the map/cards own
  // the space; expand it (a thin toggle on the far left) to read/scroll history.
  const [logOpen, setLogOpen] = useState(false);
  // Lobby settings live in SHARED state (state.mapId/mode/pointBudget) so every
  // player sees the host's choice — the host edits via onSetLobbyConfig, which
  // updates the room state and broadcasts. (Previously these were local React
  // state, so only the host saw changes until the battle started.)
  const lobbyMapId = state.mapId;
  const lobbyMode = state.mode;
  const lobbyBudget = state.pointBudget;
  // Placement: the figure the player has picked up to drop next (click-to-place).
  const [placeFigureId, setPlaceFigureId] = useState<string | null>(null);
  // Marker-placement scratchpad: which card each chip sits on, and which chip
  // the next card tap will drop. Reset every round.
  const [assign, setAssign] = useState<Record<OrderMarkerValue, string | null>>({
    '1': null, '2': null, '3': null, X: null,
  });
  const [pickedMarker, setPickedMarker] = useState<OrderMarkerValue>('1');
  useEffect(() => {
    setAssign({ '1': null, '2': null, '3': null, X: null });
    setPickedMarker('1');
    setSelectedId(null);
    setPlaceFigureId(null);
    setGrappleMode(false);
    setFireLineMode(false);
    setShackleMode(false);
    setChompMode(false);
  }, [state.round, state.phase]);
  // Drop Grapple / Fire-Line / Mind-Shackle / Chomp mode when the selection changes.
  useEffect(() => {
    setGrappleMode(false);
    setFireLineMode(false);
    setShackleMode(false);
    setChompMode(false);
  }, [selectedId, state.turnNumber, state.turnSeat]);

  // --- dramatic dice-roll overlay (UI only) ---------------------------------
  // A big centered animation plays when a FRESH attack resolves. The trigger is
  // the monotonic lastAttack.seq: when it increases past the last value we saw,
  // we snapshot that attack and animate it. The ref starts at the CURRENT seq so
  // an attack already present on first mount is NOT replayed on load. Driven by
  // shared state.lastAttack ⇒ both players see the same overlay.
  const [rollAttack, setRollAttack] = useState<LastAttack | null>(null);
  const lastSeenSeqRef = useRef<number>(state.lastAttack?.seq ?? 0);
  // Same freshness mechanism for non-combat d20 rolls (initiative + d20 powers).
  const [rollD20, setRollD20] = useState<LastRoll | null>(null);
  const lastSeenRollSeqRef = useRef<number>(state.lastRoll?.seq ?? 0);

  // --- board ZOOM / PAN: scroll-wheel zooms toward the cursor, drag pans, the
  // overlay buttons zoom on the center / reset. The view is a sub-rectangle of
  // the full iso scene applied via the SVG viewBox, so the cards/UI never move. ---
  const [view, setView] = useState<{ scale: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const svgEl = useRef<SVGSVGElement | null>(null);
  const wheelFn = useRef<(e: WheelEvent) => void>(() => {});
  const onWheelNative = useRef((e: WheelEvent) => wheelFn.current(e));
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number; scale: number; id: number; moved: boolean } | null>(null);
  const draggedRef = useRef(false);
  // Attach the wheel listener non-passively (so preventDefault stops page zoom);
  // a ref callback (re)binds whenever the board <svg> mounts/unmounts.
  const setSvgRef = useCallback((node: SVGSVGElement | null) => {
    if (svgEl.current) svgEl.current.removeEventListener('wheel', onWheelNative.current);
    svgEl.current = node;
    if (node) node.addEventListener('wheel', onWheelNative.current, { passive: false });
  }, []);
  useEffect(() => {
    const la = state.lastAttack;
    if (!la) return;
    if (la.seq > lastSeenSeqRef.current) {
      lastSeenSeqRef.current = la.seq;
      // Only animate when there are dice to show (defensive — a real attack
      // always rolls ≥1 attack die).
      if (la.attackRoll.length > 0 || la.defenseRoll.length > 0) setRollAttack(la);
    }
  }, [state.lastAttack]);
  useEffect(() => {
    const lr = state.lastRoll;
    if (!lr) return;
    if (lr.seq > lastSeenRollSeqRef.current) {
      lastSeenRollSeqRef.current = lr.seq;
      if (lr.dice.length > 0) setRollD20(lr);
    }
  }, [state.lastRoll]);

  const map = MAPS[state.mapId];
  // The effective per-seat start zones: the multiplayer STAR assigns its six
  // points to seats by player count (`zonesByCount`); the 2-player rectangles
  // fall back to their authored zones. Used for the per-viewer flip + the
  // placement tint (mirrors the engine's `startZoneFor`).
  const startZones: Record<number, HexKey[]> =
    (map?.zonesByCount?.[state.players.length] ?? map?.startZones) ?? {};
  const me = state.players.find(p => p.playerId === currentUserId);
  const turnPlayer = state.players.find(p => p.seat === state.turnSeat);
  // The winning SIDE (for the end banner): everyone sharing the winner's effective
  // team (an unassigned winner = a side of one). Names the team in a team game.
  const effTeam = (p: { team?: number; seat: number }) => p.team ?? -1 - p.seat;
  const winners = state.winnerSeat != null
    ? state.players.filter(p => effTeam(p) === effTeam(state.players.find(q => q.seat === state.winnerSeat)!))
    : [];
  const winnerLabel = winners.length === 0
    ? '—'
    : winners.length === 1
      ? winners[0].username
      : `Team ${String.fromCharCode(64 + (winners[0].team ?? 1))} — ${winners.map(w => w.username).join(' & ')}`;
  const placing = state.phase === 'playing' && state.subPhase === 'place_markers';
  const myTurn =
    state.phase === 'playing' && state.subPhase === 'turns' && !!me && state.turnSeat === me.seat;
  const canAct = myTurn && !disabled;
  const iAmReady = !!me && state.markersReady.includes(me.seat);

  // --- slice 5: placement phase (arrange your figures in your start zone) -----
  const placement = state.phase === 'placement';
  const iPlacementReady = !!me && (state.placementReady ?? []).includes(me.seat);
  const canPlace = placement && !!me && !iPlacementReady && !disabled;
  const myHand = placement && me ? (state.hand?.[me.seat] ?? []) : [];
  // Empty own start-zone hexes I may drop a figure on (engine single-source).
  const placeHexes = useMemo(() => {
    if (!canPlace || !me) return new Set<HexKey>();
    // Highlight the legal LEAD hexes for the figure being placed: a double-space
    // figure needs two empty same-level zone hexes, so it uses placeable2Leads.
    const toPlaceId = placeFigureId ?? (state.hand?.[me.seat] ?? [])[0];
    const f = toPlaceId ? state.figures.find(x => x.id === toPlaceId) : null;
    const cardId = f ? state.cards.find(c => c.uid === f.cardUid)?.cardId : null;
    const is2 = cardId ? HS_CARDS[cardId]?.baseSize === 2 : false;
    return is2 ? placeable2Leads(state, me.seat) : placeableHexes(state, me.seat);
  }, [state, me, canPlace, placeFigureId]);
  const activeCardUid = getActiveCardUid(state);
  const activeCard = state.cards.find(c => c.uid === activeCardUid);
  const activeCardDef = HS_CARDS[activeCard?.cardId ?? ''];

  // --- slice 4: pending choice + special-power availability (only mine) ------
  const pending = state.pendingChoice;
  const myChoice = !!me && pending != null && pending.seat === me.seat ? pending : null;
  // The Tarn Berserker Charge prompt: my Tarn turn, ≥1 Tarn moved, none
  // attacked, the charge not spent, and no other choice open.
  const movedActiveCard =
    activeCardUid != null &&
    state.movedFigureIds.some(id => state.figures.find(f => f.id === id)?.cardUid === activeCardUid);
  const canBerserk =
    myTurnReady(state, me) &&
    activeCard?.cardId === 'tarn_vikings' &&
    movedActiveCard &&
    state.turnAttacks.length === 0 &&
    !state.berserkerSpent &&
    !pending;
  // The Marro Water Clone prompt: my Marro turn, ≥1 Marro moved, none attacked,
  // not already cloned, no choice open.
  const canWaterClone =
    myTurnReady(state, me) &&
    activeCard?.cardId === 'marro_warriors' &&
    movedActiveCard &&
    state.turnAttacks.length === 0 &&
    !state.waterClonedThisTurn &&
    !pending;
  // slice 6: Syvarris's DOUBLE ATTACK — after his FIRST attack he MAY attack one
  // more time. Surface a hint (the engine keeps his targets highlighted on its
  // own, since legalTargets still allows him while his attack count < 2). True
  // when my Syvarris is the active card and he has attacked exactly once.
  const canDoubleAttack =
    myTurnReady(state, me) &&
    activeCard?.cardId === 'syvarris' &&
    state.turnAttacks.length === 1 &&
    !pending;

  const seatColor = (seat: number) => {
    const idx = state.players.findIndex(p => p.seat === seat);
    // In a team game, ALLIES share their team colour so sides read at a glance;
    // free-for-all keeps each seat's own colour.
    const team = state.players[idx]?.team;
    if (team !== undefined) return teamColorById(team);
    return state.players[idx]?.accent_color || SEAT_COLORS[idx] || '#a3a3a3';
  };

  const selected = state.figures.find(f => f.id === selectedId) ?? null;

  // --- figure-presentation slice: rotate control ----------------------------
  // A selected OWN figure can be re-oriented while I'm placing my army OR on my
  // turn. orientationOptions is the single engine source for the legal facings:
  // a 2-hex figure swings its trailing hex among free same-level neighbours
  // (engagedBlocked → it must MOVE to reposition, so we disable the control); a
  // 1-hex figure turns purely cosmetically (all six directions always legal).
  const canOrientNow =
    !!selected && !!me && selected.ownerSeat === me.seat && !disabled &&
    (canAct || (placement && !iPlacementReady));
  const orientInfo = useMemo(
    () => (canOrientNow && selected ? orientationOptions(state, selected.id) : null),
    [canOrientNow, selected, state],
  );
  const rotateBlocked = !!orientInfo && orientInfo.baseSize === 2 && orientInfo.engagedBlocked && !placement;
  const rotateFig = useCallback(
    (delta: 1 | -1) => {
      if (!orientInfo || !selected || orientInfo.validDirs.length === 0) return;
      const dirs = orientInfo.validDirs;
      const here = dirs.indexOf(orientInfo.currentDir);
      const from = here >= 0 ? here : (delta > 0 ? -1 : 0);
      const next = dirs[(((from + delta) % dirs.length) + dirs.length) % dirs.length];
      onOrient(selected.id, next);
    },
    [orientInfo, selected, onOrient],
  );

  // Engine-derived legality for the selected figure (empty when not my figure
  // or it has already moved/attacked — the engine helpers encode all of that).
  // slice 7: the Grapple Gun's 1-space climb-anywhere set (Drake only; empty for
  // any other figure or once he has moved) — the single-source engine helper, so
  // the highlight matches what grapple_move will accept.
  const grappleHexes = useMemo(
    () => (canAct && selected ? grappleDestinations(state, selected.id) : new Set<HexKey>()),
    [state, selected, canAct],
  );
  // Drake's Grapple Gun is offered only when there is at least one legal 1-space
  // climb target (and he hasn't moved — grappleDestinations encodes both).
  const canGrapple = grappleHexes.size > 0;
  // While Grapple-Gun mode is on, the move highlights ARE the grapple set; the
  // hex click routes to grapple_move instead of move_figure.
  const destinations = useMemo(
    () =>
      canAct && selected && !fireLineMode
        ? grappleMode
          ? grappleHexes
          : legalDestinations(state, selected.id)
        : new Set<HexKey>(),
    [state, selected, canAct, grappleMode, grappleHexes, fireLineMode],
  );
  const targets = useMemo(
    () => (canAct && selected && !fireLineMode ? new Set(legalTargets(state, selected.id)) : new Set<string>()),
    [state, selected, canAct, fireLineMode],
  );
  // slice 8: Mimring FIRE LINE — offered when his special attack is available
  // (his card active + he hasn't attacked). Each on-board line hex maps to its
  // direction, so a click in Fire-Line mode resolves the chosen straight line.
  const canFire = !!(canAct && selected && canFireLine(state, selected.id));
  const fireLineDirs = useMemo(() => {
    const m = new Map<HexKey, number>();
    if (canFire && selected) {
      for (let d = 0; d < 6; d++) {
        for (const k of fireLineSpaces(state, selected.id, d)) if (!m.has(k)) m.set(k, d);
      }
    }
    return m;
  }, [state, selected, canFire]);

  // slice 8: Ne-Gok-Sa MIND SHACKLE — offered when my active Ne-Gok-Sa has an
  // adjacent enemy and hasn't attacked. In shackle mode the adjacent enemy
  // figures (the engine's single-source target set) highlight; a click sends it.
  const canShackle = !!(canAct && me && canMindShackle(state, me.seat));
  const shackleTargets = useMemo(
    () => (shackleMode && me ? new Set(mindShackleTargets(state, me.seat)) : new Set<string>()),
    [shackleMode, me, state],
  );

  // slice 8: Grimnak CHOMP. canDoChomp offers the toggle; chompTargetSet is the
  // adjacent medium/small enemies a figure click will Chomp (server rolls the
  // d20 — Squad figures die automatically, Heroes on 16+).
  const canDoChomp = !!(canAct && me && canChomp(state, me.seat));
  const chompTargetSet = useMemo(
    () => (chompMode && me ? new Set(chompTargets(state, me.seat)) : new Set<string>()),
    [chompMode, me, state],
  );

  // slice 8: Airborne GRENADE SPECIAL ATTACK. canThrowGrenade offers the
  // initiate button; once the throw sequence is open, grenadeChoice holds it and
  // grenadeTargetSet is the CURRENT Elite's in-range figures (each click resolves
  // one throw, then the engine advances to the next Elite).
  const canThrowGrenade = !!(canAct && me && canGrenade(state, me.seat));
  const grenadeChoice = myChoice?.kind === 'grenade_throw' ? myChoice : null;
  const grenadeTargetSet = useMemo(
    () => (grenadeChoice ? new Set(grenadeTargets(state, grenadeChoice.throwers[0])) : new Set<string>()),
    [grenadeChoice, state],
  );

  // slice 8b: Big-Hero special-power availability + target lists for the control
  // panel. The active card's living figure IS the Big Hero (Hero cards have one
  // figure). Each list comes from the engine's single-source helper, so the panel
  // can never offer an illegal choice — and the engine re-validates regardless.
  const bhHeroId =
    canAct && activeCardUid ? state.figures.find(f => f.cardUid === activeCardUid && f.at != null)?.id : undefined;
  const bhId = activeCardDef?.id;
  const iceList = bhHeroId && bhId === 'nilfheim' ? iceShardTargets(state, bhHeroId) : [];
  const qLeft = bhId === 'major_q9' ? queglixDiceLeft(state) : 0;
  const qList = bhHeroId && bhId === 'major_q9' && qLeft > 0 ? queglixTargets(state, bhHeroId) : [];
  const wildList = bhHeroId && bhId === 'jotun' ? wildSwingTargets(state, bhHeroId) : [];
  const acidList = canAct && me && bhId === 'braxas' ? acidBreathTargets(state, me.seat) : [];
  const throwList = canAct && me && bhId === 'jotun' ? throwTargets(state, me.seat) : [];
  const carryList = canAct && me && bhId === 'theracus' ? carryPassengers(state, me.seat) : [];
  const anyBigHeroPower =
    iceList.length || qList.length || wildList.length || acidList.length || throwList.length || carryList.length;
  /** Readable label for a figure id (card short name + squad index + hex). */
  const figName = (id: string): string => {
    const f = state.figures.find(x => x.id === id);
    if (!f) return id;
    const cd = HS_CARDS[state.cards.find(c => c.uid === f.cardUid)?.cardId ?? ''];
    return `${cd?.shortName ?? '?'}${cd?.type === 'squad' ? ' #' + f.index : ''} (${f.at})`;
  };

  // slice 8: Airborne Elite THE DROP — offered at round start (place_markers) to
  // the Airborne owner. In drop mode, legal empty hexes highlight; clicking picks
  // up to `dropReserveCount` of them (mutually non-adjacent), then Deploy rolls.
  const canDoDrop = !!(me && canTheDrop(state, me.seat));
  const dropReserveCount = me ? state.figures.filter(f => f.ownerSeat === me.seat && f.reserve).length : 0;
  const dropLegalSet = useMemo(
    () => (dropMode && me ? new Set(theDropHexes(state, me.seat)) : new Set<HexKey>()),
    [dropMode, me, state],
  );

  // Activation highlighting (UI only): during MY turn, classify each figure of
  // the ACTIVE card so the board can ring it —
  //   'move'   → has not moved yet (bright green: can move)
  //   'attack' → has moved but still has an attack left (amber: can attack)
  //   'done'   → moved AND out of attacks (dimmed, no ring)
  // Non-active-card and enemy figures are absent from the map (render normally).
  // "Attacks left" mirrors the engine's maxAttacks: 2 for Syvarris (Double
  // Attack), else 1 — computed inline since maxAttacks isn't exported.
  const activation = useMemo(() => {
    const m = new Map<string, 'move' | 'attack' | 'done'>();
    if (!myTurn || activeCardUid == null) return m;
    for (const f of state.figures) {
      if (f.at == null || f.cardUid !== activeCardUid) continue;
      const moved = state.movedFigureIds.includes(f.id);
      const maxAtt = activeCard?.cardId === 'syvarris' ? 2 : 1;
      const attacksUsed = state.turnAttacks.filter(a => a.attackerId === f.id).length;
      const canStillAttack = attacksUsed < maxAtt;
      if (!moved) m.set(f.id, 'move');
      else if (canStillAttack) m.set(f.id, 'attack');
      else m.set(f.id, 'done');
    }
    return m;
  }, [myTurn, activeCardUid, activeCard, state.figures, state.movedFigureIds, state.turnAttacks]);

  // slice 4: the NEXT Water Clone landing the player must pick (the placement at
  // index chosen.length). Its same-level adjacent options light up the board;
  // clicking one resolves it.
  const clonePlacement =
    myChoice?.kind === 'water_clone_place' ? myChoice.placements[myChoice.chosen.length] : null;
  const cloneChosen = myChoice?.kind === 'water_clone_place' ? myChoice.chosen : [];
  const cloneOptions = useMemo(
    // Exclude hexes already taken by an earlier clone this resolution (the
    // engine rejects them too) so the board never highlights an invalid landing.
    () => new Set<HexKey>((clonePlacement?.options ?? []).filter(h => !cloneChosen.includes(h))),
    [clonePlacement, cloneChosen],
  );

  // ----- 2.5D ISOMETRIC geometry (renderer; board.ts owns the pure math) -----
  // Same data as the flat board, projected to stacked hex PRISMS via the iso
  // helpers. The per-viewer 180° flip now happens in AXIAL space (mirror the
  // (col,row) of every cell) BEFORE projecting — so my start zone reads at the
  // bottom-front, exactly as the flat renderer flipped hex centers. Heights come
  // from the cell record (the engine already stores them).
  const cells = Object.values(map?.cells ?? {});
  // Orient so the VIEWER's own start zone is at the bottom-front. Decision is
  // based on the static start zones, fixed for the whole game (seat 0 starts at
  // the top → flips; seat 1 already sits at the bottom).
  const myZone = me ? (startZones[me.seat] ?? []) : [];
  const myAvgRow = myZone.length
    ? myZone.reduce((s, k) => s + axialToOffset(k).row, 0) / myZone.length
    : 0;
  const flip = myZone.length > 0 && map != null && myAvgRow < (map.rows - 1) / 2;
  const cols = map?.cols ?? 0;
  const rows = map?.rows ?? 0;
  // The viewer flip as an axial-space transform: mirror the offset (col,row)
  // about the grid center, then back to an axial key. Identity when not flipped.
  const flipKey = (key: HexKey): HexKey => {
    if (!flip) return key;
    const { col, row } = axialToOffset(key);
    const { q, r } = offsetToAxial(cols - 1 - col, rows - 1 - row);
    return hexKey(q, r);
  };
  const heightOf = (key: HexKey) => map?.cells[key]?.height ?? 0;
  // Scene bounds over the FLIPPED tops + column bases → the SVG viewBox (scaled
  // by HEX, padded). Computing over the flipped keys keeps the framing tight
  // regardless of orientation.
  const bounds = isoSceneBounds(cells.map(c => ({ key: flipKey(`${c.q},${c.r}`), height: c.height })));
  const minX = bounds.minX * HEX;
  const minY = bounds.minY * HEX;
  // Standees rise above their tile top (+ a wound pip above the head), which the
  // tile-only scene bounds don't account for — reserve extra TOP headroom so a
  // back-row figure is never clipped. Sized to the TALLEST standee actually on
  // the board (height-scaled), so it stays tight with only humans but expands for
  // a Grimnak/Mimring.
  const maxStandeeRise = state.figures.reduce((m, f) => {
    if (f.at == null) return m;
    const c = state.cards.find(cc => cc.uid === f.cardUid);
    const d = c ? HS_CARDS[c.cardId] : undefined;
    return Math.max(m, (d?.baseSize === 2 ? 2.0 : 1.7) * standeeScale(d?.height));
  }, 1.7);
  const STANDEE_HEADROOM = HEX * (maxStandeeRise + 0.4);
  const W = (bounds.maxX - bounds.minX) * HEX + 2 * (HEX + PAD);
  const H = (bounds.maxY - bounds.minY) * HEX + 2 * (HEX + PAD) + STANDEE_HEADROOM;
  // Unit→screen: scale by HEX and translate so the scene's top-left sits at PAD,
  // pushed down by the standee headroom so figures fit above the back row.
  const place = (p: { x: number; y: number }) => ({
    x: p.x * HEX - minX + HEX + PAD,
    y: p.y * HEX - minY + HEX + PAD + STANDEE_HEADROOM,
  });
  // Iso TOP-face CENTER of a real-key cell (figures/glyphs/badges anchor here).
  const toScreen = (key: HexKey) => place(isoTopCenter(flipKey(key), heightOf(key)));
  // Iso TOP hexagon screen points (the clickable polygon + highlight outline).
  const topHexPts = (key: HexKey, scale = 1) =>
    isoTopHexCorners(flipKey(key), heightOf(key), scale).map(place);
  // Iso column SIDE faces (screen quads + per-face shade) for the prism.
  const sideFaces = (key: HexKey) =>
    isoSideFaces(flipKey(key), heightOf(key)).map(f => ({
      pts: f.pts.map(place),
      shade: f.shade,
    }));
  // Cells sorted back-to-front (painter's algorithm) on their FLIPPED depth, so
  // nearer/taller prisms overlap farther ones correctly.
  const drawCells = isoSortByDepth(cells, c => {
    const { q, r } = parseHexKey(flipKey(`${c.q},${c.r}`));
    return { q, r, height: c.height };
  });
  // Polygon-points string for an iso top hexagon (clickable target / outline).
  const ptsStr = (pts: { x: number; y: number }[]) => pts.map(p => `${p.x},${p.y}`).join(' ');

  const figureAt = (key: HexKey) => state.figures.find(f => f.at === key) ?? null;
  // A figure OCCUPYING this hex — its anchor OR the trailing hex of a double-
  // space figure. Drives clicks / occupancy; `figureAt` (anchor only) drives the
  // one-time standee draw so a 2-hex figure isn't drawn twice.
  const occupantAt = (key: HexKey) =>
    state.figures.find(f => f.at === key || f.at2 === key) ?? null;

  // Current view rectangle (in iso-scene units). Null = full frame (the default,
  // identical to before zoom existed).
  const vb = view
    ? { x: view.x, y: view.y, w: W / view.scale, h: H / view.scale }
    : { x: 0, y: 0, w: W, h: H };
  // Clamp a candidate view: scale in [1,6], and keep the rectangle inside the
  // scene. Scale 1 collapses back to the full-frame (null) view.
  function clampView(scale: number, x: number, y: number) {
    const s = Math.min(6, Math.max(1, scale));
    if (s <= 1.001) return null;
    const w = W / s, h = H / s;
    return { scale: s, x: Math.min(W - w, Math.max(0, x)), y: Math.min(H - h, Math.max(0, y)) };
  }
  // The actually-rendered content box inside the (letterboxed) <svg> element, so
  // a client pixel maps to the right scene coordinate.
  function contentMetrics() {
    const el = svgEl.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const cAR = W / H, eAR = r.width / r.height;
    let cw: number, ch: number, px: number, py: number;
    if (eAR > cAR) { ch = r.height; cw = ch * cAR; px = (r.width - cw) / 2; py = 0; }
    else { cw = r.width; ch = cw / cAR; px = 0; py = (r.height - ch) / 2; }
    return { left: r.left, top: r.top, cw, ch, px, py };
  }
  function zoomAtCenter(f: number) {
    const ns = Math.min(6, Math.max(1, (view ? view.scale : 1) * f));
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    setView(clampView(ns, cx - W / ns / 2, cy - H / ns / 2));
  }
  // Keep the native wheel handler closed over THIS render's view/geometry.
  wheelFn.current = (e: WheelEvent) => {
    e.preventDefault();
    const m = contentMetrics(); if (!m) return;
    const nx = Math.min(1, Math.max(0, (e.clientX - m.left - m.px) / m.cw));
    const ny = Math.min(1, Math.max(0, (e.clientY - m.top - m.py) / m.ch));
    const ptx = vb.x + nx * vb.w, pty = vb.y + ny * vb.h;
    const ns = Math.min(6, Math.max(1, (view ? view.scale : 1) * Math.exp(-e.deltaY * 0.0015)));
    setView(clampView(ns, ptx - nx * (W / ns), pty - ny * (H / ns)));
  };

  function clickHex(key: HexKey) {
    // A drag that panned the board must not also register as a hex click.
    if (draggedRef.current) { draggedRef.current = false; return; }
    // slice 5: placement — click your own placed figure to pick it up (unplace);
    // click a highlighted empty start-zone hex to drop the picked figure there.
    if (canPlace) {
      const onHex = occupantAt(key);
      if (onHex && onHex.ownerSeat === me!.seat) {
        // Picking up a placed figure returns it to hand; clicking a hand figure
        // already-picked toggles selection.
        onUnplaceFigure(onHex.id);
        setPlaceFigureId(null);
        return;
      }
      if (!onHex && placeHexes.has(key)) {
        const toPlace = placeFigureId ?? myHand[0];
        if (toPlace) {
          onPlaceFigure(toPlace, key);
          setPlaceFigureId(null);
        }
      }
      return;
    }
    // Water Clone placement takes priority: click a highlighted same-level
    // adjacent hex to land the returning Marro Warrior.
    if (cloneOptions.has(key) && !disabled) {
      onResolveChoice({ kind: 'water_clone_place', hex: key });
      return;
    }
    // slice 8: grenade throw — clicking a highlighted in-range figure lobs the
    // current Elite's grenade at it (the server rolls; splash hits its neighbours).
    if (grenadeChoice && !disabled) {
      const occG = occupantAt(key);
      if (occG && grenadeTargetSet.has(occG.id)) onGrenadeThrow(occG.id);
      return;
    }
    // slice 8: The Drop landing selection (round start; works outside a turn).
    // Click a highlighted legal hex to add/remove it; reject one adjacent to an
    // already-picked landing or once the reserve count is reached.
    if (dropMode && !disabled) {
      if (dropLegalSet.has(key)) {
        setDropPicks(prev =>
          prev.includes(key)
            ? prev.filter(k => k !== key)
            : prev.some(p => neighborKeys(p).includes(key)) || prev.length >= dropReserveCount
              ? prev
              : [...prev, key],
        );
      }
      return;
    }
    if (!canAct) return;
    // slice 8: Fire-Line mode — clicking a highlighted line space fires that
    // straight line (Mimring's special attack), replacing his normal attack.
    if (fireLineMode && selected) {
      const dir = fireLineDirs.get(key);
      if (dir != null) { onFireLine(selected.id, dir); setFireLineMode(false); }
      return;
    }
    const occ = occupantAt(key);
    // slice 8: Mind-Shackle mode — clicking a highlighted adjacent enemy figure
    // attempts Ne-Gok-Sa's Mind Shackle on that figure's whole Army Card (the
    // server rolls the d20; a natural 20 seizes the card).
    if (shackleMode) {
      if (occ && shackleTargets.has(occ.id)) { onMindShackle(occ.id); setShackleMode(false); }
      return;
    }
    // slice 8: Chomp mode — clicking a highlighted adjacent medium/small enemy
    // Chomps it (server rolls the d20; Squad figures die automatically).
    if (chompMode) {
      if (occ && chompTargetSet.has(occ.id)) { onChomp(occ.id); setChompMode(false); }
      return;
    }
    // Attack: the clicked hex holds an enemy I can currently target (a 2-hex
    // enemy is targetable by clicking EITHER of its hexes).
    if (occ && selected && occ.ownerSeat !== me!.seat) {
      if (targets.has(occ.id)) {
        onAttack(selected.id, occ.id);
        // slice 6: keep Syvarris selected after his first attack so his targets
        // stay highlighted for the optional Double Attack. Others deselect.
        const attackerCardId = state.cards.find(c => c.uid === selected.cardUid)?.cardId;
        if (!(attackerCardId === 'syvarris' && state.turnAttacks.length === 0)) setSelectedId(null);
      }
      return;
    }
    // Move: a legal destination (the LEAD hex for a double-space figure, which
    // may overlap the figure's own current footprint as it slides forward). In
    // Grapple-Gun mode the destination set IS the grapple set.
    if (selected && destinations.has(key)) {
      if (grappleMode) { onGrappleMove(selected.id, key); setGrappleMode(false); }
      else onMoveFigure(selected.id, key);
      return;
    }
    // Select / deselect one of my own figures (click either hex of a 2-hex one).
    if (occ && occ.ownerSeat === me!.seat) {
      setSelectedId(occ.id === selectedId ? null : occ.id);
      return;
    }
  }

  // Army roster panel data: cards with surviving figures, wounds, markers.
  const roster = state.players.map(pl => ({
    pl,
    cards: state.cards.filter(c => c.ownerSeat === pl.seat).map(c => {
      const def = HS_CARDS[c.cardId];
      const figs = state.figures.filter(f => f.cardUid === c.uid);
      const alive = figs.filter(f => f.at != null).length;
      return { uid: c.uid, def, alive, heroWounds: figs[0]?.wounds ?? 0, markers: c.orderMarkers };
    }),
  }));
  function assignPicked(cardUid: string) {
    const next = { ...assign, [pickedMarker]: cardUid };
    setAssign(next);
    const nextUnassigned = MARKERS.find(v => !next[v]);
    if (nextUnassigned) setPickedMarker(nextUnassigned);
  }
  const allAssigned = MARKERS.every(v => assign[v]);

  function lockIn() {
    if (!allAssigned) return;
    onPlaceMarkers(MARKERS.map(v => ({ marker: v, cardUid: assign[v]! })));
  }

  // One player's army-card row (markers above each card, wounds, active-card
  // outline, marker-placement controls when it's my strip during placement).
  // Hovering a card pops the full-card popover (CardHoverPanel). Rendered for
  // the opponent (above the board) and for me (below it) in the three-zone
  // layout, so each player's cards sit on the same side as their figures.
  function renderArmyRow(seat: number, collapsible = false) {
    const entry = roster.find(r => r.pl.seat === seat);
    if (!entry) return null;
    const { pl, cards } = entry;
    const isMe = !!me && pl.seat === me.seat;
    const placingMine = placing && isMe && !iAmReady;
    const isActive = seat === state.turnSeat && state.subPhase === 'turns';
    // A collapsible (opponent) row defaults OPEN when it's that player's turn or
    // in a 2-player game, collapsed otherwise; the user can toggle. My own row
    // never collapses.
    const expanded = !collapsible || (openSeats[seat] ?? (state.players.length <= 2 || isActive));
    const aliveCards = cards.filter(c => c.alive > 0).length;
    return (
      <div className={'w-full rounded-lg border bg-neutral-900/40 px-2 py-1 ' + (isActive ? 'border-amber-700/70' : 'border-neutral-800')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={collapsible ? () => setOpenSeats(s => ({ ...s, [seat]: !expanded })) : undefined}
            className={'flex items-center gap-1.5 ' + (collapsible ? 'cursor-pointer hover:opacity-90' : 'cursor-default')}
          >
            {collapsible && <span className="text-[10px] text-neutral-500">{expanded ? '▾' : '▸'}</span>}
            <span className="text-xs font-bold" style={{ color: seatColor(pl.seat) }}>{pl.username}{isMe ? ' (you)' : ''}</span>
            {isActive && <span className="rounded bg-amber-900/50 px-1 text-[9px] font-semibold text-amber-300">turn</span>}
            {collapsible && !expanded && <span className="text-[10px] text-neutral-500">· {aliveCards} card{aliveCards === 1 ? '' : 's'} left</span>}
          </button>
          {placingMine && (
            <span className="flex items-center gap-1">
              {MARKERS.map(v => (
                <button
                  key={v}
                  onClick={() => setPickedMarker(v)}
                  disabled={disabled}
                  title={v === 'X' ? 'Decoy — never takes a turn' : `Your turn ${v} this round`}
                  className={
                    'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-extrabold transition ' +
                    (pickedMarker === v
                      ? 'border-amber-400 bg-amber-500 text-neutral-950'
                      : assign[v]
                        ? 'border-amber-700 bg-neutral-800 text-amber-300'
                        : 'border-neutral-600 bg-neutral-900 text-neutral-300 hover:border-neutral-400')
                  }
                >
                  {v}
                </button>
              ))}
              <button
                onClick={() => { setAssign({ '1': null, '2': null, '3': null, X: null }); setPickedMarker('1'); }}
                disabled={disabled || MARKERS.every(v => !assign[v])}
                title="Clear all placed markers"
                className="ml-1 rounded-md border border-neutral-600 px-2 py-0.5 text-xs font-semibold text-neutral-300 transition hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
              <button
                onClick={lockIn}
                disabled={disabled || !allAssigned}
                className="rounded-md border-2 border-emerald-600 px-2 py-0.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                🔒 Lock in
              </button>
            </span>
          )}
          {/* collapsed summary — tiny portraits + count, click the header to open */}
          {collapsible && !expanded && (
            <span className="flex items-center gap-1">
              {cards.map(c => (
                <span key={c.uid} className={'h-6 w-6 overflow-hidden rounded-full border border-neutral-700 ' + (c.alive === 0 ? 'opacity-40 grayscale' : '')}>
                  <Portrait cardId={c.def.id} letter={c.def.letter} accent={seatColor(seat)} />
                </span>
              ))}
            </span>
          )}
        </div>
        {/* Compact cards — wrap to a second line if a wide army doesn't fit. */}
        {expanded && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {cards.map(({ uid, def, alive, heroWounds, markers }) => {
            const canAssign = placingMine && alive > 0;
            const markersToShow = placingMine
              ? MARKERS.filter(v => assign[v] === uid).map(v => ({ marker: v, revealed: false }))
              : markers;
            const active = uid === activeCardUid && state.subPhase === 'turns';
            const dead = alive === 0;
            // COMPACT play-view tile: a SMALL fixed portrait (~80px tall, the
            // 886/1432 aspect ⇒ ~50px wide) so the strip is thin and the MAP is
            // the focus. The scanned art fills it; a tiny name strip is layered
            // BEHIND the art and shows through only if the image fails to load
            // (CardArt hides on error). Full detail is in the hover popover.
            // Active card → amber outline/ring; dead card → dim + grayscale art.
            // COMPACT data-driven card: figure cut-out portrait + colour-coded
            // stat pills (legible at a glance; the full scan is on hover). Active
            // card → amber ring; a card with no surviving figures dims out.
            const panel = (
              <div
                className={
                  'relative w-[188px] overflow-hidden rounded-lg border ' +
                  (active ? 'border-amber-500 ring-2 ring-amber-500/60 ' : 'border-neutral-800 ') +
                  (dead ? 'opacity-45 grayscale' : '')
                }
              >
                {/* name banner + live status (hero wounds / squad survivors) */}
                <div className="flex items-center justify-between gap-1 border-b border-neutral-800 bg-neutral-900 px-2 py-1">
                  <span className={'truncate text-[11px] font-bold ' + (dead ? 'line-through' : '')} style={{ color: dead ? '#737373' : seatColor(seat) }}>
                    {def.name}
                  </span>
                  <span className="shrink-0 text-[9px] font-semibold text-neutral-400 tabular-nums">
                    {def.type === 'hero'
                      ? <WoundPips life={def.life} wounds={dead ? def.life : heroWounds} />
                      : `${alive}/${def.figures}`}
                  </span>
                </div>
                {/* portrait + 2×3 stat grid */}
                <div className="flex gap-1.5 bg-neutral-950/70 p-1.5">
                  <div className="h-[80px] w-[54px] shrink-0 overflow-hidden rounded bg-neutral-800/50">
                    <Portrait cardId={def.id} letter={def.letter} accent={seatColor(seat)} />
                  </div>
                  <div className="grid flex-1 grid-cols-2 content-start gap-1">
                    <StatPill label="Life" value={def.life} tone="bg-rose-950/60 text-rose-300" />
                    <StatPill label="Move" value={def.move} tone="bg-emerald-950/60 text-emerald-300" />
                    <StatPill label="Rng" value={def.range} tone="bg-sky-950/60 text-sky-300" />
                    <StatPill label="Atk" value={def.attack} tone="bg-orange-950/60 text-orange-300" />
                    <StatPill label="Def" value={def.defense} tone="bg-blue-950/60 text-blue-300" />
                    <StatPill label="Pts" value={def.points} tone="bg-amber-950/60 text-amber-300" />
                  </div>
                </div>
                {/* trait line */}
                <div className="truncate border-t border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[9px] text-neutral-400">
                  {def.species} · {def.unitClass} · H{def.height}
                </div>
              </div>
            );
            return (
              // `group` + `relative` anchor the hover popover to this compact tile.
              <div key={uid} className="group relative flex shrink-0 flex-col items-center gap-0.5">
                {/* order markers — directly ABOVE the tile */}
                <div className="flex h-5 items-center justify-center gap-0.5">
                  {markersToShow.map((m, i) => <MarkerChip key={i} m={m} size={16} />)}
                </div>
                {canAssign ? (
                  <button
                    onClick={() => assignPicked(uid)}
                    disabled={disabled}
                    className="rounded text-left transition hover:opacity-90"
                  >
                    {panel}
                  </button>
                ) : (
                  panel
                )}
                {/* My cards sit at the BOTTOM (popover above); the opponent's at
                    the TOP (popover below) — so it never runs off-screen. */}
                <CardHoverPanel cardId={def.id} placement={isMe ? 'above' : 'below'} />
              </div>
            );
          })}
        </div>
        )}
      </div>
    );
  }

  // ---------- lobby ----------
  if (state.phase === 'lobby') {
    const mapList = Object.values(MAPS);
    const count = state.players.length;
    // Quick battle auto-fills the fixed Vikings-vs-Marro 1-v-1, so it only fits 2
    // seats. Draft works for 2-6, but the chosen battlefield must carry enough
    // start zones for the seated count (mapSupportsCount = 2-player rectangles or
    // the Star Field's per-count zones). The engine enforces both on start_game;
    // we mirror them here so unusable options are visibly disabled, not error toasts.
    const quickOk = count === 2;
    const selectedMapOk = mapSupportsCount(MAPS[lobbyMapId], count);
    // --- Teams (3+ players). The host groups players into sides by colour; an
    // unassigned player is their OWN side. A team game needs ≥2 distinct sides —
    // all-on-one-team has no enemy and could never end, so Start is blocked on it.
    // The engine merges `teams` (seat→team id) + `teamBudgets` (team→points). ---
    const showTeams = lobbyMode === 'draft' && count >= 3;
    const teamsInUse = state.players.some(p => p.team !== undefined);
    const distinctSides = new Set(state.players.map(p => p.team ?? -1 - p.seat)).size;
    const teamsValid = distinctSides >= 2;
    const activeTeams = [...new Set(state.players.map(p => p.team).filter((t): t is number => t !== undefined))].sort((a, b) => a - b);
    // The engine clears any seat OMITTED from a sent `teams` map, so we always
    // rebuild the full assignment from state before applying one edit.
    const sendTeam = (seat: number, team: number | null) => {
      if (!isHost) return;
      const t: Record<number, number> = {};
      for (const p of state.players) if (p.team !== undefined) t[p.seat] = p.team;
      if (team === null) delete t[seat]; else t[seat] = team;
      onSetLobbyConfig({ teams: t });
    };
    const teamBudgetOf = (team: number) => state.teamBudgets?.[team] ?? lobbyBudget;
    const sendTeamBudget = (team: number, raw: number) => {
      if (!isHost || !Number.isFinite(raw)) return;
      const clamped = Math.max(MIN_POINT_BUDGET, Math.min(MAX_POINT_BUDGET, Math.round(raw)));
      onSetLobbyConfig({ teamBudgets: { ...(state.teamBudgets ?? {}), [team]: clamped } });
    };
    const startBlocked =
      count < 2 ||
      (lobbyMode === 'quick' && !quickOk) ||
      (lobbyMode === 'draft' && !selectedMapOk) ||
      (teamsInUse && !teamsValid);
    const startHint =
      count < 2 ? 'Waiting for at least 2 players…'
        : lobbyMode === 'quick' && !quickOk ? 'Quick battle is a 2-player preset — switch to Draft for 3-6 players.'
          : lobbyMode === 'draft' && !selectedMapOk ? `${MAPS[lobbyMapId].name} doesn't fit ${count} players — pick the Star Field (3-6).`
            : teamsInUse && !teamsValid ? 'All players are on one team — assign at least two sides.'
              : '';
    const mapBlurb: Record<string, string> = {
      training_field: 'Flat grass — learn the ropes. (2 players)',
      the_knoll: 'A 3-tier rock hill — climb for height advantage. (2 players)',
      ford_crossing: 'A water river split by a narrow ford. (2 players)',
      star_field: 'A giant 6-point star — a deploy zone per point. (3-6 players)',
    };
    return (
      <div className="flex flex-col items-center gap-4 p-6">
        <h2 className="text-xl font-bold text-amber-100">HeroScape</h2>
        <p className="max-w-md text-center text-sm text-neutral-400">
          Master Game (beta): draft an army from the 16-card roster against a point budget
          (or quick-battle the preset Vikings vs Marro), arrange your figures, then schedule
          your turns with order markers, roll for initiative, and fight on 3-D terrain — first
          to wipe out the enemy army wins.
        </p>
        <div className="text-sm text-neutral-300">
          {state.players.length} player{state.players.length === 1 ? '' : 's'} seated (2-6){state.players.length < 2 ? ' — waiting for one more…' : ''}
        </div>

        {/* Mode toggle: Draft armies vs Quick battle (host chooses) */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Mode</div>
          <div className="flex gap-2">
            {([['draft', 'Draft armies'], ['quick', 'Quick battle']] as const).map(([m, label]) => {
              const active = lobbyMode === m;
              const modeBlocked = m === 'quick' && !quickOk; // 1-v-1 preset only
              return (
                <button
                  key={m}
                  onClick={() => isHost && !modeBlocked && onSetLobbyConfig({ mode: m })}
                  disabled={!isHost || disabled || modeBlocked}
                  title={modeBlocked ? 'Quick battle is a fixed 2-player game' : undefined}
                  className={
                    'rounded-lg border-2 px-4 py-1.5 text-sm font-semibold transition ' +
                    (active ? 'border-amber-400 bg-amber-900/30 text-amber-200' : 'border-neutral-700 text-neutral-300 hover:border-neutral-500') +
                    (modeBlocked ? ' cursor-not-allowed opacity-40' : isHost ? '' : ' cursor-default opacity-90')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Point-budget presets (draft mode only) */}
        {lobbyMode === 'draft' && (
          <div className="flex flex-col items-center gap-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Point budget</div>
            <div className="flex gap-2">
              {POINT_BUDGETS.map(b => {
                const active = lobbyBudget === b;
                return (
                  <button
                    key={b}
                    onClick={() => isHost && onSetLobbyConfig({ pointBudget: b })}
                    disabled={!isHost || disabled}
                    className={
                      'rounded-lg border-2 px-3 py-1 text-sm font-bold tabular-nums transition ' +
                      (active ? 'border-amber-400 bg-amber-900/30 text-amber-200' : 'border-neutral-700 text-neutral-300 hover:border-neutral-500') +
                      (isHost ? '' : ' cursor-default opacity-90')
                    }
                  >
                    {b}
                  </button>
                );
              })}
            </div>
            {/* …or type ANY custom amount (committed on Enter / blur). The engine
                accepts MIN..MAX; out-of-range input is clamped. */}
            <div className="mt-1 flex items-center gap-2">
              <label htmlFor="hs-custom-budget" className="text-[11px] text-neutral-400">Custom</label>
              <input
                id="hs-custom-budget"
                type="number"
                inputMode="numeric"
                min={MIN_POINT_BUDGET}
                max={MAX_POINT_BUDGET}
                step={10}
                key={lobbyBudget}
                defaultValue={lobbyBudget}
                disabled={!isHost || disabled}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                onBlur={e => {
                  const raw = e.currentTarget.value.trim();
                  const n = Math.round(Number(raw));
                  if (raw === '' || !Number.isFinite(n)) { e.currentTarget.value = String(lobbyBudget); return; }
                  const clamped = Math.max(MIN_POINT_BUDGET, Math.min(MAX_POINT_BUDGET, n));
                  e.currentTarget.value = String(clamped);
                  if (isHost && clamped !== lobbyBudget) onSetLobbyConfig({ pointBudget: clamped });
                }}
                className="w-24 rounded-lg border-2 border-neutral-700 bg-neutral-900 px-2 py-1 text-center text-sm font-bold tabular-nums text-amber-200 focus:border-amber-400 focus:outline-none disabled:opacity-60"
              />
              <span className="text-[10px] text-neutral-500">{MIN_POINT_BUDGET}–{MAX_POINT_BUDGET}</span>
            </div>
          </div>
        )}

        {/* Teams (3+ players) — host groups players into sides + per-team budgets */}
        {showTeams && (
          <div className="flex w-full max-w-md flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Teams</div>
              <button
                onClick={() => isHost && onSetLobbyConfig({ teams: {} })}
                disabled={!isHost || disabled || !teamsInUse}
                title="Clear all teams — back to free-for-all"
                className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Free-for-all
              </button>
            </div>
            <div className="flex w-full flex-col gap-1">
              {[...state.players].sort((a, b) => a.seat - b.seat).map(p => (
                <div key={p.seat} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-2 py-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seatColor(p.seat) }} />
                    <span className="truncate text-neutral-200">{p.username}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {TEAM_COLORS.map((c, idx) => {
                      const team = idx + 1;
                      const on = p.team === team;
                      return (
                        <button
                          key={team}
                          onClick={() => sendTeam(p.seat, on ? null : team)}
                          disabled={!isHost || disabled}
                          title={`Team ${String.fromCharCode(65 + idx)}`}
                          className={'flex h-6 w-6 items-center justify-center rounded-md border-2 text-[10px] font-bold transition ' + (on ? 'text-neutral-900' : 'text-neutral-400 hover:border-neutral-500') + (isHost ? '' : ' cursor-default')}
                          style={{ borderColor: c, background: on ? c : 'transparent' }}
                        >
                          {String.fromCharCode(65 + idx)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {activeTeams.length > 0 && (
              <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                {activeTeams.map(team => (
                  <label key={team} className="flex items-center gap-1 text-[11px] text-neutral-400">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TEAM_COLORS[(team - 1) % TEAM_COLORS.length] }} />
                    Team {String.fromCharCode(64 + team)}
                    <input
                      type="number" min={MIN_POINT_BUDGET} max={MAX_POINT_BUDGET} step={10}
                      key={teamBudgetOf(team)} defaultValue={teamBudgetOf(team)}
                      disabled={!isHost || disabled}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      onBlur={e => {
                        const n = Math.round(Number(e.currentTarget.value));
                        if (e.currentTarget.value.trim() === '' || !Number.isFinite(n)) { e.currentTarget.value = String(teamBudgetOf(team)); return; }
                        sendTeamBudget(team, n);
                      }}
                      className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-center tabular-nums text-amber-200 focus:border-amber-400 focus:outline-none disabled:opacity-60"
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="text-[10px] text-neutral-500">
              {!isHost ? 'The host sets the teams.' : teamsInUse ? 'Unassigned players fight solo. Empty team budgets use the points above.' : 'Tap a colour to put players on the same side (allies). Leave empty for free-for-all.'}
            </div>
          </div>
        )}

        {/* Battlefield picker (host chooses; others see the selection) */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Battlefield
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {mapList.map(m => {
              const active = lobbyMapId === m.id;
              const fits = mapSupportsCount(m, count); // enough start zones for the seated count
              const mapDisabled = !isHost || disabled || !fits;
              return (
                <button
                  key={m.id}
                  onClick={() => isHost && fits && onSetLobbyConfig({ mapId: m.id })}
                  disabled={mapDisabled}
                  title={!fits ? `${m.name} doesn't fit ${count} player${count === 1 ? '' : 's'}` : mapBlurb[m.id]}
                  className={
                    'flex w-40 flex-col items-start rounded-lg border-2 px-3 py-2 text-left transition ' +
                    (active
                      ? 'border-amber-400 bg-amber-900/30'
                      : 'border-neutral-700 hover:border-neutral-500') +
                    (!fits ? ' cursor-not-allowed opacity-40' : isHost ? '' : ' cursor-default opacity-90')
                  }
                >
                  <span className={'text-sm font-bold ' + (active ? 'text-amber-200' : 'text-neutral-200')}>
                    {m.name}
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {m.cols}×{m.rows} · {mapBlurb[m.id] ?? ''}
                  </span>
                </button>
              );
            })}
          </div>
          {!isHost && (
            <div className="mt-0.5 text-[10px] text-neutral-500">The host chooses the battlefield.</div>
          )}
        </div>

        {isHost && (
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => onStart(lobbyMapId, lobbyMode === 'draft' ? lobbyBudget : undefined, lobbyMode)}
              disabled={disabled || startBlocked}
              title={startBlocked ? startHint : undefined}
              className="rounded-lg border-2 border-emerald-600 px-6 py-2 font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {lobbyMode === 'draft' ? '⚔ Start the draft' : '⚔ Start the battle'}
            </button>
            {startBlocked && startHint && (
              <div className="max-w-xs text-center text-[11px] text-amber-300/80">{startHint}</div>
            )}
          </div>
        )}
        {!isHost && <div className="text-xs text-neutral-500">Waiting for the host to start.</div>}
      </div>
    );
  }

  // ---------- draft (slice 5) ----------
  if (state.phase === 'draft' && state.draft) {
    const d = state.draft;
    const myDraftSeat = me?.seat ?? null;
    const myTurnToPick = myDraftSeat != null && d.turnSeat === myDraftSeat;
    const takenBy: Record<string, number> = {};
    for (const seat of state.players.map(p => p.seat)) for (const id of d.armies[seat] ?? []) takenBy[id] = seat;
    const drafterName = state.players.find(p => p.seat === d.turnSeat)?.username;
    // Budget is shared per TEAM (allies draw from one pool); free-for-all = per seat.
    const myRemaining = myDraftSeat != null ? teamRemainingInDraft(state, myDraftSeat) : 0;
    // Forced-pass detection (mirrors the engine): no remaining pool card fits my
    // remaining budget. An EMPTY army can't pass while something is affordable.
    const myArmyEmpty = myDraftSeat != null && (d.armies[myDraftSeat] ?? []).length === 0;
    const anyAffordable = d.pool.some(id => HS_CARDS[id].points <= myRemaining);
    const canPass = myTurnToPick && !disabled && !(myArmyEmpty && anyAffordable);

    // Pool sorted CHEAPEST → most expensive (user request).
    const sortedPool = [...HS_DRAFT_POOL].sort((a, b) => HS_CARDS[a].points - HS_CARDS[b].points);

    // A drafter's panel for the top bar: name, REMAINING budget (prominent), and
    // their drafted cards as chips. Highlighted while it's their pick.
    const drafterPanel = (seat: number) => {
      const pl = state.players.find(p => p.seat === seat);
      const ids = d.armies[seat] ?? [];
      const isMe = !!me && seat === me.seat;
      const isTurn = d.turnSeat === seat;
      const remaining = teamRemainingInDraft(state, seat);
      const seatBudget = teamBudgetForSeat(state, seat);
      return (
        <div
          key={seat}
          className={
            'rounded-lg border-2 px-3 py-2 ' +
            (isTurn ? 'border-amber-400 bg-amber-900/10' : 'border-neutral-800 bg-neutral-900/40')
          }
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold" style={{ color: seatColor(seat) }}>
              {pl?.username ?? '—'}{isMe ? ' (you)' : ''}
              {isTurn && <span className="ml-2 text-[10px] font-semibold text-amber-300">drafting…</span>}
              {d.passed.includes(seat) && <span className="ml-2 text-[10px] font-semibold text-emerald-400">done ✓</span>}
            </span>
            <span className="shrink-0 text-right leading-none">
              <span className="text-xl font-extrabold tabular-nums text-amber-300">{remaining}</span>
              <span className="text-[11px] text-neutral-400"> left</span>
              <span className="block text-[10px] text-neutral-500">of {seatBudget} pts</span>
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {ids.length === 0 ? (
              <span className="text-[11px] text-neutral-500">No cards yet…</span>
            ) : (
              ids.map(id => (
                <span key={id} className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-200">
                  {HS_CARDS[id].name} <span className="tabular-nums text-amber-300/80">{HS_CARDS[id].points}</span>
                </span>
              ))
            )}
          </div>
        </div>
      );
    };

    return (
      // Draft uses the FULL width (no centered max-width box) so the 16 cards can
      // be BIG and readable, spread across the whole screen.
      <div className="flex w-full flex-col gap-3 p-3">
        {/* Whose pick */}
        <div
          className="rounded-lg border-2 px-3 py-2 text-center"
          style={{ borderColor: seatColor(d.turnSeat ?? 0) }}
        >
          <div className="text-sm font-bold" style={{ color: seatColor(d.turnSeat ?? 0) }}>
            {myTurnToPick ? '⚔ Your pick' : `${drafterName ?? '…'} is drafting`}
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-400">
            {d.remainingPicks > 1 ? `${d.remainingPicks} picks this turn` : 'pick one card or pass'} · pool sorted cheapest first
          </div>
        </div>

        {/* Drafters across the top, with remaining budget */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {me && drafterPanel(me.seat)}
          {state.players.filter(p => !me || p.seat !== me.seat).map(p => drafterPanel(p.seat))}
        </div>

        {/* Pick / pass controls (only on your turn) */}
        {myTurnToPick && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="text-[11px] text-neutral-400">Click an affordable card below to draft it</span>
            <button
              onClick={() => onDraftPass()}
              disabled={!canPass}
              title={
                !anyAffordable
                  ? 'No affordable card remains — you must pass'
                  : myArmyEmpty
                    ? 'Draft at least one card before passing'
                    : 'Finish your army under budget'
              }
              className="rounded-lg border-2 border-amber-600 px-4 py-1.5 text-sm font-semibold text-amber-300 transition hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {!anyAffordable ? 'Pass (no affordable card)' : 'Pass — finish my army'}
            </button>
          </div>
        )}

        {/* The 16-card pool — BIG readable cards that FILL the full width. The
            auto-fill / minmax(200px,1fr) track makes every card ≥200px wide and
            spreads them across the whole screen (≈6-9 per row → 2-3 rows). */}
        <div className="text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Army roster — {d.pool.length} of {sortedPool.length} left · cheapest first
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
          {sortedPool.map(id => {
            const taken = !d.pool.includes(id);
            const affordable = HS_CARDS[id].points <= myRemaining;
            const clickable = myTurnToPick && !taken && affordable && !disabled;
            return (
              <DraftCard
                key={id}
                cardId={id}
                taken={taken}
                takenByLabel={taken ? state.players.find(p => p.seat === takenBy[id])?.username : undefined}
                affordable={affordable}
                clickable={clickable}
                onPick={() => onDraftCard(id)}
              />
            );
          })}
        </div>
        <div className="text-center text-[10px] text-neutral-500">
          ⚡ powers WIP = drafts and fights with printed stats; its special power lands in a later update.
        </div>

        {/* Draft-order roll-off + log, side by side */}
        <div className="grid gap-2 sm:grid-cols-2">
          {d.rollOff.length > 0 && (
            <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-[11px] text-neutral-300">
              <div className="mb-1 font-semibold uppercase tracking-wider text-neutral-400">Draft order roll</div>
              {d.rollOff.map((attempt, i) => {
                const isLast = i === d.rollOff.length - 1;
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    {attempt.map(a => (
                      <span key={a.seat}>
                        <span style={{ color: seatColor(a.seat) }}>{state.players.find(p => p.seat === a.seat)?.username}</span>{' '}
                        <span className="font-bold tabular-nums">{a.roll}</span>
                      </span>
                    ))}
                    <span className={isLast ? 'text-amber-300' : 'text-neutral-500'}>
                      {isLast ? `→ ${state.players.find(p => p.seat === d.order[0])?.username} first` : '— tie, re-roll'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="max-h-44 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[11px] leading-relaxed text-neutral-400">
            {state.log.slice(-12).reverse().map(e => (
              <div key={e.seq} className={e.tag === 'roll' ? 'text-sky-300/80' : ''}>{e.text}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- playing / placement / finished ----------
  // Three-zone layout: LEFT RAIL = event log (tall, far left), CENTER = opponent
  // cards → board → my cards, RIGHT RAIL = banner/initiative/dice/choices/end-turn.
  // DOM order is right-rail, center, left-rail; CSS `order` reflows them on lg+ so
  // the log lands on the far left. Narrow screens stack: banner, board, cards, log.
  return (
    // On lg+ the play view fills the viewport (minus the room top bar ≈ 4rem)
    // and clips, so each column scrolls INTERNALLY (the log scrolls in place; the
    // browser window does not). The columns STRETCH to the fixed row height
    // (items-stretch) so their overflow-y-auto actually engages. Narrow screens
    // stack (flex-col) and scroll the window naturally.
    <div className="flex w-full flex-col gap-3 p-3 lg:h-[calc(100vh-4rem)] lg:flex-row lg:items-stretch lg:overflow-hidden">
      {/* Dramatic dice-roll overlay (UI only). Keyed on seq so a superseding
          attack remounts it (cancelling the prior animation's timers). */}
      {rollAttack && (
        <DiceRollOverlay
          key={rollAttack.seq}
          attack={rollAttack}
          onDismiss={() => setRollAttack(null)}
        />
      )}
      {/* d20 overlay for initiative + special powers (same freshness mechanism). */}
      {rollD20 && (
        <D20RollOverlay
          key={`r${rollD20.seq}`}
          roll={rollD20}
          onDismiss={() => setRollD20(null)}
        />
      )}
      {/* RIGHT RAIL — banner/status, initiative, last attack, choices, end turn.
          (DOM-first so it appears at the top on narrow screens; order-3 on lg+.) */}
      <div className="flex w-full shrink-0 flex-col gap-3 lg:order-3 lg:w-[290px] lg:min-h-0 lg:overflow-y-auto">
        {/* Placement status — the interactive assignment lives below the board,
            directly above your army cards. */}
        {placement ? (
          <div className="rounded-lg border-2 border-amber-700 bg-neutral-900/70 px-3 py-2 text-center">
            <div className="text-sm font-bold text-amber-300">Deploy your army</div>
            <div className="mt-1 text-xs text-neutral-400">
              {me
                ? iPlacementReady
                  ? 'Locked in — waiting for the enemy…'
                  : 'Click a figure in your tray, then a highlighted hex in your start zone. Click a placed figure to pick it up.'
                : 'Players are deploying their armies…'}
            </div>
            {me && !iPlacementReady && (
              <div className="mt-1 text-[11px] tabular-nums text-neutral-300">
                {myHand.length} in hand · {state.figures.filter(f => f.ownerSeat === me.seat && f.at != null).length} placed
              </div>
            )}
            <div className="mt-2 flex flex-col gap-0.5 border-t border-neutral-800 pt-1.5 text-[11px]">
              {state.players.filter(p => p.playerId !== currentUserId).map(p => (
                <div key={p.seat} className="flex items-center justify-between">
                  <span style={{ color: seatColor(p.seat) }}>{p.username}</span>
                  <span className={(state.placementReady ?? []).includes(p.seat) ? 'text-emerald-400' : 'text-neutral-500'}>
                    {(state.placementReady ?? []).includes(p.seat) ? 'ready ✓' : 'deploying…'}
                  </span>
                </div>
              ))}
            </div>
            {me && !iPlacementReady && (
              <button
                onClick={() => { onPlacementReady(); setPlaceFigureId(null); }}
                disabled={disabled || state.figures.filter(f => f.ownerSeat === me.seat && f.at != null).length < 1}
                className="mt-2 w-full rounded-md border-2 border-emerald-600 px-2 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                title={myHand.length > 0 ? `${myHand.length} unplaced figure(s) will be left unused` : undefined}
              >
                🔒 Ready{myHand.length > 0 ? ` (${myHand.length} unused)` : ''}
              </button>
            )}
          </div>
        ) : placing ? (
          <div className="rounded-lg border-2 border-amber-700 bg-neutral-900/70 px-3 py-2 text-center">
            <div className="text-sm font-bold text-amber-300">
              Round {state.round} — place order markers
            </div>
            <div className="mt-1 text-xs text-neutral-400">
              {me
                ? iAmReady
                  ? 'Locked in — waiting for the enemy…'
                  : 'Assign 1/2/3/X on your cards below the board, then lock in.'
                : 'Players are placing markers…'}
            </div>
            <div className="mt-2 flex flex-col gap-0.5 border-t border-neutral-800 pt-1.5 text-[11px]">
              {state.players.filter(p => p.playerId !== currentUserId).map(p => (
                <div key={p.seat} className="flex items-center justify-between">
                  <span style={{ color: seatColor(p.seat) }}>{p.username}</span>
                  <span className={state.markersReady.includes(p.seat) ? 'text-emerald-400' : 'text-neutral-500'}>
                    {state.markersReady.includes(p.seat) ? 'ready ✓' : 'placing…'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Turn / result banner */
          <div
            className="rounded-lg border-2 px-3 py-2 text-center text-sm font-bold"
            style={{
              borderColor: state.phase === 'finished'
                ? '#fbbf24'
                : seatColor(state.turnSeat ?? 0),
              color: state.phase === 'finished' ? '#fde68a' : seatColor(state.turnSeat ?? 0),
            }}
          >
            {state.phase === 'finished'
              ? `🏆 ${winnerLabel} wins the battle!`
              : myTurn
                ? '⚔ Your turn'
                : `${turnPlayer?.username ?? '…'}'s turn`}
            {state.phase === 'playing' && (
              <div className="mt-0.5 text-[11px] font-normal opacity-80">
                {map?.name ? `${map.name} · ` : ''}Round {state.round} · Turn {state.turnNumber}/3
                {activeCardDef ? ` · ${activeCardDef.name}` : ''}
              </div>
            )}
          </div>
        )}

        {/* This round's d20 initiative (every attempt, ties marked) */}
        {state.subPhase === 'turns' && state.initiativeRolls.length > 0 && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-[11px] text-neutral-300">
            <div className="mb-1 font-semibold uppercase tracking-wider text-neutral-400">
              Round {state.round} initiative
            </div>
            {state.initiativeRolls.map((attempt, i) => {
              const isLast = i === state.initiativeRolls.length - 1;
              return (
                <div key={i} className="flex items-center gap-1.5">
                  {attempt.map(a => (
                    <span key={a.seat}>
                      <span style={{ color: seatColor(a.seat) }}>
                        {state.players.find(p => p.seat === a.seat)?.username}
                      </span>{' '}
                      <span className="font-bold tabular-nums">{a.roll}</span>
                    </span>
                  ))}
                  <span className={isLast ? 'text-amber-300' : 'text-neutral-500'}>
                    {isLast
                      ? `→ ${state.players.find(p => p.seat === state.initiative[0])?.username} first`
                      : '— tie, re-roll'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Last attack dice */}
        {state.lastAttack && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-200">
            <div className="mb-1 font-semibold uppercase tracking-wider text-neutral-400">Last attack</div>
            <div className="mb-1">{state.lastAttack.attackerLabel} → {state.lastAttack.targetLabel}</div>
            {/* Dice breakdown caption (slice 4): WHY the dice counts are what
                they are — printed + height + auras + glyphs + Spirit. The
                bonuses are already folded into the rolls below. */}
            {state.lastAttack.breakdown && state.lastAttack.breakdown.length > 0 && (
              <div className="mb-1 text-[10px] font-semibold text-amber-300">
                {state.lastAttack.breakdown.join('  ·  ')}
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="text-orange-300">⚔</span>
              {state.lastAttack.attackRoll.map((f, i) => <DieFace key={i} face={f} />)}
              <span className="ml-1 font-bold text-orange-300">{state.lastAttack.skulls}</span>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-sky-300">🛡</span>
              {state.lastAttack.defenseRoll.map((f, i) => <DieFace key={i} face={f} />)}
              <span className="ml-1 font-bold text-sky-300">{state.lastAttack.shields}</span>
            </div>
            <div className={`mt-1 font-semibold ${state.lastAttack.destroyed ? 'text-red-400' : state.lastAttack.wounds > 0 ? 'text-orange-300' : 'text-neutral-400'}`}>
              {state.lastAttack.destroyed
                ? `${state.lastAttack.targetLabel} is destroyed!`
                : state.lastAttack.wounds > 0
                  ? `${state.lastAttack.wounds} wound${state.lastAttack.wounds === 1 ? '' : 's'} inflicted.`
                  // slice 7: Stealth Dodge — one shield blocked ALL damage from a
                  // non-adjacent attacker (skulls beat shields, yet 0 wounds).
                  : state.lastAttack.skulls > state.lastAttack.shields
                    ? 'Stealth Dodge — all damage blocked!'
                    : 'Attack blocked.'}
            </div>
            {/* slice 7: Counter Strike — the Izumi reflected excess shields back
                onto the attacker as unblockable wounds. */}
            {state.lastAttack.counterWounds != null && state.lastAttack.counterWounds > 0 && (
              <div className="mt-1 font-semibold text-fuchsia-300">
                ⚔ Counter Strike — {state.lastAttack.targetLabel} reflects {state.lastAttack.counterWounds} wound{state.lastAttack.counterWounds === 1 ? '' : 's'} onto {state.lastAttack.attackerLabel}!
              </div>
            )}
          </div>
        )}

        {/* (Army cards render below the board — see the main column.) */}

        {/* figure-presentation slice: ROTATE control for a selected own figure.
            A 2-hex figure (Mimring/Grimnak) swings its TRAILING hex to the next
            free same-level direction — disabled while engaged, where it must
            MOVE to reposition; a 1-hex figure turns purely cosmetically. Shown
            during placement AND on your turn (orientInfo encodes that gate). */}
        {orientInfo && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-sky-700 bg-neutral-900/70 px-3 py-2">
            <span className="text-xs font-semibold text-sky-300">
              {orientInfo.baseSize === 2 ? '⟳ Rotate figure' : '⟳ Facing'}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => rotateFig(-1)}
                disabled={disabled || rotateBlocked || orientInfo.validDirs.length < 2}
                title={rotateBlocked ? 'Engaged — move to reposition' : 'Turn counter-clockwise'}
                className="rounded-md border-2 border-sky-600 px-3 py-1 text-base font-bold leading-none text-sky-200 transition hover:bg-sky-900/40 disabled:opacity-40"
              >
                ↺
              </button>
              <button
                onClick={() => rotateFig(1)}
                disabled={disabled || rotateBlocked || orientInfo.validDirs.length < 2}
                title={rotateBlocked ? 'Engaged — move to reposition' : 'Turn clockwise'}
                className="rounded-md border-2 border-sky-600 px-3 py-1 text-base font-bold leading-none text-sky-200 transition hover:bg-sky-900/40 disabled:opacity-40"
              >
                ↻
              </button>
            </div>
            {rotateBlocked && (
              <span className="w-full text-[10px] text-neutral-500">Engaged — move to reposition instead of turning.</span>
            )}
          </div>
        )}

        {/* slice 8: Airborne Elite THE DROP — round start, before order markers.
            Roll a d20 (server) — on 13+ deploy all reserve Airborne onto chosen
            empty spaces (not adjacent to each other or any figure, not on glyphs). */}
        {(canDoDrop || dropMode) && !disabled && (
          <div className="rounded-lg border-2 border-orange-600 bg-neutral-900/70 px-3 py-2">
            <div className="text-sm font-bold text-orange-300">💂 The Drop — {dropReserveCount} Airborne Elite in reserve</div>
            {!dropMode ? (
              <button
                onClick={() => { setDropMode(true); setDropPicks([]); }}
                title="At round start, before order markers: roll a d20. On 13+ deploy all reserve Airborne Elite onto empty spaces not adjacent to each other or any figure (and not on glyphs)."
                className="mt-1 rounded-lg border-2 border-orange-600 px-3 py-1.5 text-sm font-semibold text-orange-300 transition hover:bg-orange-900/40"
              >
                🪂 The Drop (roll d20, 13+)
              </button>
            ) : (
              <>
                <div className="mt-0.5 text-[11px] text-neutral-400">
                  Click {dropReserveCount} highlighted empty spaces — not adjacent to each other or any figure. ({dropPicks.length}/{dropReserveCount})
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    disabled={dropPicks.length !== dropReserveCount}
                    onClick={() => { onTheDrop(dropPicks); setDropMode(false); setDropPicks([]); }}
                    className="rounded-lg border-2 border-orange-500 px-3 py-1 text-sm font-bold text-orange-200 transition hover:bg-orange-900/50 disabled:opacity-40"
                  >
                    🪂 Drop! ({dropPicks.length}/{dropReserveCount})
                  </button>
                  <button
                    onClick={() => { setDropMode(false); setDropPicks([]); }}
                    className="rounded-lg border border-neutral-600 px-3 py-1 text-sm font-semibold text-neutral-300 transition hover:border-neutral-400"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {/* slice 4: special-power buttons (after moving, before attacking) */}
        {canBerserk && (
          <button
            onClick={onBerserkerCharge}
            disabled={disabled}
            title="Roll a d20 — on 15+ you may move all Tarn Viking Warriors again."
            className="rounded-lg border-2 border-orange-600 px-4 py-2 text-sm font-semibold text-orange-300 transition hover:bg-orange-900/40 disabled:opacity-40"
          >
            ⚡ Berserker Charge (roll d20)
          </button>
        )}
        {canWaterClone && (
          <button
            onClick={onWaterClone}
            disabled={disabled}
            title="Instead of attacking: roll a d20 per Marro Warrior (15+, or 10+ on water) to return slain Warriors."
            className="rounded-lg border-2 border-cyan-600 px-4 py-2 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-900/40 disabled:opacity-40"
          >
            🌊 Water Clone (instead of attacking)
          </button>
        )}
        {/* slice 7: Sgt. Drake GRAPPLE GUN toggle — shown when Drake is selected
            and has not moved. Flips his highlights to the 1-space climb-anywhere
            set; a hex click then routes to grapple_move (replacing the normal
            move). Toggle off to return to his ordinary movement. */}
        {canAct && canGrapple && (
          <button
            onClick={() => setGrappleMode(m => !m)}
            disabled={disabled}
            title="Instead of Drake's normal move, fire the Grapple Gun: move exactly ONE space that may be up to 25 levels higher (climb a cliff he couldn't otherwise)."
            className={
              'rounded-lg border-2 px-4 py-2 text-sm font-semibold transition disabled:opacity-40 ' +
              (grappleMode
                ? 'border-lime-400 bg-lime-900/40 text-lime-200'
                : 'border-lime-600 text-lime-300 hover:bg-lime-900/30')
            }
          >
            🪝 Grapple Gun {grappleMode ? '— pick a hex (1 space, climb anywhere)' : '(climb anywhere, 1 space)'}
          </button>
        )}
        {/* slice 8: Mimring FIRE LINE SPECIAL ATTACK toggle — choose a straight
            line of 8 spaces; every figure on it in LOS (friend OR foe) is hit.
            Replaces his normal attack. */}
        {canFire && (
          <button
            onClick={() => setFireLineMode(m => !m)}
            disabled={disabled}
            title="Fire Line Special Attack: a straight line of 8 spaces from Mimring. Every figure on those spaces in line of sight — friend OR foe — is hit (4 attack dice rolled once; each defends separately). Replaces his normal attack."
            className={
              'rounded-lg border-2 px-4 py-2 text-sm font-semibold transition disabled:opacity-40 ' +
              (fireLineMode
                ? 'border-orange-400 bg-orange-900/40 text-orange-200'
                : 'border-orange-600 text-orange-300 hover:bg-orange-900/30')
            }
          >
            🔥 Fire Line {fireLineMode ? '— pick a direction' : '(line of 8, friend or foe)'}
          </button>
        )}
        {/* slice 8: Ne-Gok-Sa MIND SHACKLE toggle — after moving, before
            attacking, target an adjacent enemy; a natural 20 seizes their whole
            Army Card. Does not consume his attack. */}
        {canShackle && (
          <button
            onClick={() => setShackleMode(m => !m)}
            disabled={disabled}
            title="Mind Shackle 20: choose an adjacent enemy figure and roll a d20. On a natural 20, take control of that figure's entire Army Card and every figure on it. Used after moving, before attacking — it does NOT use Ne-Gok-Sa's attack."
            className={
              'rounded-lg border-2 px-4 py-2 text-sm font-semibold transition disabled:opacity-40 ' +
              (shackleMode
                ? 'border-fuchsia-400 bg-fuchsia-900/40 text-fuchsia-200'
                : 'border-fuchsia-600 text-fuchsia-300 hover:bg-fuchsia-900/30')
            }
          >
            🧠 Mind Shackle {shackleMode ? '— pick an adjacent enemy' : '(seize a card on a natural 20)'}
          </button>
        )}
        {/* slice 8: Grimnak CHOMP toggle — before attacking, devour an adjacent
            medium/small enemy (Squad auto, Hero on a d20 16+). Not his attack. */}
        {canDoChomp && (
          <button
            onClick={() => setChompMode(m => !m)}
            disabled={disabled}
            title="Chomp: before attacking, choose an adjacent medium or small enemy figure. A Squad figure is devoured automatically; a Hero is devoured on a d20 of 16+. Large/Huge figures can't be Chomped. Doesn't use Grimnak's attack."
            className={
              'rounded-lg border-2 px-4 py-2 text-sm font-semibold transition disabled:opacity-40 ' +
              (chompMode
                ? 'border-lime-400 bg-lime-900/40 text-lime-200'
                : 'border-lime-600 text-lime-300 hover:bg-lime-900/30')
            }
          >
            🦖 Chomp {chompMode ? '— pick an adjacent enemy' : '(devour medium/small)'}
          </button>
        )}
        {/* slice 8: Airborne GRENADE SPECIAL ATTACK — once-per-game initiate. */}
        {canThrowGrenade && (
          <button
            onClick={() => onGrenade()}
            disabled={disabled}
            title="Grenade Special Attack (once per game): each Airborne Elite lobs a grenade one at a time at a figure within Range 5 (no line of sight needed). The target AND every figure adjacent to it are hit (2 attack dice rolled once; each defends separately). Replaces this turn's attack."
            className="rounded-lg border-2 border-orange-600 px-4 py-2 text-sm font-semibold text-orange-300 transition hover:bg-orange-900/40 disabled:opacity-40"
          >
            💣 Grenade (once per game)
          </button>
        )}
        {/* slice 8b: Big-Hero special-power control panel — dropdown pickers +
            a fire button per available power (the engine re-validates each). */}
        {!!anyBigHeroPower && !disabled && (
          <div className="w-full rounded-lg border-2 border-violet-700/70 bg-neutral-900/70 px-3 py-2">
            <div className="mb-1 text-sm font-bold text-violet-300">⚡ {activeCardDef?.name} — Special Power</div>
            <div className="flex flex-col gap-2 text-xs text-neutral-200">
              {/* Nilfheim — Ice Shard Breath (up to 3 shots) */}
              {iceList.length > 0 && bhHeroId && (() => {
                const tgt = bh.ice && iceList.includes(bh.ice) ? bh.ice : iceList[0];
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sky-300">❄ Ice Shard (R5 A4, ≤3×):</span>
                    <select value={tgt} onChange={e => patchBh({ ice: e.target.value })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {iceList.map(id => <option key={id} value={id}>{figName(id)}</option>)}
                    </select>
                    <button onClick={() => onIceShard(bhHeroId, tgt)} className="rounded border border-sky-600 px-2 py-0.5 font-semibold text-sky-300 hover:bg-sky-900/40">Fire</button>
                  </div>
                );
              })()}
              {/* Major Q9 — Queglix Gun (9-die pool, 1-3 per shot) */}
              {qList.length > 0 && bhHeroId && (() => {
                const tgt = bh.q && qList.includes(bh.q) ? bh.q : qList[0];
                const maxDice = Math.min(3, qLeft) as 1 | 2 | 3;
                const dice = (bh.qDice && bh.qDice <= maxDice ? bh.qDice : maxDice) as 1 | 2 | 3;
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-amber-300">🔫 Queglix ({qLeft} dice left):</span>
                    <select value={dice} onChange={e => patchBh({ qDice: Number(e.target.value) as 1 | 2 | 3 })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {[1, 2, 3].filter(n => n <= maxDice).map(n => <option key={n} value={n}>{n} {n === 1 ? 'die' : 'dice'}</option>)}
                    </select>
                    <select value={tgt} onChange={e => patchBh({ q: e.target.value })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {qList.map(id => <option key={id} value={id}>{figName(id)}</option>)}
                    </select>
                    <button onClick={() => onQueglix(bhHeroId, tgt, dice)} className="rounded border border-amber-600 px-2 py-0.5 font-semibold text-amber-300 hover:bg-amber-900/40">Fire</button>
                  </div>
                );
              })()}
              {/* Jotun — Wild Swing (splash) */}
              {wildList.length > 0 && bhHeroId && (() => {
                const tgt = bh.wild && wildList.includes(bh.wild) ? bh.wild : wildList[0];
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-red-300">🪓 Wild Swing (R1 A4, splash):</span>
                    <select value={tgt} onChange={e => patchBh({ wild: e.target.value })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {wildList.map(id => <option key={id} value={id}>{figName(id)}</option>)}
                    </select>
                    <button onClick={() => onWildSwing(bhHeroId, tgt)} className="rounded border border-red-600 px-2 py-0.5 font-semibold text-red-300 hover:bg-red-900/40">Swing</button>
                  </div>
                );
              })()}
              {/* Braxas — Poisonous Acid Breath (up to 3 small/medium) */}
              {acidList.length > 0 && bhHeroId && (() => {
                const picks = (bh.acid ?? []).filter(id => acidList.includes(id));
                const toggle = (id: string) => patchBh({ acid: picks.includes(id) ? picks.filter(x => x !== id) : picks.length < 3 ? [...picks, id] : picks });
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-lime-300">☣ Acid Breath (pick ≤3):</span>
                    {acidList.map(id => (
                      <button key={id} onClick={() => toggle(id)} className={'rounded border px-2 py-0.5 ' + (picks.includes(id) ? 'border-lime-400 bg-lime-900/50 text-lime-100' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800')}>{figName(id)}</button>
                    ))}
                    <button disabled={picks.length === 0} onClick={() => { onAcidBreath(bhHeroId, picks); patchBh({ acid: [] }); }} className="rounded border border-lime-600 px-2 py-0.5 font-semibold text-lime-300 hover:bg-lime-900/40 disabled:opacity-40">Breathe ({picks.length})</button>
                  </div>
                );
              })()}
              {/* Jotun — Throw 14 (reposition + damage) */}
              {throwList.length > 0 && bhHeroId && (() => {
                const tgt = bh.throwTgt && throwList.includes(bh.throwTgt) ? bh.throwTgt : throwList[0];
                const lands = throwLandingHexes(state, bhHeroId, tgt);
                const to = bh.throwTo && lands.includes(bh.throwTo) ? bh.throwTo : lands[0];
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-orange-300">🤾 Throw (d20 14+):</span>
                    <select value={tgt} onChange={e => patchBh({ throwTgt: e.target.value, throwTo: undefined })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {throwList.map(id => <option key={id} value={id}>{figName(id)}</option>)}
                    </select>
                    <span className="text-neutral-500">→</span>
                    <select value={to ?? ''} onChange={e => patchBh({ throwTo: e.target.value })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {lands.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <button disabled={!to} onClick={() => { onThrow(bhHeroId, tgt, to!); patchBh({ throwTgt: undefined, throwTo: undefined }); }} className="rounded border border-orange-600 px-2 py-0.5 font-semibold text-orange-300 hover:bg-orange-900/40 disabled:opacity-40">Throw</button>
                  </div>
                );
              })()}
              {/* Theracus — Carry (pick passenger, then his destination, then a landing) */}
              {carryList.length > 0 && bhHeroId && (() => {
                const pass = bh.carryPass && carryList.includes(bh.carryPass) ? bh.carryPass : carryList[0];
                const dests = [...legalDestinations(state, bhHeroId)];
                const dest = bh.carryDest && dests.includes(bh.carryDest) ? bh.carryDest : dests[0];
                const occ = new Set(state.figures.flatMap(f => [f.at, f.at2].filter(Boolean) as string[]));
                const lands = dest ? neighborKeys(dest).filter(k => MAPS[state.mapId].cells[k] && !occ.has(k) && k !== dest) : [];
                const land = bh.carryLand && lands.includes(bh.carryLand) ? bh.carryLand : lands[0];
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-emerald-300">🪽 Carry:</span>
                    <select value={pass} onChange={e => patchBh({ carryPass: e.target.value })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {carryList.map(id => <option key={id} value={id}>{figName(id)}</option>)}
                    </select>
                    <span className="text-neutral-500">fly→</span>
                    <select value={dest ?? ''} onChange={e => patchBh({ carryDest: e.target.value, carryLand: undefined })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {dests.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <span className="text-neutral-500">drop→</span>
                    <select value={land ?? ''} onChange={e => patchBh({ carryLand: e.target.value })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {lands.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <button disabled={!dest || !land} onClick={() => { onCarry(bhHeroId, dest!, pass, land!); patchBh({ carryDest: undefined, carryLand: undefined }); }} className="rounded border border-emerald-600 px-2 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40">Carry</button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        {/* slice 8: Grenade throw sequence — pick a Range-5 figure per Elite. */}
        {grenadeChoice && (
          <div className="rounded-lg border-2 border-orange-500 bg-neutral-900/70 px-3 py-2">
            <div className="text-sm font-bold text-orange-300">💣 Grenade — {grenadeChoice.throwers.length} Elite{grenadeChoice.throwers.length === 1 ? '' : 's'} left to throw</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Click a highlighted figure within Range 5 — its neighbours are splashed too.
            </div>
          </div>
        )}
        {/* slice 6: Double Attack hint — Syvarris may take one more attack. No
            modal: his targets stay highlighted (legalTargets still allows him);
            the player either clicks a marked enemy again or ends the turn. */}
        {canDoubleAttack && (
          <div className="rounded-lg border-2 border-emerald-600 bg-neutral-900/70 px-3 py-2 text-center">
            <div className="text-sm font-bold text-emerald-300">🏹 Double Attack</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Syvarris may attack again or end his turn.
            </div>
          </div>
        )}

        {/* slice 4: Berserker Charge re-move choice (the optional "may") */}
        {myChoice?.kind === 'berserker_charge' && (
          <div className="rounded-lg border-2 border-orange-600 bg-neutral-900/70 px-3 py-2">
            <div className="text-sm font-bold text-orange-300">⚡ Berserker Charge!</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              You rolled 15+. Move all Tarn Viking Warriors again, or decline.
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onResolveChoice({ kind: 'berserker_charge', remove: true })}
                disabled={disabled}
                className="flex-1 rounded-md border-2 border-emerald-600 px-2 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:opacity-40"
              >
                Move again
              </button>
              <button
                onClick={() => onResolveChoice({ kind: 'berserker_charge', remove: false })}
                disabled={disabled}
                className="flex-1 rounded-md border-2 border-neutral-600 px-2 py-1 text-xs font-semibold text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-40"
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {/* slice 4: Water Clone placement — click a highlighted hex on the board */}
        {myChoice?.kind === 'water_clone_place' && (
          <div className="rounded-lg border-2 border-cyan-600 bg-neutral-900/70 px-3 py-2">
            <div className="text-sm font-bold text-cyan-300">🌊 Water Clone — place a Warrior</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Returning {myChoice.chosen.length + 1} of {myChoice.placements.length}. Click a
              highlighted same-level space adjacent to the Warrior that rolled.
            </div>
          </div>
        )}

        {/* slice 4: Spirit placement — pick any living unique card */}
        {myChoice?.kind === 'spirit_placement' && (
          <div className="rounded-lg border-2 border-amber-500 bg-neutral-900/80 px-3 py-2">
            <div className="text-sm font-bold text-amber-300">
              {myChoice.spirit === 'attack' ? "Warrior's Attack Spirit" : "Warrior's Armor Spirit"}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Place the Spirit on any unique Army Card — +1 {myChoice.spirit} forever.
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {myChoice.options.map(uid => {
                const c = state.cards.find(x => x.uid === uid);
                const def = HS_CARDS[c?.cardId ?? ''];
                const ownerName = state.players.find(p => p.seat === c?.ownerSeat)?.username ?? '';
                return (
                  <button
                    key={uid}
                    onClick={() => onResolveChoice({ kind: 'spirit_placement', cardUid: uid })}
                    disabled={disabled}
                    className="flex items-center justify-between rounded-md border border-amber-700 px-2 py-1 text-left text-xs text-amber-100 transition hover:border-amber-400 hover:bg-amber-900/30 disabled:opacity-40"
                  >
                    <span className="font-semibold">{def?.name ?? uid}</span>
                    <span className="text-[10px] text-neutral-400">{ownerName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* End turn */}
        {myTurn && !pending && (
          <button
            onClick={() => { onEndTurn(); setSelectedId(null); }}
            disabled={disabled}
            className="rounded-lg border-2 border-amber-600 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-900/40 disabled:opacity-40"
          >
            End turn ▶
          </button>
        )}

      </div>

      {/* CENTER — opponent army cards (top), board, my army cards (bottom). The
          board is already oriented so my start zone is at the bottom, so my cards
          below + the enemy's above put each player's cards on their figures' side.
          On lg+ this is a flex COLUMN whose middle (the board) flexes to fill all
          the space the two compact card strips leave — and the board does NOT
          scroll (the strips are shrink-0; only the board box flexes). */}
      <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 lg:order-2 lg:min-h-0">
        {/* Opponent army rosters — above the board. Each is collapsible so 4-6
            players fit; the active player's row auto-expands. */}
        {state.players.some(p => !me || p.seat !== me.seat) && (
          <div className="flex shrink-0 flex-col gap-1">
            {state.players
              .filter(p => !me || p.seat !== me.seat)
              .sort((a, b) => a.seat - b.seat)
              .map(p => (
                <div key={p.seat}>{renderArmyRow(p.seat, true)}</div>
              ))}
          </div>
        )}

        {/* The BOARD — the BIGGEST element. On lg+ it flexes to fill the column
            and is centered; it has NO scrollbar (overflow-hidden). The SVG scales
            up to fill the box via preserveAspectRatio (no fixed max-width cap).
            Mobile: a min-height gives the h-full SVG a box to fill (the column has
            no fixed height there) so the board never collapses; lg overrides it. */}
        <div className="relative flex min-h-[60vh] w-full items-center justify-center overflow-hidden lg:min-h-0 lg:flex-1">
        {/* board zoom controls — scroll to zoom on the cursor, drag to pan */}
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
          {/* Zoom controls apply only to the 2D SVG fallback; the 3D board zooms
              with the scroll wheel via OrbitControls. */}
          {!can3D && (
            <>
              <button type="button" title="Zoom in (or scroll on the board)" onClick={() => zoomAtCenter(1.4)} className="h-7 w-7 rounded-md border border-neutral-600 bg-neutral-900/80 text-base font-bold leading-none text-neutral-200 transition hover:bg-neutral-800">+</button>
              <button type="button" title="Zoom out" onClick={() => zoomAtCenter(1 / 1.4)} className="h-7 w-7 rounded-md border border-neutral-600 bg-neutral-900/80 text-base font-bold leading-none text-neutral-200 transition hover:bg-neutral-800">−</button>
              <button type="button" title="Reset view" onClick={() => setView(null)} className="h-7 w-7 rounded-md border border-neutral-600 bg-neutral-900/80 text-xs leading-none text-neutral-200 transition hover:bg-neutral-800">⟲</button>
            </>
          )}
        </div>
        {can3D ? (
          <HeroBoard3D
            state={state}
            onHexClick={clickHex}
            selectedId={selectedId}
            moveHexes={destinations}
            targetIds={targets}
            powerTargetIds={new Set([...shackleTargets, ...chompTargetSet, ...grenadeTargetSet])}
            viewerStartHexes={me ? startZones[me.seat] : undefined}
            placeHexes={placeHexes}
            dropHexes={dropLegalSet}
            dropPicks={new Set(dropPicks)}
          />
        ) : (
        <svg
          ref={setSvgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-full max-h-full w-full"
          style={{ cursor: panning ? 'grabbing' : view ? 'grab' : 'default', touchAction: 'none' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            dragRef.current = { sx: e.clientX, sy: e.clientY, vx: vb.x, vy: vb.y, scale: view ? view.scale : 1, id: e.pointerId, moved: false };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current; if (!d) return;
            const m = contentMetrics(); if (!m) return;
            const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
            if (!d.moved) { if (Math.hypot(dx, dy) < 4) return; d.moved = true; setPanning(true); e.currentTarget.setPointerCapture(d.id); }
            setView(clampView(d.scale, d.vx - dx * (W / d.scale / m.cw), d.vy - dy * (H / d.scale / m.ch)));
          }}
          onPointerUp={(e) => {
            const d = dragRef.current; dragRef.current = null;
            if (d?.moved) { draggedRef.current = true; setPanning(false); try { e.currentTarget.releasePointerCapture(d.id); } catch { /* not captured */ } }
          }}
        >
          {/* 2.5D ISO board — drawn STRICTLY back-to-front (painter's
              algorithm): for each cell in depth order we paint its PRISM, then
              its glyph, then the standee that stands on it, so a nearer/taller
              tile (and its figure) correctly overlaps the ones behind it. All
              hit-testing stays keyed by hex: the iso TOP hexagon is the click
              polygon, the standee re-anchors every overlay to the same center. */}
          {drawCells.map(c => {
            const key: HexKey = `${c.q},${c.r}`;
            const top = topHexPts(key); // iso top hexagon (screen pts)
            const ctr = toScreen(key); // iso top-face center
            const sides = sideFaces(key); // column quads (empty for water/h0)
            const isPlaceHex = placeHexes.has(key); // slice 5 placement target
            const isDest = destinations.has(key) || isPlaceHex;
            const isFireHex = fireLineMode && fireLineDirs.has(key); // slice 8 fire-line target space
            const isCloneOpt = cloneOptions.has(key);
            const isDropPick = dropMode && dropPicks.includes(key); // slice 8 chosen Drop landing
            const isDropLegal = dropMode && !isDropPick && dropLegalSet.has(key); // legal Drop landing
            const drawColumn = c.terrain !== 'water' && c.height > 0; // water = flat top
            const colors = isoTileColors(c.terrain, c.height, isDest);
            const topFill = isDropPick ? '#7c2d12' : isCloneOpt ? '#0e4f6e' : colors.top;
            const topStroke = isDropPick ? '#fb923c' : isDropLegal ? '#fdba74' : isFireHex ? '#fb923c' : isCloneOpt ? '#22d3ee' : isDest ? '#34d399' : colors.stroke;
            const startZoneSeat = Object.entries(startZones).find(([, keys]) => keys.includes(key))?.[0];
            const fig = figureAt(key); // ANCHOR figure (drawn once, here)
            const occupied = !!occupantAt(key); // either hex of a 2-hex figure
            const clickable = canAct || isCloneOpt || (dropMode && (isDropLegal || isDropPick)) || (canPlace && (isPlaceHex || occupied));

            // --- glyph on this hex (drawn between tile top and standee) ---
            const glyph = (state.glyphs ?? []).find(g => g.at === key);

            // --- figure standee on this hex ---
            const fdef = fig ? HS_CARDS[state.cards.find(cd => cd.uid === fig.cardUid)?.cardId ?? ''] : null;
            const fCardId = fig ? state.cards.find(cd => cd.uid === fig.cardUid)?.cardId ?? '' : '';
            const isSel = fig?.id === selectedId;
            const isTarget = fig ? targets.has(fig.id) : false;
            const isShackleTarget = fig ? shackleTargets.has(fig.id) : false; // slice 8
            const isGrenadeTarget = fig ? grenadeTargetSet.has(fig.id) : false; // slice 8
            const isChompTarget = fig ? chompTargetSet.has(fig.id) : false; // slice 8
            const mine = fig ? me && fig.ownerSeat === me.seat : false;
            const placeClickable = canPlace && !!mine;
            const act = fig ? activation.get(fig.id) : undefined; // move|attack|done
            const dimmed = act === 'done';
            const ring = act === 'move' ? '#22c55e' : act === 'attack' ? '#f59e0b' : null;
            const figClickable = fig ? (canAct && (mine || isTarget || isShackleTarget || isGrenadeTarget || isChompTarget)) || placeClickable : false;
            const fLabel = `${fdef?.letter ?? ''}${fdef?.type === 'squad' ? fig?.index : ''}`;
            // Double-space figures (Mimring, Grimnak) span TWO hexes: one standee
            // centred on the midpoint of both top-faces, with a wider base.
            const is2 = !!(fdef && fdef.baseSize === 2 && fig?.at2);
            const ctr2 = is2 ? toScreen(fig!.at2!) : null;
            const aCx = ctr2 ? (ctr.x + ctr2.x) / 2 : ctr.x;
            const aCy = ctr2 ? (ctr.y + ctr2.y) / 2 : ctr.y;
            const baseSpan = ctr2 ? Math.hypot(ctr2.x - ctr.x, ctr2.y - ctr.y) / 2 : 0;
            // Cosmetic FACING for a 1-hex figure: project the hex it faces and
            // hand the standee a normalised screen vector for the base notch. A
            // 2-hex figure shows facing via its elongated base, so it gets none.
            const faceVec = (() => {
              if (!fig || fig.at == null || is2 || !isSel) return null;
              const fn = neighborKeys(fig.at)[fig.facing ?? 0];
              if (!fn) return null;
              const fs = toScreen(fn);
              const dx = fs.x - ctr.x, dy = fs.y - ctr.y;
              const len = Math.hypot(dx, dy) || 1;
              return { dx: dx / len, dy: dy / len };
            })();

            return (
              <g key={key}>
                {/* PRISM column side faces (back-to-front within a tile is
                    implicit — they share the same footprint depth). */}
                {drawColumn && sides.map((face, i) => (
                  <polygon
                    key={`s${i}`}
                    points={ptsStr(face.pts)}
                    fill={shadeHex(colors.side, face.shade)}
                    stroke="#0a0a0a" strokeWidth={0.5}
                    onClick={() => clickHex(key)}
                    className={clickable ? 'cursor-pointer' : ''}
                  />
                ))}
                {/* TOP face — the clickable hexagon (same onClick={clickHex}).
                    data-hex carries the cell key for click handling / tests. */}
                <polygon
                  data-hex={key}
                  points={ptsStr(top)}
                  fill={topFill}
                  stroke={topStroke}
                  strokeWidth={isDropPick || isDropLegal || isCloneOpt || isDest || isFireHex ? 2 : 1}
                  onClick={() => clickHex(key)}
                  className={clickable ? 'cursor-pointer' : ''}
                />
                {/* start-zone tint dot on the top face (unoccupied) */}
                {(state.phase === 'playing' || placement) && startZoneSeat != null && !occupied && (
                  <circle cx={ctr.x} cy={ctr.y} r={3} fill={seatColor(Number(startZoneSeat))} opacity={placement && Number(startZoneSeat) === me?.seat ? 0.45 : 0.25} style={{ pointerEvents: 'none' }} />
                )}
                {/* height badge on the top face (smaller now elevation is visual;
                    kept per spec). Skip flat grass & occupied tiles. */}
                {!occupied && (c.height > 1 || c.terrain === 'water') && (
                  <text
                    x={ctr.x + HEX * 0.42} y={ctr.y - HEX * 0.16}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={HEX * 0.24} fontWeight={700}
                    fill={c.terrain === 'water' ? '#7dd3fc' : '#e7e5e4'} opacity={0.75}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {c.terrain === 'water' ? '≈' : c.height}
                  </text>
                )}

                {/* GLYPH badge on the top face — dim when empty, LIT when a
                    figure stands on it; tucked to the corner when occupied so the
                    standee stays legible. */}
                {glyph && (() => {
                  const def = HS_GLYPHS[glyph.id];
                  const badge = GLYPH_BADGE[def.letter] ?? GLYPH_BADGE.B;
                  const lit = occupied;
                  const gx = occupied ? ctr.x - HEX * 0.42 : ctr.x;
                  const gy = occupied ? ctr.y + HEX * 0.16 : ctr.y;
                  const gr = occupied ? HEX * 0.22 : HEX * 0.3;
                  return (
                    <g onClick={() => clickHex(key)} style={{ pointerEvents: occupied ? 'none' : undefined }} className={canAct && !occupied ? 'cursor-pointer' : ''}>
                      <title>{`${def.name}${lit ? ' (active)' : ''} — ${def.effect}`}</title>
                      <circle cx={gx} cy={gy} r={gr} fill={badge.bg} stroke={lit ? badge.ring : '#0a0a0a'} strokeWidth={lit ? 2.5 : 1.5} opacity={lit ? 1 : 0.6} />
                      <text x={gx} y={gy + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={gr * 1.1} fontWeight={900} fill="#fafafa" opacity={lit ? 1 : 0.85} style={{ userSelect: 'none', pointerEvents: 'none' }}>
                        {def.letter}
                      </text>
                    </g>
                  );
                })()}

                {/* FIGURE STANDEE — stands on this tile's top face. All overlays
                    (target ring, activation ring, selection, wound pip, squad
                    index) re-anchored to the iso top-face center. */}
                {fig && (
                  <g
                    onClick={() => clickHex(fig.at!)}
                    className={figClickable ? 'cursor-pointer' : ''}
                    opacity={dimmed ? 0.55 : 1}
                  >
                    {/* target ring (red dashed) — on the base footprint */}
                    {isTarget && (
                      <ellipse cx={aCx} cy={aCy} rx={HEX * 0.56 + baseSpan} ry={HEX * 0.32} fill="none" stroke="#ef4444" strokeWidth={3} strokeDasharray="6 3" style={{ pointerEvents: 'none' }} />
                    )}
                    {/* slice 8: Mind-Shackle target ring (fuchsia dashed) */}
                    {isShackleTarget && (
                      <ellipse cx={aCx} cy={aCy} rx={HEX * 0.56 + baseSpan} ry={HEX * 0.32} fill="none" stroke="#d946ef" strokeWidth={3.5} strokeDasharray="5 3" style={{ pointerEvents: 'none' }} />
                    )}
                    {/* slice 8: Grenade target ring (orange dashed) */}
                    {isGrenadeTarget && (
                      <ellipse cx={aCx} cy={aCy} rx={HEX * 0.56 + baseSpan} ry={HEX * 0.32} fill="none" stroke="#fb923c" strokeWidth={3.5} strokeDasharray="4 3" style={{ pointerEvents: 'none' }} />
                    )}
                    {/* slice 8: Chomp target ring (lime dashed) */}
                    {isChompTarget && (
                      <ellipse cx={aCx} cy={aCy} rx={HEX * 0.56 + baseSpan} ry={HEX * 0.32} fill="none" stroke="#84cc16" strokeWidth={3.5} strokeDasharray="3 2" style={{ pointerEvents: 'none' }} />
                    )}
                    {/* activation ring: green=can move, amber=can attack */}
                    {ring && (
                      <ellipse cx={aCx} cy={aCy} rx={HEX * 0.52 + baseSpan} ry={HEX * 0.3} fill="none" stroke={ring} strokeWidth={3.5} opacity={0.95} style={{ pointerEvents: 'none' }} />
                    )}
                    {/* selection ring (amber) on the base */}
                    {isSel && (
                      <ellipse cx={aCx} cy={aCy} rx={HEX * 0.5 + baseSpan} ry={HEX * 0.28} fill="none" stroke="#fde68a" strokeWidth={3.5} style={{ pointerEvents: 'none' }} />
                    )}
                    <FigureStandee
                      cardId={fCardId}
                      cx={ctr.x} cy={ctr.y} hex={HEX}
                      cx2={ctr2?.x} cy2={ctr2?.y}
                      accent={seatColor(fig.ownerSeat)}
                      fallbackLabel={fLabel}
                      billboard={!!fCardId}
                      squadIndex={fdef?.type === 'squad' ? fig.index : undefined}
                      facingVec={faceVec}
                    />
                    {/* squad index chip (bottom-right of the base) so squad
                        members stay distinguishable on the standee. */}
                    {fdef?.type === 'squad' && (
                      <g style={{ pointerEvents: 'none' }}>
                        <circle cx={ctr.x + HEX * 0.34} cy={ctr.y + HEX * 0.04} r={7} fill="#0a0a0a" opacity={0.85} stroke={seatColor(fig.ownerSeat)} strokeWidth={1.5} />
                        <text x={ctr.x + HEX * 0.34} y={ctr.y + HEX * 0.04 + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={800} fill="#fafafa" style={{ userSelect: 'none' }}>
                          {fig.index}
                        </text>
                      </g>
                    )}
                    {/* wound pip — above the standee's head (higher for a 2-hex
                        figure's taller billboard), anchored to the midpoint */}
                    {fig.wounds > 0 && (
                      <g style={{ pointerEvents: 'none' }}>
                        <circle cx={aCx + HEX * 0.34} cy={aCy - HEX * (is2 ? 1.7 : 1.45) * standeeScale(fdef?.height)} r={7} fill="#dc2626" stroke="#0a0a0a" strokeWidth={1.5} />
                        <text x={aCx + HEX * 0.34} y={aCy - HEX * (is2 ? 1.7 : 1.45) * standeeScale(fdef?.height) + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={800} fill="#fee2e2" style={{ userSelect: 'none' }}>
                          {fig.wounds}
                        </text>
                      </g>
                    )}
                  </g>
                )}
              </g>
            );
          })}
          {/* iso polish: figures snap to position (no move/attack tween) and the
              camera is a fixed iso angle (no orbit/zoom) — both intentionally out
              of scope for this slice; this is where those would hook in. */}
        </svg>
        )}
        </div>

        {/* slice 5: placement in-hand tray — your unplaced figures. Click one to
            pick it up, then click a highlighted start-zone hex to deploy it.
            shrink-0 so the board (flex-1) keeps its space on lg+. */}
        {placement && me && !iPlacementReady && (
          <div className="shrink-0 rounded-lg border border-amber-800 bg-neutral-900/50 px-2 py-1.5">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              In hand — click a figure, then a glowing hex
            </div>
            {myHand.length === 0 ? (
              <div className="text-[11px] text-neutral-500">All figures deployed. Hit Ready when satisfied.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {myHand.map(id => {
                  const f = state.figures.find(x => x.id === id);
                  const def = HS_CARDS[state.cards.find(c => c.uid === f?.cardUid)?.cardId ?? ''];
                  const picked = (placeFigureId ?? myHand[0]) === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setPlaceFigureId(id)}
                      disabled={disabled}
                      title={f ? figureLabel(state, f) : id}
                      className={
                        'flex items-center gap-1 rounded-md border-2 px-2 py-1 text-xs font-semibold transition ' +
                        (picked ? 'border-amber-400 bg-amber-900/30 text-amber-200' : 'border-neutral-700 text-neutral-200 hover:border-neutral-500')
                      }
                    >
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold text-neutral-950"
                        style={{ background: seatColor(me.seat) }}
                      >
                        {def?.letter}{def?.type === 'squad' ? f?.index : ''}
                      </span>
                      <span>{f ? figureLabel(state, f) : id}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {myTurn && (
          <div className="shrink-0 text-center text-[11px] text-neutral-500">
            {selected
              ? (() => {
                  // slice 7: a small flyer / ghost-walk hint on the selected figure.
                  const def = HS_CARDS[state.cards.find(c => c.uid === selected.cardUid)?.cardId ?? ''];
                  const tag = def?.flying ? '✈ Flying — ' : def?.ghostWalk ? '👻 Ghost Walk — ' : '';
                  return grappleMode
                    ? `🪝 Grapple Gun armed — click an adjacent hex (up to 25 levels higher) to grapple there.`
                    : `${tag}${figureLabel(state, selected)} — click a highlighted hex to move, a marked enemy to attack, or another of your figures.`;
                })()
              : `Order marker ${state.turnNumber} is revealed — only ${activeCardDef?.name ?? 'that card'}'s figures act this turn.`}
          </div>
        )}
        {placing && me && !iAmReady && (
          <div className="shrink-0 text-center text-[11px] text-neutral-500">
            Pick a chip on your army strip, then click a card to schedule that turn.
          </div>
        )}

        {/* My army cards — below the board (my figures' side, where the
            per-viewer flip puts my start zone). Markers above each card; during
            placement my strip is interactive. Compact + shrink-0 so the board
            stays the biggest element. */}
        {me && <div className="shrink-0">{renderArmyRow(me.seat)}</div>}
      </div>

      {/* LEFT RAIL — COLLAPSIBLE event log. Collapsed by default to a thin toggle
          so the map and cards own the space; the log can never shrink them. When
          open it's a fixed-width rail whose box scrolls INTERNALLY. */}
      <div className={'flex w-full shrink-0 flex-col gap-1 lg:order-1 lg:min-h-0 lg:self-stretch lg:overflow-hidden ' + (logOpen ? 'lg:w-[210px]' : 'lg:w-auto')}>
        <button
          onClick={() => setLogOpen(o => !o)}
          title={logOpen ? 'Hide the battle log' : 'Show the battle log'}
          className="flex shrink-0 items-center gap-1 self-start rounded border border-neutral-700 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 transition hover:border-neutral-500"
        >
          📜 {logOpen ? 'Battle log ✕' : 'Log'}
        </button>
        {logOpen && (
          <div className="overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[11px] leading-relaxed text-neutral-400 max-h-60 lg:max-h-none lg:min-h-0 lg:flex-1">
            {state.log.slice(-40).reverse().map(e => (
              <div
                key={e.seq}
                className={
                  e.tag === 'win'
                    ? 'font-bold text-amber-300'
                    : e.tag === 'attack'
                      ? 'text-red-300/80'
                      : e.tag === 'fall'
                        ? 'text-orange-300/90'
                        : ''
                }
              >
                {e.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
