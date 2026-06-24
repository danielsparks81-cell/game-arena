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
import { sounds } from '@/lib/sounds';
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
  type HSEdition,
  MAPS,
  HS_CARDS,
  effectiveCardDef,
  aiPendingSeat,
  livingSeats,
  initiativeReadySeats,
  HS_DRAFT_POOL,
  HS_GLYPHS,
  POWER_DESCRIPTIONS,
  CARD_IDENTITY,
  MIN_POINT_BUDGET,
  MAX_POINT_BUDGET,
  legalDestinations,
  movementRangeHexes,
  shootingRangeHexes,
  shootBlockedHexes,
  disengageMoveHexes,
  grappleDestinations,
  canFireLine,
  fireLineSpaces,
  fireLineTargets,
  canExplosion,
  explosionTargets,
  canMindShackle,
  mindShackleTargets,
  canChomp,
  chompTargets,
  canGrenade,
  grenadeTargets,
  grenadeDefenders,
  // Airborne Elite THE DROP (slice 8).
  canTheDrop,
  theDropHexes,
  // Big Heroes special powers (slice 8b).
  iceShardTargets,
  queglixTargets,
  queglixDiceLeft,
  wildSwingTargets,
  wildSwingDefenders,
  acidBreathTargets,
  throwTargets,
  throwLandingHexes,
  carryPassengers,
  carryLandingHexes,
  carryDestFootprint,
  erlandDestinations,
  erlandSummonableIds,
  sturlaPlacementHexes,
  legalTargets,
  auraBuffedFigureIds,
  placeableHexes,
  placeable2Leads,
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
const TEAM_COLORS = ['#f87171', '#60a5fa', '#4ade80', '#fbbf24', '#c084fc', '#22d3ee']; // Team A–F (one per seat, so any pairing is possible)
const teamColorById = (team: number) => TEAM_COLORS[(team - 1) % TEAM_COLORS.length] ?? '#a3a3a3';
/** Beat between an AI's actions (ms). Combat is paced slow enough to read the dice;
 *  the repetitive no-dice phases (walking a path one hex at a time, deploying, drafting,
 *  placing markers) tick FAST so the bot doesn't crawl across the board. */
// AI pacing — deliberately unhurried so a watching player can follow what the bot does (esp.
// back-to-back actions like an Airborne squad throwing several grenades). NORMAL = the gap between
// "weighty" actions (attacks/specials), FAST = repetitive no-dice work (walking a path, deploying).
const AI_STEP_MS = 1150;
const AI_STEP_FAST_MS = 360;
// Player-panel SCREEN anchors (lg+ overlay). You are always slot 0 = bottom-left; the rest fan
// out by SEAT order (stable round-to-round, so seat adjacency = turn-order adjacency). The 4
// corners for ≤4 players; 6 spots (corners + top/bottom centre) for 5-6.
const PANEL_ANCHORS_4 = ['bottom-2 left-2', 'top-2 left-2', 'top-2 right-2', 'bottom-2 right-2'];
const PANEL_ANCHORS_6 = [
  'bottom-2 left-2', 'top-2 left-2', 'top-2 left-1/2 -translate-x-1/2',
  'top-2 right-2', 'bottom-2 right-2', 'bottom-2 left-1/2 -translate-x-1/2',
];
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
  onSetLobbyConfig: (cfg: { mapId?: string; pointBudget?: number; mode?: HSMode; edition?: HSEdition; teams?: Record<number, number>; teamBudgets?: Record<number, number> }) => void;
  onAddBot?: (team?: number) => void;
  onRemoveBot?: (seat: number) => void;
  onAiStep?: () => void;
  onPlaceMarkers: (assignments: Assignment[]) => void;
  onMoveFigure: (figureId: string, to: HexKey) => void;
  /** Walk a figure ONE adjacent hex (tap-to-step movement). */
  onMoveStep: (figureId: string, to: HexKey) => void;
  onGrappleMove: (figureId: string, to: HexKey) => void;
  onFireLine: (attackerId: string, dir: number) => void;
  onExplosion: (attackerId: string, targetId: string) => void;
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
  onTheDrop: () => void;
  onResolveChoice: (choice: HSChoiceResolution) => void;
  onUndoMove: () => void;
  onEndMove: () => void;
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
 *  indistinguishable from 1/2/3 (slice-2 spec §Projection). A face-down chip is a
 *  clearly VISIBLE hollow amber ring (no number) so players can see which cards
 *  still hold a pending marker — i.e. who might act next — without revealing its value. */
function MarkerChip({ m, size = 16 }: { m: OrderMarker; size?: number }) {
  const faceDown = m.marker === 'hidden';
  return (
    <span
      className={
        'inline-flex shrink-0 items-center justify-center rounded-full border font-bold ' +
        (faceDown
          ? 'border-amber-600/80 bg-neutral-800 text-transparent'
          : m.revealed
            ? 'border-amber-400 bg-amber-500/90 text-neutral-950'
            : 'border-amber-700/70 bg-neutral-900 text-amber-300/90')
      }
      style={{ width: size, height: size, fontSize: size * 0.62 }}
      title={
        faceDown
          ? "An order marker placed face-down — its number (1, 2, 3 or the X decoy) is hidden until it's revealed on that turn"
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
  cardId, edition, taken, takenByLabel, affordable, clickable, onPick,
}: {
  cardId: string;
  edition: HSEdition;
  taken: boolean;
  takenByLabel?: string;
  affordable: boolean;
  clickable: boolean;
  onPick: () => void;
}) {
  // Points come from the active edition so the badge matches the draft budget;
  // the scanned art (HybridCard) is the modern printing regardless.
  const def = effectiveCardDef(cardId, edition) ?? HS_CARDS[cardId];
  const wip = def.power === 'wip';
  const dim = taken || !affordable;
  // Click SELECTS the card and shows a Confirm/Cancel overlay rather than drafting
  // instantly — a guard against a misclicked, irreversible pick in a snake draft.
  const [confirming, setConfirming] = useState(false);
  // Show the hover preview on the screen edge OPPOSITE this card so it never
  // covers the card (measured on enter from the card's horizontal centre).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [previewSide, setPreviewSide] = useState<'left' | 'right'>('right');
  return (
    <div
      ref={wrapRef}
      className="group relative w-full"
      onMouseEnter={() => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (r) setPreviewSide(r.left + r.width / 2 < window.innerWidth / 2 ? 'right' : 'left');
      }}
    >
      <button
        onClick={() => { if (clickable) setConfirming(true); }}
        disabled={!clickable}
        title={
          taken
            ? `Drafted by ${takenByLabel ?? 'a player'}`
            : !affordable
              ? 'Over your remaining budget'
              : clickable
                ? `Draft ${def.name} (${def.points} pts)`
                : `${def.name} — ${def.points} pts`
        }
        className={
          'relative block h-full w-full overflow-hidden rounded-lg text-left transition ' +
          (taken
            ? 'opacity-50'
            : clickable
              ? 'ring-2 ring-amber-600 hover:ring-amber-300'
              : (dim ? 'opacity-50' : ''))
        }
      >
        {/* The card itself — scanned header (art + stats) + reconstructed, always
            legible powers. Same component the hover enlarges. */}
        <HybridCard cardId={cardId} />

        {/* Points badge — quick budget scan, over the parchment corner. */}
        <span className="absolute bottom-1.5 right-1.5 rounded-md bg-neutral-950/90 px-1.5 py-0.5 text-sm font-extrabold tabular-nums text-amber-300 shadow-md">
          {def.points}
        </span>

        {wip && !taken && (
          <span
            className="absolute left-1.5 top-1.5 rounded bg-neutral-950/80 px-1 py-0.5 text-[9px] font-semibold text-purple-300"
            title="Special power not yet implemented — fights with printed stats"
          >
            ⚡ WIP
          </span>
        )}

        {/* Common cards can be drafted repeatedly (they never leave the pool). */}
        {def.common && (
          <span
            className="absolute right-1.5 top-1.5 rounded bg-emerald-950/85 px-1 py-0.5 text-[9px] font-bold text-emerald-300"
            title="Common card — draftable unlimited times (field multiple copies)"
          >
            Common ∞
          </span>
        )}

        {taken && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/60 px-1 text-center">
            <span className="rounded bg-neutral-950/85 px-2 py-1 text-[11px] font-semibold text-neutral-100">
              ✓ taken{takenByLabel ? ` by ${takenByLabel}` : ''}
            </span>
          </div>
        )}
      </button>

      {/* Confirm step — covers the card after you click it so a pick is always
          deliberate. Shown only while it's still your clickable turn. */}
      {confirming && clickable && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-1.5 rounded-lg bg-neutral-950/92 p-2 text-center">
          <div className="text-[13px] font-bold leading-tight text-amber-100">Draft {def.name}?</div>
          <div className="text-xs font-semibold text-amber-300">{def.points} pts</div>
          <div className="mt-1 flex gap-2">
            <button onClick={() => { onPick(); setConfirming(false); }} className="rounded-md border-2 border-emerald-500 bg-emerald-900/50 px-3 py-1.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-700/60">✓ Draft</button>
            <button onClick={() => setConfirming(false)} className="rounded-md border-2 border-neutral-600 px-3 py-1.5 text-xs font-bold text-neutral-300 transition hover:border-neutral-400">✕ Cancel</button>
          </div>
        </div>
      )}

      {/* Hover → the same card, enlarged and pinned to the opposite edge. */}
      <CardHoverPanel cardId={cardId} big side={previewSide} />
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

/** The "hybrid" card: the scanned card cropped to its HEADER (title + art + stat
 *  block) on top, with the special powers RECONSTRUCTED from POWER_DESCRIPTIONS as
 *  crisp HTML below. Two wins: (1) the powers are legible at ANY size — the scan's
 *  printed power text turns to mush when small — and (2) with `onPowerTap` each
 *  power becomes a tappable button, so the play-view activation panel can let a
 *  player fire a power straight off the card. */
/** Army colours per General — drive the stat band + the title accent. */
const GENERAL_THEME: Record<string, { band: string; accent: string; chip: string }> = {
  Jandar: { band: 'bg-blue-800', accent: 'border-blue-400', chip: 'bg-blue-600' },
  Utgar: { band: 'bg-red-900', accent: 'border-red-400', chip: 'bg-red-700' },
  Ullar: { band: 'bg-green-800', accent: 'border-green-400', chip: 'bg-green-600' },
  Vydar: { band: 'bg-slate-700', accent: 'border-slate-300', chip: 'bg-slate-500' },
  Einar: { band: 'bg-amber-800', accent: 'border-amber-400', chip: 'bg-amber-600' },
};

/** One reconstructed stat pill — colour-coded, crisp HTML. (No Points pill: that
 *  number lives in the card's corner badge, per the printed-card layout.) */
function HeaderPill({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <div className={'flex items-center justify-between gap-1 rounded px-1.5 py-[3px] ' + tone}>
      <span className="text-[8px] font-bold uppercase tracking-wide text-white/85">{label}</span>
      <span className="text-sm font-extrabold leading-none tabular-nums text-white">{value}</span>
    </div>
  );
}

/** The card HEADER, fully reconstructed as crisp HTML (replaces the scanned top):
 *  title bar (name + General) + the army-coloured stat band — figure art, the six
 *  identity rows, and five colour-coded stat pills. Legible at any size; Points
 *  intentionally omitted (shown on the draft tile's corner badge). */
function HtmlCardHeader({ cardId }: { cardId: string }) {
  const def = HS_CARDS[cardId];
  const ident = CARD_IDENTITY[cardId];
  if (!def) return null;
  const theme = GENERAL_THEME[ident?.general ?? ''] ?? GENERAL_THEME.Jandar;
  const rows = [
    def.species,
    def.type === 'hero' ? 'Unique Hero' : 'Unique Squad',
    def.unitClass,
    ident?.personality,
    ident?.world,
  ].filter(Boolean) as string[];
  return (
    <div className="shrink-0">
      <div className={'flex items-center gap-1.5 border-b-2 bg-neutral-900 px-2 py-1.5 ' + theme.accent}>
        {ident?.general && (
          <span className={'shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white ' + theme.chip}>
            {ident.general}
          </span>
        )}
        <span className="flex-1 truncate text-sm font-extrabold uppercase tracking-wide text-white">{def.name}</span>
      </div>
      <div className={'flex ' + theme.band}>
        <div
          aria-hidden
          className="w-2/5 shrink-0 self-stretch bg-neutral-950 bg-no-repeat"
          style={{
            backgroundImage: `url('/_next/image?url=${encodeURIComponent(`/heroscape/cards/${cardId}.jpg`)}&w=384&q=75')`,
            backgroundSize: '280% auto',
            backgroundPosition: '11% 25%',
          }}
        />
        <div className="flex min-w-0 flex-1 items-stretch gap-1 p-1">
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-px">
            {rows.map((r, i) => (
              <div key={i} className="truncate text-[10px] font-bold uppercase leading-tight tracking-wide text-white">{r}</div>
            ))}
            <div className="text-[11px] font-extrabold uppercase leading-tight tracking-wide text-amber-200">
              {def.size ?? 'medium'} {def.height}
            </div>
          </div>
          <div className="flex w-16 shrink-0 flex-col justify-center gap-[3px]">
            <HeaderPill tone="bg-red-800" label="Life" value={def.life} />
            <HeaderPill tone="bg-emerald-700" label="Move" value={def.move} />
            <HeaderPill tone="bg-neutral-600" label="Rng" value={def.range} />
            <HeaderPill tone="bg-rose-700" label="Atk" value={def.attack} />
            <HeaderPill tone="bg-blue-700" label="Def" value={def.defense} />
          </div>
        </div>
      </div>
    </div>
  );
}
function HybridCard({ cardId, onPowerTap, fit, powerAvailable }: { cardId: string; onPowerTap?: (power: { name: string; text: string }, index: number) => void; fit?: boolean; powerAvailable?: boolean }) {
  const def = HS_CARDS[cardId];
  if (!def) return null;
  const powers = POWER_DESCRIPTIONS[cardId] ?? [];
  // `fit` = size to the card's natural content height (used in the now-acting panel so the panel
  // grows with the card instead of clipping it). Without it the card fills its parent (h-full),
  // which equalises heights across the draft grid.
  return (
    <div className={'flex flex-col overflow-hidden rounded-lg border-2 border-amber-900/80 bg-[#c6c2ba] shadow-lg ' + (fit ? '' : 'h-full')}>
      {/* Header — fully reconstructed HTML (title + army-coloured stats), points-free. */}
      <HtmlCardHeader cardId={cardId} />
      {/* Reconstructed powers — crisp HTML; each is a tap target when onPowerTap.
          A hard divider line gives a clean break from the scanned header; flex-1
          lets the parchment fill to the card's height when cards are equalized. */}
      <div className={'flex flex-col gap-1.5 border-t-2 border-neutral-900 px-2.5 pb-2.5 pt-1.5 text-stone-900 ' + (fit ? '' : 'flex-1')}>
        {powers.length > 0 ? powers.map((p, i) => {
          const inner = (
            <>
              <div className="text-[12px] font-extrabold uppercase tracking-wide text-stone-900">{p.name}</div>
              <div className="text-[11px] leading-snug text-stone-800">{p.text}</div>
            </>
          );
          return onPowerTap ? (
            <button
              key={p.name}
              type="button"
              onClick={() => onPowerTap(p, i)}
              title={powerAvailable ? 'Available now — tap to use this power' : 'Tap to use this power'}
              className={
                'rounded-md border-2 px-2 py-1.5 text-left shadow-sm transition active:scale-[0.99] ' +
                (powerAvailable
                  ? 'border-fuchsia-500 bg-fuchsia-100/80 ring-2 ring-fuchsia-400/60 hover:bg-fuchsia-200'
                  : 'border-stone-400/60 bg-stone-100/70 hover:border-amber-600 hover:bg-amber-100')
              }
            >
              {inner}
            </button>
          ) : (
            <div key={p.name} className="px-0.5">{inner}</div>
          );
        }) : (
          <div className="px-0.5 text-[11px] italic text-stone-600">No special power.</div>
        )}
      </div>
    </div>
  );
}

/** The draft card, genuinely ENLARGED: rendered at a base width then scaled up
 *  with CSS `zoom` so the figure art, stat pills, and power text ALL grow together
 *  — a real bigger card at its natural height, not an empty taller frame (the
 *  earlier aspect-ratio version just padded the parchment, which read as "the panel
 *  got bigger, the card didn't"). `zoom` also scales the layout box, so the
 *  measured footprint is correct and nothing below it overlaps. */
function BigCardPreview({ cardId, scale = 1.4, baseWidth = 256 }: { cardId: string; scale?: number; baseWidth?: number }) {
  if (!HS_CARDS[cardId]) return null;
  return (
    <div style={{ zoom: scale, width: baseWidth }} className="overflow-hidden rounded-lg shadow-2xl shadow-black/80">
      <HybridCard cardId={cardId} />
    </div>
  );
}

/** Hover popover with the CLEAN TEXT army card: name, General/class, the whole
 *  stat grid, and every special power (name + printed text from
 *  POWER_DESCRIPTIONS). No image here — the roster/draft PANEL shows the scanned
 *  art; this hover is the readable detail view. Rendered as a CSS group-hover
 *  panel — the parent roster card carries the `group` class, this sits
 *  absolutely over the board (pointer-events-none so it never eats clicks),
 *  appearing above the card. */
function CardHoverPanel({ cardId, placement = 'above', big = false, side = 'right' }: { cardId: string; placement?: 'above' | 'below'; big?: boolean; side?: 'left' | 'right' }) {
  const def = HS_CARDS[cardId];
  if (!def) return null;
  const powers = POWER_DESCRIPTIONS[cardId] ?? [];

  // Draft pool: the hybrid card (scanned header + reconstructed legible powers),
  // pinned to the screen edge OPPOSITE the hovered card so it never covers the
  // card (or its Confirm box) you're interacting with.
  if (big) {
    return (
      <div
        className={
          'pointer-events-none fixed top-1/2 z-50 hidden max-h-[96vh] w-auto -translate-y-1/2 group-hover:block ' +
          (side === 'left' ? 'left-4' : 'right-4')
        }
      >
        <BigCardPreview cardId={cardId} />
      </div>
    );
  }

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
        animation: landed ? 'hsDieIn 380ms cubic-bezier(0.34,1.56,0.64,1)' : undefined,
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
/** Split a combined attack/defense breakdown into BASE (printed) counts + BONUS terms, so the roll
 *  overlay can show which dice are printed vs from height / auras / glyphs. e.g.
 *  ["Attack 3 printed","+1 height","Defense 4 printed"] → {atkBase:3, atkBonus:["+1 height"], defBase:4, defBonus:[]}. */
export function splitBreakdown(breakdown: string[] | undefined): { atkBase: number; atkBonus: string[]; defBase: number; defBonus: string[] } {
  let atkBase = 0, defBase = 0;
  const atkBonus: string[] = [], defBonus: string[] = [];
  let sect: 'atk' | 'def' = 'atk';
  for (const b of breakdown ?? []) {
    const am = b.match(/^Attack (\d+) printed/);
    const dm = b.match(/^Defense (\d+) printed/);
    if (am) { atkBase = +am[1]; sect = 'atk'; }
    else if (dm) { defBase = +dm[1]; sect = 'def'; }
    else if (/^[+-]/.test(b)) { (sect === 'atk' ? atkBonus : defBonus).push(b); }
  }
  return { atkBase, atkBonus, defBase, defBonus };
}

/** A row of rolled dice split into BASE (printed) | BONUS (height/aura/glyph) groups — a divider
 *  between them and a "N base · +1 height" caption, so players SEE where the extra dice came from.
 *  Falls back to a plain row when there's no bonus. `shown` drives the one-at-a-time reveal. */
function SplitDice({ roll, shown, base, bonus }: { roll: CombatFace[]; shown: number; base: number; bonus: string[] }) {
  const split = bonus.length > 0 && base > 0 && base < roll.length;
  const b = split ? base : roll.length;
  return (
    <>
      <div className="mt-2 flex min-h-[64px] flex-wrap items-center justify-center gap-2">
        {roll.slice(0, Math.min(shown, b)).map((f, i) => <BigDie key={'b' + i} face={f} landed />)}
        {split && <div className="mx-1 h-12 self-center border-l-2 border-amber-500/50" />}
        {split && roll.slice(b, shown).map((f, i) => <BigDie key={'x' + i} face={f} landed />)}
        {roll.length === 0 && <span className="text-sm text-neutral-500">no defense dice</span>}
      </div>
      {roll.length > 0 && (
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {b} base{bonus.length > 0 && <span className="text-amber-400"> · {bonus.join(' · ')}</span>}
        </div>
      )}
    </>
  );
}

/** Teams / standings panel (3+ player games). Groups players by TEAM — allies
 *  share a colour — and shows each side's living-figure count, whose turn it is,
 *  and who's been eliminated, so a 3-6 player or 2v2v2 game is legible at a glance.
 *  Hidden in 1-v-1 (the army rows already say it) and outside the playing phase. */
function TeamsPanel({ state, seatColor }: { state: HSState; seatColor: (seat: number) => string }) {
  // Collapsible so it can fold to a single header when the rail is tight — it sits
  // directly below the turn/status panel ([order:-1], just under that panel's -2).
  // Defaults COLLAPSED (just the header + "alive" count); click to expand the full standings.
  const [collapsed, setCollapsed] = useState(true);
  if (state.players.length < 3 || state.phase !== 'playing') return null;
  const hasTeams = state.players.some(p => p.team !== undefined);
  const effTeam = (p: HSState['players'][number]) => p.team ?? -1 - p.seat;
  const groups: { team: number; members: HSState['players'] }[] = [];
  for (const p of [...state.players].sort((a, b) => a.seat - b.seat)) {
    const t = effTeam(p);
    const g = groups.find(x => x.team === t);
    if (g) g.members.push(p); else groups.push({ team: t, members: [p] });
  }
  groups.sort((a, b) => a.team - b.team);
  const livingFor = (seat: number) => state.figures.filter(f => f.ownerSeat === seat && f.at != null).length;
  const aliveTeams = groups.filter(g => g.members.some(m => livingFor(m.seat) > 0)).length;
  return (
    <div className="[order:-1] rounded-lg border-2 border-neutral-700 bg-neutral-900/70 px-3 py-2">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wider text-neutral-300"
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <span>{hasTeams ? 'Teams' : 'Standings'}</span>
        <span className="flex items-center gap-1.5">
          {collapsed && <span className="text-[10px] font-normal text-neutral-500">{aliveTeams}/{groups.length} alive</span>}
          <span className="text-neutral-500">{collapsed ? '▸' : '▾'}</span>
        </span>
      </button>
      {!collapsed && (
      <div className="mt-1.5 flex flex-col gap-1.5">
        {groups.map(({ team, members }) => {
          const living = members.reduce((n, m) => n + livingFor(m.seat), 0);
          const out = living === 0;
          const color = seatColor(members[0].seat);
          const hasTurn = state.subPhase === 'turns' && members.some(m => m.seat === state.turnSeat);
          return (
            <div key={team} className={'rounded-md border px-2 py-1 ' + (hasTurn ? 'border-amber-600/70 bg-amber-950/25' : 'border-neutral-800')}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: out ? '#525252' : color }} />
                  {!hasTeams && members[0].bot && <span className="shrink-0 text-[10px] leading-none opacity-70" title="AI">🤖</span>}
                  <span className="truncate text-[11px] font-bold" style={{ color: out ? '#737373' : color }}>
                    {hasTeams ? `Team ${String.fromCharCode(64 + team)}` : members[0].username}
                  </span>
                  {hasTurn && <span className="rounded bg-amber-900/50 px-1 text-[9px] font-semibold text-amber-300">turn</span>}
                </span>
                <span className={'shrink-0 text-[11px] font-bold tabular-nums ' + (out ? 'text-red-400' : 'text-neutral-300')}>
                  {out ? 'eliminated' : `${living} fig${living === 1 ? '' : 's'}`}
                </span>
              </div>
              {hasTeams && (
                <div className="mt-0.5 flex flex-wrap gap-x-2 pl-4 text-[10px] leading-tight">
                  {members.map(m => (
                    <span key={m.seat} className={livingFor(m.seat) === 0 ? 'text-neutral-600 line-through' : 'text-neutral-400'}>
                      {m.username}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

/** Glyphs panel — lists every glyph on the battlefield so all players know what's
 *  out there. A glyph shows as "?" until a figure stops on it (faceUp), then it
 *  reveals its letter, name, and effect. Hidden glyphs only reveal that SOMETHING
 *  is there — faithful to the face-down marker (you see it, not which glyph). */
function GlyphsPanel({ glyphs }: { glyphs: HSState['glyphs'] }) {
  if (!glyphs || glyphs.length === 0) return null;
  const revealed = glyphs.filter(g => g.faceUp).length;
  // Revealed first (most informative), then unknowns; stable by hex key.
  const sorted = [...glyphs].sort((a, b) => Number(b.faceUp) - Number(a.faceUp) || a.at.localeCompare(b.at));
  return (
    <div className="inline-block rounded-lg border-2 border-rose-900/70 bg-neutral-900/85 px-2.5 py-1.5 shadow-lg shadow-black/50 backdrop-blur-sm">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-rose-300/90">Glyphs</div>
        <div className="text-[10px] tabular-nums text-neutral-500">{revealed}/{glyphs.length}</div>
      </div>
      <div className="flex flex-col gap-1">
        {sorted.map(g => {
          const def = g.faceUp ? HS_GLYPHS[g.id] : null;
          return (
            <div
              key={g.at}
              className={'flex items-center gap-2 whitespace-nowrap' + (def ? ' cursor-help' : '')}
              title={def ? `${def.name} — ${def.effect}` : 'Unknown glyph — stop a figure on it to reveal it.'}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-black text-rose-50"
                style={{ background: '#7f1d1d', borderColor: def ? '#fca5a5' : '#9f1239' }}
              >
                {def ? def.letter : '?'}
              </span>
              {def ? (
                /* One line: NAME (drop "Glyph of") + short POWER; the full effect is on hover (title). */
                <span className="text-[11px] leading-none">
                  <span className="font-bold text-rose-100">{def.name.replace(/^Glyph of /, '')}</span>{' '}
                  <span className="font-semibold text-rose-300/80">{def.power}</span>
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-neutral-500">Unknown</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiceRollOverlay({ attack, onDismiss, final }: { attack: LastAttack; onDismiss: () => void; final?: boolean }) {
  type DefenseGroup = NonNullable<LastAttack['defenseGroups']>[number];
  const PER_DIE = 520; // ms between dice (slowed slightly so each roll reads clearly)
  const attackN = attack.attackRoll.length;
  // Normalize defense into GROUPS. A normal attack is one group (the lone
  // defender). A multi-figure SPECIAL attack (Fire Line / Grenade / Wild Swing)
  // carries one group per affected figure (defenseGroups) so each figure's
  // defense roll is revealed — and seen — separately.
  const grouped = !!(attack.defenseGroups && attack.defenseGroups.length > 0);
  const groups: DefenseGroup[] = grouped
    ? attack.defenseGroups!
    : [{ label: attack.targetLabel, roll: attack.defenseRoll, shields: attack.shields, wounds: attack.wounds, destroyed: attack.destroyed }];

  // 'attack' (reveal the shared attack dice) → 'defense' (reveal each figure's
  // group in turn) → 'result'. shownA = attack dice up; groupIdx = which defense
  // group is rolling; shownD = its dice up; resolved = groups whose outcome shows.
  const [stage, setStage] = useState<'attack' | 'defense' | 'result'>('attack');
  const [shownA, setShownA] = useState(0);
  const [groupIdx, setGroupIdx] = useState(-1);
  const [shownD, setShownD] = useState(0);
  const [resolved, setResolved] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 300; // small beat before the first die lands
    // 1) ATTACK dice, one at a time (rolled ONCE; shared by every affected figure).
    for (let i = 1; i <= attackN; i++) {
      timers.push(setTimeout(() => setShownA(i), t));
      t += PER_DIE;
    }
    // 2) DEFENSE — reveal each figure's group in turn so every roll is seen.
    t += 400;
    timers.push(setTimeout(() => setStage('defense'), t));
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      timers.push(setTimeout(() => { setGroupIdx(gi); setShownD(0); }, t));
      t += 280; // beat to read whose defense this is
      for (let i = 1; i <= g.roll.length; i++) {
        t += PER_DIE;
        timers.push(setTimeout(() => setShownD(i), t));
      }
      t += 500; // beat before the verdict lands — long enough to feel deliberate, not a give-away
      timers.push(setTimeout(() => {
        setResolved(gi + 1); // this figure's outcome lands
        if (g.destroyed) sounds.hsDeath();
        else if (g.wounds > 0) sounds.hsHit();
        else sounds.hsBlocked();
      }, t));
      t += 820; // hold so the per-figure result is readable
    }
    // 3) RESULT.
    t += 250;
    timers.push(setTimeout(() => setStage('result'), t));
    // 4) Auto-dismiss after the result settles. The GAME-WINNING blow holds longer —
    //    ≥4s after the defense roll — so the killing roll fully lands before the
    //    figure vanishes and the win banner / rematch prompt appear (no spoiler).
    t += final ? 3000 : 1900; // hold the result a beat longer so it's easy to digest before the bot moves on
    timers.push(setTimeout(onDismiss, t));
    return () => { for (const id of timers) clearTimeout(id); };
    // attack is fixed for this mount (parent re-keys on seq); run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningSkulls = attack.attackRoll.slice(0, shownA).filter(f => f === 'skull').length;
  const curGroup = groupIdx >= 0 ? groups[groupIdx] : null;
  const runningShields = curGroup ? curGroup.roll.slice(0, shownD).filter(f => f === 'shield').length : 0;
  const curResolved = curGroup != null && resolved > groupIdx;
  const showDefense = stage === 'defense' || stage === 'result';
  // Base (printed) vs bonus (height / aura / glyph) split, parsed from the roll's breakdown,
  // so the overlay can show players where the extra dice came from.
  const { atkBase, atkBonus, defBase, defBonus } = splitBreakdown(attack.breakdown);
  // The figure currently rolling stays visible into the RESULT stage for a single
  // attack; for a splash the result stage instead shows the full per-figure tally.
  const showCurrent = curGroup != null && (stage === 'defense' || (stage === 'result' && !grouped));
  const destroyedCount = groups.filter(g => g.destroyed).length;
  const totalWounds = groups.reduce((a, g) => a + g.wounds, 0);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-end p-2 sm:p-3"
      role="dialog"
      aria-label="Attack roll"
    >
      {/* The keyframe for each die's tumble/scale-in (file has no global CSS). */}
      <style>{`@keyframes hsDieIn { 0% { transform: scale(0.2) rotate(-120deg); opacity: 0; } 70% { transform: scale(1.12) rotate(8deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); } }`}</style>
      {/* Docked to the RIGHT (not a full-screen modal) so the board — and the
          glyph "?" markers — stay visible, and a board click neither lands on the
          panel nor dismisses it (pointer-events pass through the transparent
          wrapper). Auto-dismisses on its timer; "Skip ▸" closes early. */}
      {/* Wide enough for FIVE big dice on one row (a 6th wraps to a second row via flex-wrap). */}
      <div className="pointer-events-auto relative max-h-[calc(100vh-1rem)] w-[min(94vw,25rem)] overflow-y-auto rounded-2xl border-2 border-amber-700/80 bg-neutral-950/97 px-5 py-5 text-center shadow-2xl shadow-black/80">
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
          <SplitDice roll={attack.attackRoll} shown={shownA} base={atkBase} bonus={atkBonus} />
          <div className="mt-2 text-3xl font-black tabular-nums text-orange-300">
            💀 {runningSkulls}
            {stage !== 'attack' && (
              <span className="ml-2 text-base font-bold text-neutral-400">skulls</span>
            )}
          </div>
        </div>

        {/* DEFENSE — one roll, or each figure's roll in turn for a splash */}
        {showDefense && (
          <div className="mt-5 border-t border-neutral-800 pt-4">
            <div className="text-xs font-bold uppercase tracking-wider text-sky-300/90">
              Defense{grouped ? ` — ${groups.length} figures roll separately` : ''}
            </div>

            {/* Figures already resolved collapse into a compact tally (splash only). */}
            {grouped && (
              <div className="mt-2 space-y-0.5">
                {groups.slice(0, stage === 'result' ? groups.length : groupIdx).map((g, i) => (
                  <div key={i} className="flex items-center justify-center gap-2 text-sm">
                    <span className="text-neutral-300">{g.label}</span>
                    <span className="tabular-nums text-sky-300/80">🛡{g.shields}</span>
                    <span className={g.destroyed ? 'font-bold text-red-400' : g.wounds > 0 ? 'font-bold text-orange-300' : 'text-neutral-500'}>
                      {g.destroyed ? 'destroyed!' : g.wounds > 0 ? `${g.wounds} wound${g.wounds === 1 ? '' : 's'}` : 'blocked'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* The figure currently rolling (big dice). */}
            {showCurrent && curGroup && (
              <div className="mt-2">
                {grouped && <div className="text-sm font-semibold text-neutral-200">{curGroup.label}</div>}
                {/* For a splash each figure rolls its own defense, so the main breakdown's base/bonus
                    only maps cleanly to the single-target case — group rolls render unsplit. */}
                <SplitDice
                  roll={curGroup.roll}
                  shown={shownD}
                  base={grouped ? curGroup.roll.length : defBase}
                  bonus={grouped ? [] : defBonus}
                />
                <div className="mt-2 text-3xl font-black tabular-nums text-sky-300">
                  🛡 {runningShields}
                  {!grouped && stage === 'result' && (
                    <span className="ml-2 text-base font-bold text-neutral-400">shields</span>
                  )}
                </div>
                {grouped && curResolved && (
                  <div className={'mt-1 text-lg font-bold ' + (curGroup.destroyed ? 'text-red-400' : curGroup.wounds > 0 ? 'text-orange-300' : 'text-neutral-400')}>
                    {curGroup.destroyed ? 'destroyed!' : curGroup.wounds > 0 ? `${curGroup.wounds} wound${curGroup.wounds === 1 ? '' : 's'}!` : 'blocked'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* RESULT */}
        {stage === 'result' && (
          <div className="mt-5 border-t border-neutral-800 pt-4">
            {grouped ? (
              <div
                className={
                  'text-2xl font-black ' +
                  (destroyedCount > 0 ? 'text-red-400' : totalWounds > 0 ? 'text-orange-300' : 'text-neutral-300')
                }
              >
                {destroyedCount > 0
                  ? `${destroyedCount} figure${destroyedCount === 1 ? '' : 's'} destroyed!`
                  : totalWounds > 0
                    ? `${totalWounds} wound${totalWounds === 1 ? '' : 's'} dealt!`
                    : 'All blocked!'}
              </div>
            ) : (
              <>
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
              </>
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
    for (let i = 1; i <= roll.dice.length; i++) { timers.push(setTimeout(() => setShown(i), t)); t += 420; }
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
          {roll.dice.map((d, i) => {
            // The d20 is drawn as a HEXAGON — two stacked clip-paths make a coloured
            // rim around a dark face — instead of a rounded square. Natural 20 glows
            // gold, a natural 1 glows red.
            const HEXAGON = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
            const rim = d === 20 ? '#fbbf24' : d === 1 ? '#be123c' : '#525252';
            const ink = d === 20 ? '#fcd34d' : d === 1 ? '#fb7185' : '#f5f5f5';
            return (
              <div key={i} className="flex flex-col items-center gap-1" style={{ visibility: i < shown ? 'visible' : 'hidden' }}>
                <div className="relative h-16 w-16" style={{ animation: i < shown ? 'hsD20In 420ms ease-out' : undefined }}>
                  <div className="absolute inset-0" style={{ clipPath: HEXAGON, background: rim }} />
                  <div className="absolute inset-[3px]" style={{ clipPath: HEXAGON, background: '#171717' }} />
                  <div className="absolute inset-0 flex items-center justify-center text-3xl font-black tabular-nums" style={{ color: ink }}>{d}</div>
                </div>
                {roll.labels?.[i] && <div className="max-w-[5rem] truncate text-[10px] text-neutral-400">{roll.labels[i]}</div>}
              </div>
            );
          })}
        </div>
        {allShown && <div className={'mt-4 border-t border-neutral-800 pt-3 text-sm font-semibold ' + resultColor}>{roll.detail}</div>}
      </div>
    </div>
  );
}

/** The round's TURN ORDER, in the ACTUAL play order (`state.initiative`): the initiative
 *  winner first, then seat order rotated to them (p. 9 — "passes to the left"), NOT sorted by
 *  roll. Rendered as ONE continuous arrow chain (wrapping naturally) so every player — the
 *  viewer included — stays in the group; the active player is ringed, the roll shown in parens.
 *  Falls back to seat order before initiative is rolled. */
function TurnOrderSnake({ state, seatColor }: { state: HSState; seatColor: (seat: number) => string }) {
  const order = state.initiative.length > 0
    ? state.initiative
    : [...state.players].map(p => p.seat).sort((a, b) => a - b);
  const last = state.initiativeRolls[state.initiativeRolls.length - 1];
  const rollOf = (seat: number) => last?.find(a => a.seat === seat)?.roll;
  const nameOf = (seat: number) => state.players.find(p => p.seat === seat)?.username ?? '?';
  const rolled = state.initiative.length > 0 && !!last;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {order.map((seat, i) => {
          const active = seat === state.turnSeat;
          const r = rollOf(seat);
          const winner = rolled && i === 0; // turn order is winner-first, so order[0] won initiative
          return (
            <span key={seat} className="flex items-center gap-1">
              {i > 0 && <span className="text-neutral-600">→</span>}
              <span
                className={'rounded px-1.5 py-0.5 font-semibold tabular-nums ' + (active ? 'bg-emerald-900/40 ring-2 ring-emerald-400' : 'bg-neutral-800/60')}
                style={{ color: seatColor(seat) }}
                title={winner ? `Won initiative (rolled ${r}) — acts first` : r != null ? `Rolled ${r} for initiative` : undefined}
              >
                {active ? '⚔ ' : winner ? '👑 ' : ''}{nameOf(seat)}{r != null ? ` (${r})` : ''}
              </span>
            </span>
          );
        })}
      </div>
      {rolled && (
        <div className="mt-0.5 text-[10px] text-neutral-500">
          👑 highest roll acts first — then play passes <span className="text-neutral-400">left around the table</span> (by seat, not by roll)
        </div>
      )}
    </div>
  );
}

export default function HeroScapeBoard({
  state, currentUserId, isHost, disabled,
  onStart, onSetLobbyConfig, onAddBot, onRemoveBot, onAiStep, onPlaceMarkers, onMoveFigure, onMoveStep, onGrappleMove, onFireLine, onExplosion, onAttack,
  onBerserkerCharge, onWaterClone, onMindShackle, onChomp, onGrenade, onGrenadeThrow, onResolveChoice, onUndoMove, onEndMove, onEndTurn,
  onIceShard, onQueglix, onWildSwing, onAcidBreath, onThrow, onCarry, onTheDrop,
  onDraftCard, onDraftPass, onPlaceFigure, onUnplaceFigure, onPlacementReady,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Jotun THROW: after choosing whom to throw, the player CLICKS the landing hex on the board
  // ("you may throw it to any empty space within 4 spaces" — a real choice, never auto-picked).
  const [throwAim, setThrowAim] = useState<{ targetId: string } | null>(null);
  // Theracus CARRY — a board-click sequence (no dropdowns): pick a passenger, then Theracus's
  // flight destination, then the empty space to set the passenger down. `pass`/`dest` fill in
  // as you click; the final landing click fires the carry_move.
  const [carryAim, setCarryAim] = useState<{ pass?: string; dest?: HexKey } | null>(null);
  // GRENADE splash preview: the first tap ARMS a target (the board shows the full blast — that
  // figure + its neighbours), a second tap on it (or the Throw button) confirms. Prevents the
  // old one-tap misfire and shows exactly who gets caught (friend or foe).
  const [grenadeAim, setGrenadeAim] = useState<string | null>(null);
  // Big-Hero single-target powers (Ice Shard / Queglix / Wild Swing): armed from the panel, then
  // fired by TAPPING a highlighted enemy on the board — board-click like every other power. Wild
  // Swing arms the target first so its splash previews; a 2nd tap (or the Swing button) confirms.
  const [bhAim, setBhAim] = useState<
    | { kind: 'ice' }
    | { kind: 'queglix'; dice: 1 | 2 | 3 }
    | { kind: 'wild'; target?: string }
    | { kind: 'acid'; picks: string[] }
    | null
  >(null);
  // slice 7: Sgt. Drake's GRAPPLE GUN toggle. When on, his highlights switch to
  // the 1-space climb-anywhere set and a hex click routes to grapple_move.
  const [grappleMode, setGrappleMode] = useState(false);
  const [fireLineMode, setFireLineMode] = useState(false);
  // Deathwalker 9000 EXPLOSION: when on, enemies in range/sight highlight; clicking one detonates.
  const [explosionMode, setExplosionMode] = useState(false);
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
  // Global army-panel DETAIL LEVEL: 1 = names + life stacked, 2 = compact stat
  // tiles (default), 3 = full cards. Toggled from any player strip's header.
  const [armyDetail, setArmyDetail] = useState<1 | 2 | 3>(1); // default to the thin names+life strip (with order-marker bubbles) for everyone
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
  // Active card-stat edition (Classic vs Modern). Drives the draft-pool points and
  // the budget so what players see matches what the engine enforces. Absent ⇒ modern.
  const cardEdition: HSEdition = state.edition ?? 'modern';
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
    setThrowAim(null);
    setCarryAim(null);
    setExplosionMode(false);
    setGrenadeAim(null);
    setBhAim(null);
  }, [state.round, state.phase]);
  // Drop Grapple / Fire-Line / Mind-Shackle / Chomp mode when the selection changes.
  useEffect(() => {
    setGrappleMode(false);
    setFireLineMode(false);
    setShackleMode(false);
    setChompMode(false);
    setThrowAim(null);
    setCarryAim(null);
    setExplosionMode(false);
    setGrenadeAim(null);
    setBhAim(null);
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
  // Hold a figure's PRE-attack look (its hex AND its wound count) until the dice
  // overlay finishes, so the result is seen LANDING with the roll — otherwise the
  // new state spoils it the instant it arrives (a kill makes the figure vanish, a
  // wound pops new wound markers, both BEFORE the defender's dice are even shown).
  // When an attack overlay opens we snapshot the figures it just affected (killed or
  // freshly wounded) and render those frozen versions via displayState until dismiss.
  const [frozenFigures, setFrozenFigures] = useState<Figure[]>([]);
  const prevFiguresRef = useRef<Figure[]>(state.figures);

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
      // always rolls ≥1 attack die; a splash special carries per-figure groups
      // even when the flat defenseRoll is empty).
      if (la.attackRoll.length > 0 || la.defenseRoll.length > 0 || (la.defenseGroups?.length ?? 0) > 0) {
        setRollAttack(la);
        sounds.hsDice(); // dice rattle as the shared attack roll tumbles in
        // Snapshot every on-board figure THIS attack changed — killed (now off-board)
        // OR freshly wounded (more wounds than a moment ago) — and freeze its old look
        // until the overlay dismisses, so neither the vanish nor the wound markers
        // appear before the dice land.
        const prev = prevFiguresRef.current;
        setFrozenFigures(
          prev.filter(pf => {
            if (pf.at == null) return false; // wasn't on the board
            const cur = state.figures.find(cf => cf.id === pf.id);
            if (!cur || cur.at == null) return true; // killed
            return (cur.wounds ?? 0) > (pf.wounds ?? 0); // newly wounded
          }),
        );
      }
    }
  }, [state.lastAttack]);
  // Trail the previous render's figures by ONE commit. Defined AFTER the effect
  // above so on the killing render it still reads the PRE-kill snapshot, then
  // advances to the new one for next time.
  useEffect(() => {
    prevFiguresRef.current = state.figures;
  }, [state.figures]);
  // BRIDGE the one-frame gap: the effect above sets `frozenFigures` only AFTER this
  // render commits, so on the very frame the kill state arrives the figure would
  // render as GONE for ~1 frame before the effect re-adds it as a ghost — a visible
  // "blink" right as the dice start. Recompute the freeze DURING render here (same
  // pre-attack snapshot) so the ghost is in place on the SAME frame. Computed inline
  // (not memoised) so it falls back to [] the instant the effect catches up — seq seen
  // — and hands off to `frozenFigures` for the rest of the overlay.
  const freshLa = state.lastAttack;
  const freshFrozen: Figure[] =
    freshLa && freshLa.seq > lastSeenSeqRef.current &&
    (freshLa.attackRoll.length > 0 || freshLa.defenseRoll.length > 0 || (freshLa.defenseGroups?.length ?? 0) > 0)
      ? prevFiguresRef.current.filter(pf => {
          if (pf.at == null) return false;
          const cur = state.figures.find(cf => cf.id === pf.id);
          if (!cur || cur.at == null) return true; // killed
          return (cur.wounds ?? 0) > (pf.wounds ?? 0); // newly wounded
        })
      : [];
  // Board-only figure list: the live figures, with any attack-affected figure swapped
  // for its frozen pre-attack version (old hex + old wounds) while the overlay plays,
  // so a kill doesn't vanish and a wound doesn't show until the dice land. Game logic
  // keeps using `state`; only the rendered board sees the frozen figures.
  const frozenShown = freshFrozen.length ? freshFrozen : frozenFigures;
  const displayState = useMemo(() => {
    if (frozenShown.length === 0) return state;
    const frozenById = new Map(frozenShown.map(g => [g.id, g] as const));
    const figures = state.figures.map(f => frozenById.get(f.id) ?? f);
    for (const g of frozenShown) if (!figures.some(f => f.id === g.id)) figures.push(g);
    return { ...state, figures };
  }, [state, frozenShown]);
  // Broadcast whether the dramatic dice-roll overlay is on screen, so the room shell can hold the
  // "Rematch?" prompt back until the FINAL (game-winning) roll has fully played out (no spoiler).
  // Pure UI signal; harmless when nothing is listening.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('hs:dice-overlay', { detail: { active: rollAttack != null } }));
  }, [rollAttack]);
  useEffect(() => {
    const lr = state.lastRoll;
    if (!lr) return;
    if (lr.seq > lastSeenRollSeqRef.current) {
      lastSeenRollSeqRef.current = lr.seq;
      if (lr.dice.length > 0) { setRollD20(lr); sounds.hsDice(); }
      if (lr.title === 'Mind Shackle') sounds.mindFreak(); // Ne-Gok-Sa's seize attempt → "Mind Freak!"
    }
  }, [state.lastRoll]);

  // GLYPH-EVENT FLASH. A TEMPORARY glyph (Mitonsoul / Sturla / Oreld / Kelda) reveals, fires, and is
  // removed in ONE server update — so without this it just blinks out of existence, the only trace a
  // line in the log nobody's watching. Watch the log for new 'glyph'-tagged entries (stable `seq`) and
  // flash them as a banner over the board so the player SEES which glyph triggered and what it did.
  const [glyphFlash, setGlyphFlash] = useState<{ lines: string[]; nonce: number } | null>(null);
  const seenGlyphSeqRef = useRef<number>(-1);
  const glyphInitRef = useRef(false);
  const glyphFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const glyphEntries = state.log.filter(e => e.tag === 'glyph');
    const maxSeq = glyphEntries.reduce((m, e) => Math.max(m, e.seq), -1);
    // On first load, set the high-water mark to existing history so we don't replay old reveals.
    if (!glyphInitRef.current) { seenGlyphSeqRef.current = maxSeq; glyphInitRef.current = true; return; }
    if (maxSeq <= seenGlyphSeqRef.current) return;
    const fresh = glyphEntries.filter(e => e.seq > seenGlyphSeqRef.current).map(e => e.text);
    seenGlyphSeqRef.current = maxSeq;
    if (!fresh.length) return;
    setGlyphFlash({ lines: fresh, nonce: maxSeq });
    sounds.hsGlyph(); // a glyph just revealed/triggered
    if (glyphFlashTimer.current) clearTimeout(glyphFlashTimer.current);
    glyphFlashTimer.current = setTimeout(() => setGlyphFlash(null), 7000);
  }, [state.log]);
  useEffect(() => () => { if (glyphFlashTimer.current) clearTimeout(glyphFlashTimer.current); }, []);

  // Special-attack STINGS — play the matching sound the instant the engine stamps a board VFX
  // (state.lastEffect). One sound per effect, keyed on its monotonic seq so it fires once.
  const lastEffectSeqRef = useRef<number>(state.lastEffect?.seq ?? 0);
  useEffect(() => {
    const e = state.lastEffect;
    if (!e || e.seq <= lastEffectSeqRef.current) return;
    lastEffectSeqRef.current = e.seq;
    ({
      chomp: sounds.hsChomp,
      blast: sounds.hsBlast, // grenade + Deathwalker explosion
      fire_line: sounds.hsFire,
      ice_shard: sounds.hsIce,
      acid_breath: sounds.hsAcid,
      counter_strike: sounds.hsSword,
    } as Record<string, () => void>)[e.kind]?.();
  }, [state.lastEffect]);

  // Victory / draw chime when the game ends — held until any killing-blow dice overlay clears
  // (no spoiler), fired once. Init from the current phase so reloading a finished game is silent.
  const endChimedRef = useRef<boolean>(state.phase === 'finished');
  useEffect(() => {
    if (state.phase !== 'finished') { endChimedRef.current = false; return; } // reset for a rematch
    if (rollAttack || endChimedRef.current) return;
    endChimedRef.current = true;
    if (state.winnerSeat == null && state.winnerTeam == null) sounds.draw();
    else sounds.win();
  }, [state.phase, state.winnerSeat, state.winnerTeam, rollAttack]);

  // Footstep — one soft scuff whenever a figure changes hex (a move). Attacks don't move figures and
  // deaths/placements go to/from null, so this fires only on genuine moves (incl. each AI step).
  const prevPosRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const next = new Map<string, string>();
    for (const f of state.figures) if (f.at != null) next.set(f.id, f.at);
    let moved = false;
    for (const [id, at] of next) { const p = prevPosRef.current.get(id); if (p != null && p !== at) { moved = true; break; } }
    prevPosRef.current = next;
    if (moved) sounds.hsStep();
  }, [state.figures]);

  // Fall thud — fire on a fresh 'fall'-tagged log line (skips history on first load, like glyphFlash).
  const seenFallSeqRef = useRef<number>(-1);
  const fallInitRef = useRef(false);
  useEffect(() => {
    const maxSeq = state.log.reduce((m, e) => (e.tag === 'fall' ? Math.max(m, e.seq) : m), -1);
    if (!fallInitRef.current) { seenFallSeqRef.current = maxSeq; fallInitRef.current = true; return; }
    if (maxSeq > seenFallSeqRef.current) { seenFallSeqRef.current = maxSeq; sounds.hsFall(); }
  }, [state.log]);

  // Drive the AI: while a bot owes an action, the HOST's client ticks `ai_step`
  // ONE action at a time (so its moves + dice animate). The server no-ops once no
  // bot is pending, and only the host drives → no double-stepping. Waits a little
  // longer while an attack roll is on screen so the result is readable.
  // ALSO tick when initiative is OWED but unrolled (every living seat has placed its
  // markers): no one then owes an action, so without this nudge a round left in that
  // state — by a race or an older build — would wedge forever. The server's ai_step
  // rolls the owed initiative even with no bot action, so this self-heals the round.
  useEffect(() => {
    if (!onAiStep || !isHost) return;
    if (aiPendingSeat(state) == null && initiativeReadySeats(state) == null) return;
    // FAST while the bot is doing repetitive, no-dice work — walking a path (move
    // phase, before End Move), deploying figures, drafting, or laying order markers —
    // so a multi-hex move doesn't crawl one slow hex at a time. NORMAL once it's in the
    // attack phase (where rolls happen), and SLOWER still while a dice roll is on screen.
    // HOLD the bot entirely while the dramatic dice overlay is on screen — don't just
    // slow it. Otherwise it can end its turn (advancing the game to the next player)
    // before the player has watched the defense roll finish. When the overlay dismisses
    // (auto ~1.6s after the result, or the player taps Skip ▸), rollAttack clears, this
    // effect re-runs, and the bot proceeds. (Setting rollAttack re-runs this effect and
    // cancels any step already scheduled this commit, so the bot never slips a move in.)
    if (rollAttack) return;
    const fast =
      state.phase === 'draft' ||
      state.phase === 'placement' ||
      state.subPhase === 'place_markers' ||
      (state.subPhase === 'turns' && !state.movementEnded && !state.pendingChoice);
    const delay = fast ? AI_STEP_FAST_MS : AI_STEP_MS;
    const t = setTimeout(() => onAiStep(), delay);
    return () => clearTimeout(t);
  }, [state, onAiStep, isHost, rollAttack]);

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
  // Figures of the now-acting card that STILL HAVE TO MOVE this turn — their base disc lights
  // up to guide "move each one once". An id drops out the instant that figure moves
  // (movedFigureIds), and the whole set clears once an attack is made (movement is over).
  const actionableFigureIds = useMemo(() => {
    const out = new Set<string>();
    // Glow only while moving is still possible: not after an attack, and not after an
    // "after-moving" power (Water Clone / Mind Shackle / Throw / Chomp) has ended the move step.
    const moveOver = state.movementEnded || state.turnAttacks.length > 0
      || state.waterClonedThisTurn || state.mindShackleSpent || state.threwThisTurn || state.chompedThisTurn;
    if (state.phase === 'playing' && state.subPhase === 'turns' && activeCardUid && !moveOver) {
      for (const f of state.figures) {
        if (f.cardUid === activeCardUid && f.at != null && !state.movedFigureIds.includes(f.id)) out.add(f.id);
      }
    }
    return out;
  }, [state, activeCardUid]);

  // ATTACK-PHASE glow: once the move step is over ("End move" tapped, or the first attack made),
  // every active-card figure that can still attack a target lights up — and drops out the moment
  // that figure attacks (legalTargets returns [] once its attack is spent). Mirrors the move glow.
  const attackableFigureIds = useMemo(() => {
    const out = new Set<string>();
    const attackPhase = state.movementEnded || state.turnAttacks.length > 0;
    if (state.phase === 'playing' && state.subPhase === 'turns' && activeCardUid && attackPhase && !state.pendingChoice) {
      for (const f of state.figures) {
        if (f.cardUid === activeCardUid && f.at != null && legalTargets(state, f.id).length > 0) out.add(f.id);
      }
    }
    return out;
  }, [state, activeCardUid]);
  // One disc-glow set for the board: "to move" figures during the move phase, "to attack"
  // figures during the attack phase (the two sets are mutually exclusive by phase).
  const glowIds = useMemo(
    () => new Set([...actionableFigureIds, ...attackableFigureIds]),
    [actionableFigureIds, attackableFigureIds],
  );
  // Figures currently buffed by a friendly position aura (Finn / Thorgrim / Raelin / Grimnak) —
  // a soft gold disc glow so the player can SEE an aura is live. Shown for BOTH sides (it's
  // battlefield information), whenever figures are on the board.
  const auraIds = useMemo(
    () => (state.phase === 'playing' ? auraBuffedFigureIds(state) : new Set<string>()),
    [state],
  );

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

  // (Figure facing/flip control removed — HeroScape has no facing rules, so it had no gameplay
  // effect. A 2-hex figure reorients its footprint simply by moving.)

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
  // Normal movement is now STEP-BY-STEP: the highlights are the figure's legal
  // SINGLE steps right now (recomputed each render, so they update after every
  // tapped step). Grapple Gun stays a one-space destination set.
  // SMART MOVEMENT: the clickable set is the figure's WHOLE reachable range — click
  // any hex to walk there in one go (doMove finds the route + rolls any swipe/fall).
  // Grapple Gun stays its own one-space climb set.
  const destinations = useMemo(
    () =>
      canAct && selected && !fireLineMode
        ? grappleMode
          ? grappleHexes
          : movementRangeHexes(state, selected.id)
        : new Set<HexKey>(),
    [state, selected, canAct, grappleMode, grappleHexes, fireLineMode],
  );
  // Reachable destinations whose ENDPOINT would leave a start-engaged enemy — a
  // leaving-engagement swipe fires on arrival, so the board marks them RED. Empty
  // while grappling / aiming, or when the figure isn't engaged (then all green).
  const disengageHexes = useMemo(
    () =>
      canAct && selected && !fireLineMode && !grappleMode
        ? disengageMoveHexes(state, selected.id)
        : new Set<HexKey>(),
    [state, selected, canAct, grappleMode, fireLineMode],
  );
  // GREEN (safe) destinations = the reachable set minus the ones that provoke a swipe.
  const safeMoveHexes = useMemo(() => {
    const s = new Set<HexKey>();
    for (const k of destinations) if (!disengageHexes.has(k)) s.add(k);
    return s;
  }, [destinations, disengageHexes]);
  // Shooting-range envelope: while a RANGED figure of mine is MOVING, the hexes it
  // could still shoot from where it currently stands (its effective Range, around
  // gaps). The board keeps these bright and dims everything beyond, so the edge
  // shows the furthest targetable hex; it follows the figure as it steps. Empty for
  // a melee figure or in the attack phase (the red target rings take over then).
  const shootRange = useMemo(
    () =>
      canAct && selected && !state.movementEnded && !fireLineMode && !grappleMode
        ? shootingRangeHexes(state, selected.id)
        : new Set<HexKey>(),
    [state, selected, canAct, fireLineMode, grappleMode],
  );
  // The blocked SUBSET of that envelope: in range, but a wall/column breaks the line
  // of sight (terrain-only). The board greys these so "in range" no longer reads as
  // "can shoot" now that the Star Field has height-15 walls.
  const shootBlocked = useMemo(
    () =>
      canAct && selected && !state.movementEnded && !fireLineMode && !grappleMode
        ? shootBlockedHexes(state, selected.id)
        : new Set<HexKey>(),
    [state, selected, canAct, fireLineMode, grappleMode],
  );
  // Attackable enemies — only in the ATTACK PHASE (after "End move"), so red target rings and
  // the attack click are inert while the player is still moving.
  const targets = useMemo(
    () => (canAct && selected && !fireLineMode && state.movementEnded ? new Set(legalTargets(state, selected.id)) : new Set<string>()),
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
  // Figures the Fire Line could hit (union across all 6 directions) — highlighted while AIMING
  // so the player SEES who is in the fire (friend OR foe) before committing to a direction.
  const fireLineVictims = useMemo(() => {
    const ids = new Set<string>();
    if (fireLineMode && selected) {
      for (let d = 0; d < 6; d++) for (const f of fireLineTargets(state, selected.id, d)) ids.add(f.id);
    }
    return ids;
  }, [state, selected, fireLineMode]);
  // Deathwalker 9000 EXPLOSION — the active Deathwalker figure + whether he can Explode now.
  const dwHeroId = activeCard?.cardId === 'deathwalker_9000'
    ? (state.figures.find(f => f.cardUid === activeCardUid && f.at != null)?.id ?? null)
    : null;
  const canExplode = !!(canAct && me && canExplosion(state, me.seat));
  // Enemies Deathwalker may Explode (in range + clear sight) — highlighted while aiming so the
  // player sees who's in range; clicking one detonates (the splash also hits figures adjacent to it).
  const explosionTargetSet = useMemo(
    () => (explosionMode && dwHeroId ? new Set(explosionTargets(state, dwHeroId)) : new Set<string>()),
    [state, dwHeroId, explosionMode],
  );

  // slice 8: Ne-Gok-Sa MIND SHACKLE — offered when my active Ne-Gok-Sa has an
  // adjacent enemy and hasn't attacked. In shackle mode the adjacent enemy
  // figures (the engine's single-source target set) highlight; a click sends it.
  const canShackle = !!(canAct && me && canMindShackle(state, me.seat));
  // Ne-Gok-Sa's Mind Shackle is shown ON the acting card whenever he's active — even
  // when it can't be used yet — with a reason, so it never just silently vanishes.
  const isNeGokActive = activeCard?.cardId === 'ne_gok_sa';
  const shackleReason: string | null = !isNeGokActive
    ? null
    : state.turnAttacks.length > 0
      ? 'not after attacking'
      : state.mindShackleSpent
        ? 'already used this turn'
        : !canShackle
          ? 'move adjacent to an enemy'
          : null; // null ⇒ usable now
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
  // The blast an armed grenade aim will hit (target + neighbours, friend or foe) — the orange
  // "blast zone" ring. Uses the engine's own grenadeDefenders so the preview matches the resolution.
  const grenadeSplashIds = useMemo(
    () => (grenadeChoice && grenadeAim
      ? new Set(grenadeDefenders(state, grenadeChoice.throwers[0], grenadeAim).map(d => d.figureId))
      : new Set<string>()),
    [grenadeChoice, grenadeAim, state],
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
  // Carry board-click highlights, by step: pick passenger (those figures glow) → pick Theracus's
  // destination (his flight range) → pick where to set the passenger down (empty hexes next to the
  // chosen destination — matches the engine's "adjacent, empty" check). Only one is non-null at a time.
  const carryPassSet = carryAim && !carryAim.pass ? new Set(carryList) : null;
  const carryDestSet = carryAim?.pass && !carryAim.dest && bhHeroId ? legalDestinations(state, bhHeroId) : null;
  // Footprint-aware drops (Theracus is 2-hex — the engine helper accounts for his tail at the
  // destination, so the board offers exactly the legal landing spaces).
  const carryLandSet = carryAim?.pass && carryAim.dest && bhHeroId
    ? new Set(carryLandingHexes(state, bhHeroId, carryAim.dest, carryAim.pass))
    : null;
  // Optimistic carry: render Theracus AT his chosen destination footprint during the drop step,
  // so he's shown "in position" (the standee flies there) and you set the passenger down next to
  // where he actually is. Reverts on Cancel; the real carry_move lands when you click a drop.
  const carryPreviewFoot = carryAim?.pass && carryAim.dest && bhHeroId
    ? carryDestFootprint(state, bhHeroId, carryAim.dest)
    : null;
  const boardState = carryPreviewFoot && bhHeroId
    ? {
        ...displayState,
        figures: displayState.figures.map(f =>
          f.id === bhHeroId ? { ...f, at: carryPreviewFoot[0], at2: carryPreviewFoot[1] ?? null } : f,
        ),
      }
    : displayState;
  const anyBigHeroPower =
    iceList.length || qList.length || wildList.length || acidList.length || throwList.length || carryList.length;
  // Wild Swing's blast (armed target + its neighbours) — the SAME orange "blast zone" ring as the
  // grenade, merged into one splashIds set for the board (only one is ever active at a time).
  const wildSplashIds = useMemo(
    () => (bhAim?.kind === 'wild' && bhAim.target && bhHeroId
      ? new Set(wildSwingDefenders(state, bhHeroId, bhAim.target).map(d => d.figureId))
      : new Set<string>()),
    [bhAim, bhHeroId, state],
  );
  // Acid Breath picks also wear the orange "will be hit" ring while aiming.
  const acidPickIds = useMemo(() => (bhAim?.kind === 'acid' ? new Set(bhAim.picks) : new Set<string>()), [bhAim]);
  const splashIds = useMemo(() => new Set([...grenadeSplashIds, ...wildSplashIds, ...acidPickIds]), [grenadeSplashIds, wildSplashIds, acidPickIds]);

  // Tap a power on the "Now acting" card → reveal + briefly flash its controls in
  // the Special Power panel below (where the activation entry point lives).
  const powerPanelRef = useRef<HTMLDivElement>(null);
  const [powerFlash, setPowerFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealPowerPanel = useCallback(() => {
    powerPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setPowerFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setPowerFlash(false), 1400);
  }, []);
  // Tap a special ON the Now-acting card to USE it — the power is part of the card, not a
  // separate button. Routes by the active card, gated on the SAME eligibility the engine
  // enforces (these flags are correct — the earlier "missing button" was a clipping bug, not a
  // flag bug): roll/instant powers fire, toggle powers enter targeting mode, Big Heroes open
  // their picker panel. If a power isn't usable yet we flash a short reason instead of failing
  // silently. Tapping a toggle power again turns its targeting mode back off.
  const [powerHint, setPowerHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPowerHint = (msg: string) => {
    setPowerHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setPowerHint(null), 3500);
  };
  const onCardPower = () => {
    const cid = activeCard?.cardId;
    if (!cid || !canAct) return;
    switch (cid) {
      case 'tarn_vikings':
        if (canBerserk) onBerserkerCharge();
        else showPowerHint(
          state.berserkerSpent ? 'Berserker Charge — already used this turn.'
            : state.turnAttacks.length > 0 ? 'Berserker Charge — not after attacking.'
              : 'Berserker Charge — move a Viking first.');
        return;
      case 'marro_warriors':
        if (canWaterClone) onWaterClone();
        else showPowerHint('Water Clone — use it before attacking (it replaces your attack).');
        return;
      case 'ne_gok_sa': {
        if (!canShackle) { showPowerHint(`Mind Shackle — ${shackleReason ?? 'not available'}.`); return; }
        const ids = me ? mindShackleTargets(state, me.seat) : [];
        if (ids.length === 0) showPowerHint('Mind Shackle — no adjacent enemy.');
        else if (ids.length === 1) onMindShackle(ids[0]);  // exactly one adjacent → just do it
        else setShackleMode(true);   // more than one → highlight them on the board; tap the figure to seize
        return;
      }
      case 'grimnak': {
        if (!canDoChomp) { showPowerHint('Chomp — move next to a medium or small enemy first.'); return; }
        const ids = me ? chompTargets(state, me.seat) : [];
        if (ids.length === 0) showPowerHint('Chomp — no adjacent medium/small enemy.');
        else if (ids.length === 1) onChomp(ids[0]);
        else setChompMode(true); // more than one → highlight them on the board; tap the figure to chomp
        return;
      }
      case 'mimring':
        if (canFire) setFireLineMode(m => !m);
        else showPowerHint('Fire Line — available before you attack.');
        return;
      case 'drake':
        if (canGrapple) setGrappleMode(m => !m);
        else showPowerHint('Grapple Gun — use it before Drake moves.');
        return;
      case 'airborne_elite':
        if (canThrowGrenade) onGrenade();
        else showPowerHint('Grenade — once per game, used before attacking.');
        return;
      case 'deathwalker_9000':
        if (canExplode) setExplosionMode(m => !m); // then click an enemy in range
        else showPowerHint('Explosion — no enemy in clear sight within Range 7.');
        return;
      case 'braxas':
        // Tapping Acid Breath on the card goes STRAIGHT into pick-on-board mode (no
        // separate "aim" step): tap up to 3 figure bases, then "Breathe" on the panel.
        if (acidList.length > 0) { setBhAim({ kind: 'acid', picks: [] }); revealPowerPanel(); }
        else showPowerHint('Acid Breath — no small or medium figure adjacent.');
        return;
      default:
        revealPowerPanel(); // other Big Heroes (Ice Shard / Queglix / …) & passive cards
        return;
    }
  };
  // Does the now-acting card have a power you can trigger by tapping it? (drives the hint)
  const activeCardHasTapPower =
    !!activeCard &&
    (['tarn_vikings', 'marro_warriors', 'ne_gok_sa', 'grimnak', 'mimring', 'drake', 'airborne_elite', 'deathwalker_9000'].includes(
      activeCard.cardId,
    ) ||
      !!anyBigHeroPower);
  // Is the active card's power usable RIGHT NOW? Drives the bright-fuchsia "available" box.
  const activePowerAvailable =
    activeCard?.cardId === 'tarn_vikings' ? canBerserk
      : activeCard?.cardId === 'marro_warriors' ? canWaterClone
        : activeCard?.cardId === 'ne_gok_sa' ? canShackle
          : activeCard?.cardId === 'grimnak' ? canDoChomp
            : activeCard?.cardId === 'mimring' ? canFire
              : activeCard?.cardId === 'drake' ? canGrapple
                : activeCard?.cardId === 'airborne_elite' ? canThrowGrenade
                  : activeCard?.cardId === 'deathwalker_9000' ? canExplode
                    : !!anyBigHeroPower;
  /** Readable label for a figure id (card short name + squad index + hex). */
  const figName = (id: string): string => {
    const f = state.figures.find(x => x.id === id);
    if (!f) return id;
    const cd = HS_CARDS[state.cards.find(c => c.uid === f.cardUid)?.cardId ?? ''];
    return `${cd?.shortName ?? '?'}${cd?.type === 'squad' ? ' #' + f.index : ''} (${f.at})`;
  };

  // slice 8: Airborne Elite THE DROP — at round start (place_markers). A "Roll The
  // Drop" button rolls a GLOBAL d20 (everyone sees the overlay); on 13+ the engine
  // opens an `airborne_drop` pending choice, `dropPlacing` flips true, and the owner
  // clicks the highlighted legal hexes (mutually non-adjacent) to land all reserve
  // Airborne. So the placement is offered ONLY after the roll, never before.
  const canDoDrop = !!(me && canTheDrop(state, me.seat));
  const dropPlacing = myChoice?.kind === 'airborne_drop' ? myChoice : null;
  const dropReserveCount = dropPlacing
    ? dropPlacing.count
    : me ? state.figures.filter(f => f.ownerSeat === me.seat && f.reserve).length : 0;
  const dropLegalSet = useMemo(
    () => (dropPlacing && me ? new Set(theDropHexes(state, me.seat)) : new Set<HexKey>()),
    [dropPlacing, me, state],
  );
  // Drop the chosen landings whenever we leave the placement step (rolled, missed,
  // deployed, or it became someone else's choice).
  useEffect(() => { if (!dropPlacing) setDropPicks([]); }, [dropPlacing]);

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

  // ----- wave-3 CHOICE glyphs (Erland / Nilrend / Wannok) board resolution -----
  // Erland (Summoning): a two-tap board flow — tap a summonable figure, then an empty
  // adjacent space. `erlandPick` is the figure chosen to teleport.
  const erlandChoice = myChoice?.kind === 'glyph_erland' ? myChoice : null;
  const erlandSummonSet = useMemo(() => new Set(erlandChoice ? erlandSummonableIds(state) : []), [erlandChoice, state]);
  const erlandDestSet = useMemo(() => new Set(erlandChoice ? erlandDestinations(state) : []), [erlandChoice, state]);
  const [erlandPick, setErlandPick] = useState<string | null>(null);
  useEffect(() => { if (!erlandChoice) setErlandPick(null); }, [erlandChoice]);
  // Nilrend (Negation): after the d20, tap any figure of an ELIGIBLE unique card to negate it.
  const nilrendChoice = myChoice?.kind === 'glyph_nilrend' && myChoice.d20 != null ? myChoice : null;
  const nilrendCardSet = useMemo(
    () => new Set(nilrendChoice ? (nilrendChoice.d20 === 1 ? nilrendChoice.ownCardUids : nilrendChoice.foeCardUids) : []),
    [nilrendChoice],
  );
  const nilrendFigSet = useMemo(
    () => new Set(state.figures.filter(f => f.at != null && nilrendCardSet.has(f.cardUid)).map(f => f.id)),
    [state.figures, nilrendCardSet],
  );
  // Wannok (Curse) controller step (2+): tap an OPPONENT figure to name that player.
  const seatTeam = (seat: number) => { const p = state.players.find(x => x.seat === seat); return p ? effTeam(p) : -1 - seat; };
  const wannokChoice = myChoice?.kind === 'glyph_wannok' && myChoice.d20 != null ? myChoice : null;
  const wannokOppSet = useMemo(
    () => new Set(wannokChoice && me ? state.figures.filter(f => f.at != null && seatTeam(f.ownerSeat) !== seatTeam(me.seat)).map(f => f.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wannokChoice, me, state],
  );
  // Wannok victim step: the named opponent taps one of THEIR OWN figures to wound.
  const wannokVictimChoice = myChoice?.kind === 'glyph_wannok_victim' ? myChoice : null;
  const wannokOwnSet = useMemo(
    () => new Set(wannokVictimChoice && me ? state.figures.filter(f => f.at != null && f.ownerSeat === me.seat).map(f => f.id) : []),
    [wannokVictimChoice, me, state],
  );
  // Sturla (Resurrection) placement: after the owner's d20s, each figure that rolled a 20
  // rises one at a time — the OWNER taps a free start-zone hex to set it down (fresh, no wounds).
  const sturlaPlaceChoice = myChoice?.kind === 'glyph_sturla_place' ? myChoice : null;
  const sturlaPlaceSet = useMemo(
    () => new Set(sturlaPlaceChoice ? sturlaPlacementHexes(state, sturlaPlaceChoice.figureId) : []),
    [sturlaPlaceChoice, state],
  );
  // ROLL CEREMONY (Mitonsoul curse / Sturla resurrection) — the shared d20 ritual. UNLIKE the
  // other prompts this is visible to EVERY player (they watch); only the current roller (pc.seat)
  // can act. Read straight off the pending (not myChoice) so spectators see it too.
  const ceremony = state.pendingChoice?.kind === 'roll_ceremony' ? state.pendingChoice : null;
  const ceremonyIsMine = !!ceremony && !!me && ceremony.seat === me.seat;
  // Play a sting as each roll SETTLES — the dice clatter + d20 overlay already fire off lastRoll;
  // here we add the death knell (a curse 1) and the rise chime (a resurrect 20). Keyed on the
  // results count so it fires exactly once per roll, for everyone watching.
  const lastCeremonyResultRef = useRef(0);
  useEffect(() => {
    const n = ceremony?.results.length ?? 0;
    if (n > lastCeremonyResultRef.current) {
      lastCeremonyResultRef.current = n;
      const out = ceremony?.results[n - 1]?.outcome;
      if (out === 'died') sounds.hsDeath();
      else if (out === 'rose') sounds.win();
    } else if (n === 0) {
      lastCeremonyResultRef.current = 0; // reset between ceremonies
    }
  }, [ceremony?.results.length, ceremony]);

  // All figure ids the open choice lets me tap — fed into the board's powerTarget ring. The
  // ceremony's SELECTED figure glows for everyone (a curse figure is on the board; a resurrect
  // one isn't, so the ring only shows for the curse — the panel list carries the rest).
  const choiceFigIds = useMemo(
    () => new Set<string>([...erlandSummonSet, ...nilrendFigSet, ...wannokOppSet, ...wannokOwnSet, ...(ceremony?.selectedFigureId ? [ceremony.selectedFigureId] : [])]),
    [erlandSummonSet, nilrendFigSet, wannokOppSet, wannokOwnSet, ceremony?.selectedFigureId],
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
      if (occG && grenadeTargetSet.has(occG.id)) {
        if (grenadeAim === occG.id) { onGrenadeThrow(occG.id); setGrenadeAim(null); } // 2nd tap on the armed target throws
        else setGrenadeAim(occG.id); // 1st tap arms it + previews the blast (target + neighbours)
      }
      return;
    }
    // slice 8: The Drop landing selection (after a 13+ roll; works outside a turn).
    // Click a highlighted legal hex to add/remove it; reject one adjacent to an
    // already-picked landing or once the reserve count is reached.
    if (dropPlacing && !disabled) {
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
    // --- wave-3 CHOICE glyphs (resolve by board tap; work outside a turn) ---
    // Erland: tap a highlighted summonable figure, then an empty adjacent space.
    if (erlandChoice && !disabled) {
      const occE = occupantAt(key);
      if (erlandPick && erlandDestSet.has(key)) { onResolveChoice({ kind: 'glyph_erland', figureId: erlandPick, to: key }); setErlandPick(null); }
      else if (occE && erlandSummonSet.has(occE.id)) setErlandPick(occE.id); // pick / re-pick the figure to summon
      return;
    }
    // Nilrend: tap any figure of an eligible unique card to negate that card.
    if (nilrendChoice && !disabled) {
      const occN = occupantAt(key);
      if (occN && nilrendFigSet.has(occN.id)) onResolveChoice({ kind: 'glyph_nilrend', cardUid: occN.cardUid });
      return;
    }
    // Wannok controller (2+): tap an opponent figure to name that player.
    if (wannokChoice && !disabled) {
      const occW = occupantAt(key);
      if (occW && wannokOppSet.has(occW.id)) onResolveChoice({ kind: 'glyph_wannok', opponentSeat: occW.ownerSeat });
      return;
    }
    // Wannok victim: the named opponent taps one of their own figures to wound.
    if (wannokVictimChoice && !disabled) {
      const occV = occupantAt(key);
      if (occV && wannokOwnSet.has(occV.id)) onResolveChoice({ kind: 'glyph_wannok_victim', figureId: occV.id });
      return;
    }
    // Sturla placement: the owner taps a free start-zone hex to set the risen figure down.
    if (sturlaPlaceChoice && !disabled) {
      if (sturlaPlaceSet.has(key)) onResolveChoice({ kind: 'glyph_sturla_place', hex: key });
      return;
    }
    if (!canAct) return;
    // Jotun THROW landing — after choosing whom to throw, click a highlighted legal landing hex
    // (empty, within 4, in clear sight) to hurl the figure there (the server rolls both d20s).
    if (throwAim) {
      if (bhHeroId && throwLandingHexes(state, bhHeroId, throwAim.targetId).includes(key)) {
        onThrow(bhHeroId, throwAim.targetId, key);
        setThrowAim(null);
      }
      return; // while aiming a throw, a click never falls through to move/attack
    }
    // Theracus CARRY — three board clicks: a passenger, then his destination, then the empty
    // space to set the passenger down (adjacent to where he lands). The carry_move fires on the
    // final landing click; the server rolls any take-off swipe / fall just like a normal move.
    if (carryAim && bhHeroId) {
      if (!carryAim.pass) {
        const p = occupantAt(key);
        if (p && carryList.includes(p.id)) setCarryAim({ pass: p.id });
      } else if (!carryAim.dest) {
        if (legalDestinations(state, bhHeroId).has(key)) setCarryAim({ ...carryAim, dest: key });
      } else if (carryLandSet?.has(key)) {
        onCarry(bhHeroId, carryAim.dest, carryAim.pass, key);
        setCarryAim(null);
      }
      return; // while carrying, a click never falls through to move/attack
    }
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
    // Deathwalker 9000 EXPLOSION — click a highlighted enemy in range/sight to detonate; the
    // splash hits every figure adjacent to it (the server rolls 3 attack dice once).
    if (explosionMode) {
      if (occ && dwHeroId && explosionTargetSet.has(occ.id)) { onExplosion(dwHeroId, occ.id); setExplosionMode(false); }
      return;
    }
    // Big-Hero single-target powers (board-click). Armed from the panel; tap a highlighted enemy to
    // fire. Ice Shard / Queglix fire on the tap; Wild Swing arms the target (splash previews orange)
    // then a 2nd tap on it (or the Swing button) confirms.
    if (bhAim && bhHeroId) {
      if (occ) {
        if (bhAim.kind === 'ice' && iceList.includes(occ.id)) { onIceShard(bhHeroId, occ.id); setBhAim(null); }
        else if (bhAim.kind === 'queglix' && qList.includes(occ.id)) { onQueglix(bhHeroId, occ.id, bhAim.dice); setBhAim(null); }
        else if (bhAim.kind === 'wild' && wildList.includes(occ.id)) {
          if (bhAim.target === occ.id) { onWildSwing(bhHeroId, occ.id); setBhAim(null); }
          else setBhAim({ kind: 'wild', target: occ.id });
        }
        else if (bhAim.kind === 'acid' && acidList.includes(occ.id)) {
          // Toggle up to 3 small/medium figures (any owner) for the breath; confirm via "Breathe".
          const picks = bhAim.picks.includes(occ.id)
            ? bhAim.picks.filter(x => x !== occ.id)
            : bhAim.picks.length < 3 ? [...bhAim.picks, occ.id] : bhAim.picks;
          setBhAim({ kind: 'acid', picks });
        }
      }
      return;
    }
    // Attack — ATTACK PHASE ONLY (after "End move"). During the move phase a tap on an enemy
    // never attacks: it either steps there (Agent Carr ghost-walking through) or does nothing,
    // so you can't accidentally attack while you think you're still moving.
    if (state.movementEnded && occ && selected && occ.ownerSeat !== me!.seat) {
      if (targets.has(occ.id)) {
        onAttack(selected.id, occ.id);
        // slice 6: keep Syvarris selected after his first attack so his targets
        // stay highlighted for the optional Double Attack. Others deselect.
        const attackerCardId = state.cards.find(c => c.uid === selected.cardUid)?.cardId;
        if (!(attackerCardId === 'syvarris' && state.turnAttacks.length === 0)) setSelectedId(null);
      }
      return;
    }
    // SMART MOVE: click ANY highlighted space in range to walk straight there (the
    // engine routes it + rolls any leaving-engagement swipe / fall on arrival). A RED
    // space still moves — it just warns the swipe will happen. Grapple-Gun mode is a
    // one-space jump. For a 2-hex figure the front leads to the clicked hex.
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
  // A seat's panel anchor: you are bottom-left; everyone else fans out by SEAT order from you
  // (so it never shuffles with initiative). 4 corners for ≤4 players, 6 spots for 5-6.
  function panelSlotAnchor(seat: number): string {
    const anchors = state.players.length <= 4 ? PANEL_ANCHORS_4 : PANEL_ANCHORS_6;
    const order = state.players.map(p => p.seat).sort((a, b) => a - b);
    const meIdx = me ? order.indexOf(me.seat) : 0;
    const ring = [...order.slice(meIdx), ...order.slice(0, meIdx)]; // you first (bottom-left), then by seat
    const slot = ring.indexOf(seat);
    return anchors[slot] ?? anchors[anchors.length - 1];
  }
  function renderArmyRow(seat: number) {
    const entry = roster.find(r => r.pl.seat === seat);
    if (!entry) return null;
    const { pl, cards } = entry;
    const isMe = !!me && pl.seat === me.seat;
    const placingMine = placing && isMe && !iAmReady;
    const isActive = seat === state.turnSeat && state.subPhase === 'turns';
    // Detail level applies to every strip; a player PLACING markers needs the
    // tiles to click, so their own strip is forced to level 2 while placing.
    const level: 1 | 2 | 3 = placingMine ? 2 : armyDetail;
    const colorFor = (dead: boolean) => (dead ? '#737373' : seatColor(seat));
    // The strip is only as wide as its cards (w-fit), but wraps within the column
    // when a big army would overflow (max-w-full).
    return (
      <div className={'w-fit max-w-full rounded-lg border bg-neutral-900/55 px-2 py-1 shadow-lg shadow-black/40 backdrop-blur-sm ' + (isActive ? 'border-amber-700/70' : 'border-neutral-800')}>
        <div className="flex flex-wrap items-center gap-2">
          {/* NAME on the LEFT (user request). */}
          <span className="flex items-center gap-1.5">
            <span className="text-xs font-bold" style={{ color: seatColor(pl.seat) }}>{pl.username}{isMe ? ' (you)' : ''}</span>
            {isActive && <span className="rounded bg-amber-900/50 px-1 text-[9px] font-semibold text-amber-300">turn</span>}
          </span>
          {/* detail-level control (1/2/3) — global; applies to every player's strip. Pinned to the
              UPPER-RIGHT of the panel (user request) via ml-auto. */}
          {!placingMine && (
            <span className="ml-auto flex items-center gap-0.5 rounded border border-neutral-700 p-0.5" title="Army-panel detail (applies to all players)">
              {([1, 2, 3] as const).map(lv => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setArmyDetail(lv)}
                  title={lv === 1 ? 'Names + life' : lv === 2 ? 'Compact cards' : 'Full cards'}
                  className={'rounded px-1.5 text-[10px] font-bold leading-4 transition ' + (armyDetail === lv ? 'bg-neutral-200 text-neutral-900' : 'text-neutral-400 hover:bg-neutral-800')}
                >
                  {lv}
                </button>
              ))}
            </span>
          )}
          {placingMine && (
            <span className="ml-auto flex items-center gap-1">
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
        </div>
        {/* LEVEL 1 — army names + life status, stacked thin, with each card's ORDER
            MARKERS to the LEFT of its name (user request). ALL markers show — your own
            with their number, an opponent's as anonymous FACE-DOWN bubbles (same as
            levels 2/3) — so every card visibly carries its order-marker slots; a
            revealed marker (the turn that came up) lights amber. */}
        {level === 1 && (
          <div className="mt-1 flex flex-col gap-0.5">
            {cards.map(({ uid, def, alive, heroWounds, markers }) => {
              const dead = alive === 0;
              const active = uid === activeCardUid && state.subPhase === 'turns';
              const shownMarkers = markers ?? [];
              return (
                <div key={uid} className={'group relative flex items-center justify-between gap-3 rounded px-1.5 py-0.5 text-[11px] ' + (active ? 'bg-amber-900/30 ring-1 ring-amber-600 ' : '') + (dead ? 'opacity-45' : '')}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {shownMarkers.length > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5">
                        {shownMarkers.map((m, i) => <MarkerChip key={i} m={m} size={14} />)}
                      </span>
                    )}
                    <span className={'truncate font-semibold ' + (dead ? 'line-through' : '')} style={{ color: colorFor(dead) }}>{def.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center tabular-nums text-neutral-400">
                    {def.type === 'hero' ? <WoundPips life={def.life} wounds={dead ? def.life : heroWounds} /> : `${alive}/${def.figures}`}
                  </span>
                  <CardHoverPanel cardId={def.id} big />
                </div>
              );
            })}
          </div>
        )}

        {/* LEVEL 2 — compact stat tiles (the default); wraps if a wide army doesn't fit. */}
        {level === 2 && (
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
                <CardHoverPanel cardId={def.id} big />
              </div>
            );
          })}
        </div>
        )}

        {/* LEVEL 3 — the full cards (with markers above + a live-status badge). */}
        {level === 3 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {cards.map(({ uid, def, alive, heroWounds, markers }) => {
              const active = uid === activeCardUid && state.subPhase === 'turns';
              const dead = alive === 0;
              return (
                <div key={uid} className="flex flex-col items-center gap-0.5">
                  <div className="flex h-5 items-center justify-center gap-0.5">
                    {markers.map((m, i) => <MarkerChip key={i} m={m} size={16} />)}
                  </div>
                  <div className={'relative w-[240px] overflow-hidden rounded-lg ' + (active ? 'ring-2 ring-amber-500 ' : '') + (dead ? 'opacity-45 grayscale' : '')}>
                    <HybridCard cardId={def.id} />
                    <span className="absolute right-1 top-1 flex items-center rounded bg-neutral-950/85 px-1 py-0.5 text-[10px] font-bold tabular-nums text-neutral-200">
                      {def.type === 'hero' ? <WoundPips life={def.life} wounds={dead ? def.life : heroWounds} /> : `${alive}/${def.figures}`}
                    </span>
                  </div>
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
          : lobbyMode === 'draft' && !selectedMapOk ? `${MAPS[lobbyMapId].name} doesn't fit ${count} players — pick the Star Field.`
            : teamsInUse && !teamsValid ? 'All players are on one team — assign at least two sides.'
              : '';
    const mapBlurb: Record<string, string> = {
      training_field: 'Flat grass — learn the ropes. (2 players)',
      the_knoll: 'A 3-tier rock hill — climb for height advantage. (2 players)',
      ford_crossing: 'A water river split by a narrow ford. (2 players)',
      star_field: 'A giant 6-point star — a deploy zone per point. (2-6 players)',
    };
    return (
      <div className="flex flex-col items-center gap-4 p-6">
        <h2 className="text-xl font-bold text-amber-100">HeroScape</h2>
        <p className="max-w-md text-center text-sm text-neutral-400">
          Master Game: draft an army against a point budget, deploy your figures, then each
          round place secret order markers, roll for initiative, and battle across 3-D terrain
          with height advantage, glyphs, and special powers — last army standing wins.
        </p>
        <div className="text-sm text-neutral-300">
          {state.players.length} player{state.players.length === 1 ? '' : 's'} seated (2-6){state.players.length < 2 ? ' — waiting for one more…' : ''}
        </div>

        {/* Edition toggle: Classic (original points) vs Modern (rebalanced) */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Card edition</div>
          <div className="flex gap-2">
            {([['modern', 'Modern'], ['classic', 'Classic']] as const).map(([e, label]) => {
              const active = cardEdition === e;
              return (
                <button
                  key={e}
                  onClick={() => isHost && onSetLobbyConfig({ edition: e })}
                  disabled={!isHost || disabled}
                  title={e === 'classic' ? 'Original 2004-era points for the cards that differ' : 'The rebalanced printing (default)'}
                  className={
                    'rounded-lg border-2 px-4 py-1.5 text-sm font-semibold transition ' +
                    (active ? 'border-amber-400 bg-amber-900/30 text-amber-200' : 'border-neutral-700 text-neutral-300 hover:border-neutral-500') +
                    (isHost ? '' : ' cursor-default opacity-90')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-neutral-500">
            {cardEdition === 'classic'
              ? 'The original values'
              : 'The rebalanced printing (default)'}
          </div>
        </div>

        {/* AI opponents (host, draft mode) — bots draft + play on their own. Add
            several to face a team of them, or assign one to your side. */}
        {isHost && lobbyMode === 'draft' && (
          <div className="flex flex-col items-center gap-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">AI opponents</div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {state.players.filter(p => p.bot).map(p => (
                <span key={p.seat} className="flex items-center gap-1 rounded-md border-2 border-fuchsia-700/60 bg-fuchsia-950/30 px-2 py-0.5 text-xs font-semibold text-fuchsia-200">
                  🤖 {p.username}
                  <button
                    onClick={() => onRemoveBot?.(p.seat)}
                    disabled={disabled}
                    className="ml-0.5 rounded px-0.5 text-fuchsia-400 transition hover:text-red-300 disabled:opacity-40"
                    title="Remove this AI"
                  >✕</button>
                </span>
              ))}
              {state.players.length < 6 && (
                <button
                  onClick={() => onAddBot?.()}
                  disabled={disabled}
                  className="rounded-md border-2 border-fuchsia-600 bg-fuchsia-900/30 px-3 py-1 text-xs font-bold text-fuchsia-200 transition hover:bg-fuchsia-800/50 disabled:opacity-40"
                >
                  + Add AI
                </button>
              )}
            </div>
            <div className="text-[11px] text-neutral-500">They draft an army and play their own turns. Set teams below to ally with one.</div>
          </div>
        )}

        {/* Point-budget presets (draft mode only) */}
        {lobbyMode === 'draft' && (
          <div className="flex flex-col items-center gap-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Point budget</div>
            {/* Type the army point budget (committed on Enter / blur). The engine
                accepts MIN..MAX; out-of-range input is clamped. */}
            <div className="flex items-center gap-2">
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
    const anyAffordable = d.pool.some(id => (effectiveCardDef(id, cardEdition)?.points ?? 0) <= myRemaining);
    const canPass = myTurnToPick && !disabled && !(myArmyEmpty && anyAffordable);

    // Pool sorted CHEAPEST → most expensive (user request).
    const sortedPool = [...HS_DRAFT_POOL].sort((a, b) => (effectiveCardDef(a, cardEdition)?.points ?? 0) - (effectiveCardDef(b, cardEdition)?.points ?? 0));

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
                  {HS_CARDS[id].name} <span className="tabular-nums text-amber-300/80">{effectiveCardDef(id, cardEdition)?.points ?? 0}</span>
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
        {/* Draft order — the players in the order the roll-off seated them (snake forward). */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-neutral-500">Draft order</span>
          {d.order.map((seat, i) => {
            const p = state.players.find(pl => pl.seat === seat);
            const isNow = d.turnSeat === seat;
            return (
              <span key={seat} className={'flex items-center gap-1 ' + (isNow ? 'font-bold' : 'opacity-80')} style={{ color: seatColor(seat) }}>
                <span className="tabular-nums text-neutral-500">{i + 1}.</span>
                {p?.username ?? `Seat ${seat + 1}`}
                {p?.bot && <span className="text-[9px] text-neutral-500">🤖</span>}
              </span>
            );
          })}
        </div>

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
        <div className="grid items-stretch gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
          {sortedPool.map(id => {
            const taken = !d.pool.includes(id);
            const affordable = (effectiveCardDef(id, cardEdition)?.points ?? 0) <= myRemaining;
            const clickable = myTurnToPick && !taken && affordable && !disabled;
            return (
              <DraftCard
                key={id}
                cardId={id}
                edition={cardEdition}
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
              <div
                key={e.seq}
                className={e.tag === 'activate' ? 'font-bold' : e.tag === 'roll' ? 'text-sky-300/80' : ''}
                style={e.seat != null ? { color: seatColor(e.seat) } : undefined}
              >{e.text}</div>
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
      {/* Board-scoped keyframes (no global stylesheet): the pulsing base-glow that
          marks a figure with actions left. */}
      <style>{`@keyframes hsBaseGlow { 0%,100% { opacity: 0.28; } 50% { opacity: 0.62; } } .hs-base-glow { animation: hsBaseGlow 1.4s ease-in-out infinite; }`}</style>
      {/* Dramatic dice-roll overlay (UI only). Keyed on seq so a superseding
          attack remounts it (cancelling the prior animation's timers). */}
      {rollAttack && (
        <DiceRollOverlay
          key={rollAttack.seq}
          attack={rollAttack}
          final={state.phase === 'finished'}
          onDismiss={() => { setRollAttack(null); setFrozenFigures([]); }}
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
        {/* Teams / standings (3+ players) — who's allied + each side's strength. */}
        <TeamsPanel state={state} seatColor={seatColor} />
        {/* (Glyphs roster moved onto the board — see the right-centered overlay there.) */}
        {/* Placement status — the interactive assignment lives below the board,
            directly above your army cards. */}
        {placement ? (
          <div className="[order:-2] rounded-lg border-2 border-amber-700 bg-neutral-900/70 px-3 py-2 text-center">
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
            {/* In-hand tray — lives here in the rail (not under the board) so the board owns the
                whole centre. Tap a figure, then a glowing start-zone hex. */}
            {me && !iPlacementReady && myHand.length > 0 && (
              <div className="mt-2 border-t border-neutral-800 pt-2 text-left">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">In hand — tap a figure, then a glowing hex</div>
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
                          'flex items-center gap-1 rounded-md border-2 px-1.5 py-0.5 text-[11px] font-semibold transition ' +
                          (picked ? 'border-amber-400 bg-amber-900/30 text-amber-200' : 'border-neutral-700 text-neutral-200 hover:border-neutral-500')
                        }
                      >
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold text-neutral-950" style={{ background: seatColor(me.seat) }}>
                          {def?.letter}{def?.type === 'squad' ? f?.index : ''}
                        </span>
                        <span className="max-w-[7rem] truncate">{f ? figureLabel(state, f) : id}</span>
                      </button>
                    );
                  })}
                </div>
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
          <div className="[order:-2] rounded-lg border-2 border-amber-700 bg-neutral-900/70 px-3 py-2 text-center">
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
              {/* Only LIVING seats place markers — an eliminated player is out and
                  must not show as "placing…" (the round never waits on them). */}
              {state.players
                .filter(p => p.playerId !== currentUserId && livingSeats(state).includes(p.seat))
                .map(p => (
                <div key={p.seat} className="flex items-center justify-between">
                  <span style={{ color: seatColor(p.seat) }}>{p.username}</span>
                  <span className={state.markersReady.includes(p.seat) ? 'text-emerald-400' : 'text-neutral-500'}>
                    {state.markersReady.includes(p.seat) ? 'ready ✓' : 'placing…'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : state.phase === 'finished' && !rollAttack ? (
          // Hold the win banner until the game-winning dice overlay has fully played
          // out (rollAttack clears on its dismiss, ≥4s after the killing roll) so the
          // result isn't spoiled mid-roll. On a reload of a finished game rollAttack
          // is already null, so it shows promptly.
          <div className="[order:-2] rounded-lg border-2 border-amber-400 bg-neutral-900/70 px-3 py-2 text-center text-sm font-bold text-amber-200">
            {state.winnerSeat == null && state.winnerTeam == null
              ? '🤝 Draw — no army left standing.'
              : `🏆 ${winnerLabel} wins the battle!`}
          </div>
        ) : (
          /* TURN ORDER — pinned to the top of the rail. Replaces the old separate
             "X's turn" banner AND initiative panel with ONE: a round/turn header
             plus the players ordered by initiative roll, the active one ringed
             (the border tints to the active seat's colour). */
          <div
            className="[order:-2] rounded-lg border-2 px-3 py-2"
            style={{ borderColor: seatColor(state.turnSeat ?? 0) }}
          >
            <div className="text-center text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {myTurn ? 'Your turn' : `${turnPlayer?.username ?? '…'}'s turn`} · Turn {state.turnNumber}/3
            </div>
            <TurnOrderSnake state={state} seatColor={seatColor} />
          </div>
        )}

        {/* (NOW ACTING card + its action controls are grouped together below —
            see the "special-power buttons" block, wrapped in one panel.) */}

        {/* (Initiative order moved into the turn-order panel at the top.) */}

        {/* (Last-attack dice moved into the LOG, under End turn.) */}

        {/* (Army cards render below the board — see the main column.) */}

        {/* (Figure facing/flip removed — HeroScape has no facing rules, so it was a button with no
            gameplay effect. A 2-hex figure reorients by MOVING.) */}

        {/* slice 8: Airborne Elite THE DROP — round start, before order markers.
            Roll a d20 (server) — on 13+ deploy all reserve Airborne onto chosen
            empty spaces (not adjacent to each other or any figure, not on glyphs). */}
        {(canDoDrop || dropPlacing) && !disabled && (
          <div className="rounded-lg border-2 border-orange-600 bg-neutral-900/70 px-3 py-2">
            <div className="text-sm font-bold text-orange-300">💂 The Drop — {dropReserveCount} Airborne Elite in reserve</div>
            {!dropPlacing ? (
              <button
                onClick={() => onTheDrop()}
                title="At round start, before order markers: roll a d20. Everyone sees the roll — on 13+ you then deploy all reserve Airborne Elite onto empty spaces not adjacent to each other or any figure (and not on glyphs)."
                className="mt-1 rounded-lg border-2 border-orange-600 px-3 py-1.5 text-sm font-semibold text-orange-300 transition hover:bg-orange-900/40"
              >
                🎲 Roll The Drop (d20, 13+)
              </button>
            ) : (
              <>
                <div className="mt-0.5 text-[11px] text-emerald-300">
                  Rolled 13+! Click {dropReserveCount} highlighted empty spaces — not adjacent to each other or any figure. ({dropPicks.length}/{dropReserveCount})
                </div>
                {dropLegalSet.size === 0 && (
                  <div className="mt-0.5 text-[11px] text-amber-300">
                    No empty space can take a landing right now — hold them in reserve and try again next round.
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    disabled={dropPicks.length !== dropReserveCount}
                    onClick={() => onResolveChoice({ kind: 'airborne_drop', placements: dropPicks })}
                    className="rounded-lg border-2 border-orange-500 px-3 py-1 text-sm font-bold text-orange-200 transition hover:bg-orange-900/50 disabled:opacity-40"
                  >
                    🪂 Deploy! ({dropPicks.length}/{dropReserveCount})
                  </button>
                  <button
                    onClick={() => setDropPicks([])}
                    disabled={dropPicks.length === 0}
                    className="rounded-lg border border-neutral-600 px-3 py-1 text-sm font-semibold text-neutral-300 transition hover:border-neutral-400 disabled:opacity-40"
                  >
                    Clear
                  </button>
                  {/* "you MAY place all 4" — declining (deploy none) is always legal and
                      is the only way out when no full, mutually-non-adjacent squad fits. */}
                  <button
                    onClick={() => { setDropPicks([]); onResolveChoice({ kind: 'airborne_drop', placements: [] }); }}
                    title="Keep the Airborne Elite in reserve this round (you can roll The Drop again next round)."
                    className="rounded-lg border border-neutral-600 px-3 py-1 text-sm font-semibold text-neutral-300 transition hover:border-neutral-400"
                  >
                    Hold in reserve
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {/* NOW ACTING — the active unit's card AND its action controls in ONE
            panel, so its powers (Mind Shackle, Acid Breath, …) live ON the card
            instead of as separate panels below. */}
        {state.phase === 'playing' && state.subPhase === 'turns' && activeCard && activeCardDef && (
          <div className="[order:-1] shrink-0 rounded-lg border border-neutral-700 bg-neutral-900/60 p-2">
            <div className="mb-1.5 flex items-center justify-between px-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Now acting</span>
              <span className="text-[11px] font-semibold" style={{ color: seatColor(state.turnSeat ?? 0) }}>
                {turnPlayer?.username ?? ''}
              </span>
            </div>
            <HybridCard cardId={activeCard.cardId} fit powerAvailable={activePowerAvailable} onPowerTap={canAct && activeCardHasTapPower ? onCardPower : undefined} />
            {canAct && activeCardHasTapPower && (
              <div className="mt-1 text-center text-[10px] text-violet-300/80">
                tap the highlighted power on the card to use it
              </div>
            )}
            {/* the active unit's action controls — its powers live here, on the card */}
            <div className="mt-2 flex flex-col gap-2">
        {/* Powers are activated by TAPPING them on the card above. Below: an inline target
            picker (Mind Shackle / Chomp when more than one enemy is adjacent), a short reason
            if a tapped power isn't usable yet, and a targeting strip for the board-aimed
            powers (Fire Line direction / Grapple hex). */}
        {powerHint && (
          <div className="rounded-lg border border-amber-600/70 bg-amber-950/40 px-3 py-1.5 text-center text-xs font-medium text-amber-200">
            {powerHint}
          </div>
        )}
        {(fireLineMode || grappleMode || throwAim || explosionMode || carryAim) && (
          <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-amber-500 bg-amber-950/50 px-3 py-2 text-sm font-semibold text-amber-200">
            <span>
              {fireLineMode && '🔥 Fire Line — click a direction; highlighted figures will be hit'}
              {grappleMode && '🪝 Grapple Gun — click a hex (1 space, climb anywhere)'}
              {throwAim && `🤾 Throw ${figName(throwAim.targetId)} — click a highlighted landing hex`}
              {explosionMode && '💥 Explosion — click a highlighted enemy (Range 7); the blast hits its neighbours'}
              {carryAim && (!carryAim.pass
                ? '🪽 Carry — click a highlighted friendly figure to pick up'
                : !carryAim.dest
                  ? `🪽 Carry ${figName(carryAim.pass)} — click where Theracus flies`
                  : `🪽 Carry — click an empty space next to Theracus to set ${figName(carryAim.pass)} down`)}
            </span>
            <button
              type="button"
              onClick={() => { setFireLineMode(false); setGrappleMode(false); setThrowAim(null); setExplosionMode(false); setCarryAim(null); }}
              className="shrink-0 rounded border border-amber-400 px-2 py-0.5 text-xs text-amber-100 hover:bg-amber-900/50"
            >
              Cancel
            </button>
          </div>
        )}
        {/* slice 8b: Big-Hero special-power control panel — dropdown pickers +
            a fire button per available power (the engine re-validates each). */}
        {!!anyBigHeroPower && !disabled && (
          <div
            ref={powerPanelRef}
            className={
              'w-full scroll-mt-2 rounded-lg border-2 bg-neutral-900/70 px-3 py-2 transition ' +
              (powerFlash ? 'border-violet-300 ring-2 ring-violet-400/70' : 'border-violet-700/70')
            }
          >
            <div className="mb-1 text-sm font-bold text-violet-300">⚡ {activeCardDef?.name} — Special Power</div>
            <div className="flex flex-col gap-2 text-xs text-neutral-200">
              {/* Nilfheim — Ice Shard Breath (≤3 shots) — tap "aim", then tap a highlighted enemy */}
              {iceList.length > 0 && bhHeroId && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sky-300">❄ Ice Shard (R5 A4, ≤3×):</span>
                  <button
                    onClick={() => setBhAim(bhAim?.kind === 'ice' ? null : { kind: 'ice' })}
                    className={'rounded border px-2 py-0.5 font-semibold ' + (bhAim?.kind === 'ice' ? 'border-sky-300 bg-sky-900/60 text-sky-100' : 'border-sky-600 text-sky-300 hover:bg-sky-900/40')}
                  >
                    {bhAim?.kind === 'ice' ? 'tap a target…' : 'aim →'}
                  </button>
                </div>
              )}
              {/* Major Q9 — Queglix Gun (9-die pool) — pick how many dice, then tap a highlighted enemy */}
              {qList.length > 0 && bhHeroId && (() => {
                const maxDice = Math.min(3, qLeft) as 1 | 2 | 3;
                const dice = (bhAim?.kind === 'queglix' ? bhAim.dice : (bh.qDice && bh.qDice <= maxDice ? bh.qDice : maxDice)) as 1 | 2 | 3;
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-amber-300">🔫 Queglix ({qLeft} dice left):</span>
                    <select value={dice} onChange={e => { const d = Number(e.target.value) as 1 | 2 | 3; patchBh({ qDice: d }); if (bhAim?.kind === 'queglix') setBhAim({ kind: 'queglix', dice: d }); }} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {[1, 2, 3].filter(n => n <= maxDice).map(n => <option key={n} value={n}>{n} {n === 1 ? 'die' : 'dice'}</option>)}
                    </select>
                    <button
                      onClick={() => setBhAim(bhAim?.kind === 'queglix' ? null : { kind: 'queglix', dice })}
                      className={'rounded border px-2 py-0.5 font-semibold ' + (bhAim?.kind === 'queglix' ? 'border-amber-300 bg-amber-900/60 text-amber-100' : 'border-amber-600 text-amber-300 hover:bg-amber-900/40')}
                    >
                      {bhAim?.kind === 'queglix' ? 'tap a target…' : 'aim →'}
                    </button>
                  </div>
                );
              })()}
              {/* Jotun — Wild Swing (splash) — aim, tap an adjacent enemy to preview the blast, confirm */}
              {wildList.length > 0 && bhHeroId && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-red-300">🪓 Wild Swing (R1 A4, splash):</span>
                  {bhAim?.kind === 'wild' && bhAim.target ? (
                    <>
                      <span className="text-[11px] text-orange-200">blast hits {splashIds.size} (orange)</span>
                      <button onClick={() => { onWildSwing(bhHeroId, bhAim.target!); setBhAim(null); }} className="rounded border border-orange-500 px-2 py-0.5 font-semibold text-orange-200 hover:bg-orange-900/40">💥 Swing</button>
                      <button onClick={() => setBhAim(null)} className="rounded border border-neutral-600 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800">Cancel</button>
                    </>
                  ) : (
                    <button
                      onClick={() => setBhAim(bhAim?.kind === 'wild' ? null : { kind: 'wild' })}
                      className={'rounded border px-2 py-0.5 font-semibold ' + (bhAim?.kind === 'wild' ? 'border-red-300 bg-red-900/60 text-red-100' : 'border-red-600 text-red-300 hover:bg-red-900/40')}
                    >
                      {bhAim?.kind === 'wild' ? 'tap a target…' : 'aim →'}
                    </button>
                  )}
                </div>
              )}
              {/* Braxas — Poisonous Acid Breath (≤3 small/medium). One-click flow: tap the
                  ability itself to start picking (no separate "aim" step), tap up to 3 figure
                  bases on the board, then "Breathe" to fire. */}
              {acidList.length > 0 && bhHeroId && (
                <div className="flex flex-wrap items-center gap-2">
                  {bhAim?.kind === 'acid' ? (
                    <>
                      <span className="font-semibold text-lime-300">☣ Acid Breath</span>
                      <span className="text-[11px] text-orange-200">{bhAim.picks.length}/3 picked — tap figure bases (orange)</span>
                      <button disabled={bhAim.picks.length === 0} onClick={() => { onAcidBreath(bhHeroId, bhAim.picks); setBhAim(null); }} className="rounded border border-lime-600 px-2 py-0.5 font-semibold text-lime-300 hover:bg-lime-900/40 disabled:opacity-40">☣ Breathe ({bhAim.picks.length})</button>
                      <button onClick={() => setBhAim(null)} className="rounded border border-neutral-600 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setBhAim({ kind: 'acid', picks: [] })} className="rounded border border-lime-600 px-2 py-0.5 font-semibold text-lime-300 hover:bg-lime-900/40">☣ Acid Breath (pick ≤3)</button>
                  )}
                </div>
              )}
              {/* Jotun — Throw 14 (reposition + damage) */}
              {throwList.length > 0 && bhHeroId && (() => {
                const tgt = bh.throwTgt && throwList.includes(bh.throwTgt) ? bh.throwTgt : throwList[0];
                const lands = throwLandingHexes(state, bhHeroId, tgt);
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-orange-300">🤾 Throw (d20 14+):</span>
                    <select value={tgt} onChange={e => patchBh({ throwTgt: e.target.value })} className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5">
                      {throwList.map(id => <option key={id} value={id}>{figName(id)}</option>)}
                    </select>
                    <button
                      disabled={lands.length === 0}
                      onClick={() => setThrowAim({ targetId: tgt })}
                      title="Then click where to throw the figure — any highlighted empty space within 4, in clear sight."
                      className="rounded border border-orange-600 px-2 py-0.5 font-semibold text-orange-300 hover:bg-orange-900/40 disabled:opacity-40"
                    >
                      {lands.length === 0 ? 'no landing in range' : 'pick a landing →'}
                    </button>
                  </div>
                );
              })()}
              {/* Theracus — Carry (pick passenger, then his destination, then a landing) */}
              {/* CARRY — a board-click sequence, not dropdowns: arm it here, then click a passenger,
                  Theracus's destination, and the empty landing space (each step highlighted). */}
              {carryList.length > 0 && bhHeroId && !carryAim && (
                <button
                  onClick={() => setCarryAim({})}
                  className="rounded border border-emerald-600 px-2 py-0.5 text-left font-semibold text-emerald-300 hover:bg-emerald-900/40"
                >
                  🪽 Carry a friendly figure — pick it, fly, then set it down
                </button>
              )}
              {carryAim && (
                <div className="text-[11px] text-emerald-300/90">
                  🪽 Carrying… {!carryAim.pass ? 'click a highlighted friendly figure' : !carryAim.dest ? 'click where Theracus flies' : 'click an empty space to set it down'} (or Cancel above)
                </div>
              )}
            </div>
          </div>
        )}
        {/* slice 8: Grenade throw sequence — pick a Range-5 figure per Elite. */}
        {grenadeChoice && (
          <div className="rounded-lg border-2 border-orange-500 bg-neutral-900/70 px-3 py-2">
            <div className="text-sm font-bold text-orange-300">💣 Grenade — {grenadeChoice.throwers.length} Elite{grenadeChoice.throwers.length === 1 ? '' : 's'} left to throw</div>
            {grenadeAim ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-orange-200">Blast hits {grenadeSplashIds.size} (orange) — tap it again or:</span>
                <button onClick={() => { onGrenadeThrow(grenadeAim); setGrenadeAim(null); }} className="rounded border border-orange-500 px-2 py-0.5 font-semibold text-orange-200 hover:bg-orange-900/40">💥 Throw</button>
                <button onClick={() => setGrenadeAim(null)} className="rounded border border-neutral-600 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800">Cancel</button>
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] text-neutral-400">
                Tap a highlighted figure within Range 5 to aim — you’ll see the blast (it + neighbours) before throwing.
              </div>
            )}
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

        {/* Glyph of Erland — Summoning (board-tap: figure → empty adjacent space) */}
        {erlandChoice && (
          <div className="rounded-lg border-2 border-fuchsia-500 bg-neutral-900/80 px-3 py-2">
            <div className="text-sm font-bold text-fuchsia-300">✨ Glyph of Erland — Summoning</div>
            <div className="mt-0.5 text-[11px] text-neutral-300">
              {erlandPick
                ? 'Now tap a highlighted empty space (beside the figure on the glyph) to place it.'
                : "Tap any highlighted figure — yours or an opponent's — then an empty space beside the figure on the glyph."}
            </div>
            {erlandPick && (
              <button onClick={() => setErlandPick(null)} className="mt-1 rounded border border-neutral-600 px-2 py-0.5 text-[11px] text-neutral-300 transition hover:border-neutral-400">
                Pick a different figure
              </button>
            )}
          </div>
        )}

        {/* Glyph of Nilrend — Negation (tap a highlighted figure, or a card button) */}
        {nilrendChoice && (
          <div className="rounded-lg border-2 border-violet-500 bg-neutral-900/80 px-3 py-2">
            <div className="text-sm font-bold text-violet-300">🚫 Glyph of Nilrend — rolled {nilrendChoice.d20}</div>
            <div className="mt-0.5 text-[11px] text-neutral-300">
              Negate {nilrendChoice.d20 === 1 ? 'one of YOUR' : "an opponent's"} unique cards for the rest of the game — it drops to base stats.
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {[...nilrendCardSet].map(uid => {
                const c = state.cards.find(x => x.uid === uid);
                const def = HS_CARDS[c?.cardId ?? ''];
                const ownerName = state.players.find(p => p.seat === c?.ownerSeat)?.username ?? '';
                return (
                  <button
                    key={uid}
                    onClick={() => onResolveChoice({ kind: 'glyph_nilrend', cardUid: uid })}
                    disabled={disabled}
                    className="flex items-center justify-between rounded-md border border-violet-700 px-2 py-1 text-left text-xs text-violet-100 transition hover:border-violet-400 hover:bg-violet-900/30 disabled:opacity-40"
                  >
                    <span className="font-semibold">{def?.name ?? uid}</span>
                    <span className="text-[10px] text-neutral-400">{ownerName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Glyph of Wannok — controller names an opponent (2+) */}
        {wannokChoice && me && (
          <div className="rounded-lg border-2 border-rose-500 bg-neutral-900/80 px-3 py-2">
            <div className="text-sm font-bold text-rose-300">☠️ Glyph of Wannok — rolled {wannokChoice.d20}</div>
            <div className="mt-0.5 text-[11px] text-neutral-300">Choose an opponent — they must wound one of their own figures.</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {state.players
                .filter(p => seatTeam(p.seat) !== seatTeam(me.seat) && state.figures.some(f => f.at != null && f.ownerSeat === p.seat))
                .map(p => (
                  <button
                    key={p.seat}
                    onClick={() => onResolveChoice({ kind: 'glyph_wannok', opponentSeat: p.seat })}
                    disabled={disabled}
                    className="rounded-md border border-rose-700 px-2 py-1 text-xs text-rose-100 transition hover:border-rose-400 hover:bg-rose-900/30 disabled:opacity-40"
                  >
                    {p.username}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Glyph of Wannok — the cursed opponent taps their own figure to wound */}
        {wannokVictimChoice && (
          <div className="rounded-lg border-2 border-rose-500 bg-neutral-900/80 px-3 py-2">
            <div className="text-sm font-bold text-rose-300">☠️ Glyph of Wannok — choose your sacrifice</div>
            <div className="mt-0.5 text-[11px] text-neutral-300">The curse falls on you — tap one of your highlighted figures to take a wound.</div>
          </div>
        )}

        {/* Glyph of Sturla — a figure rolled a 20 and rises; its owner taps a free start-zone hex. */}
        {sturlaPlaceChoice && (() => {
          const riser = state.figures.find(f => f.id === sturlaPlaceChoice.figureId);
          const more = sturlaPlaceChoice.remaining.length;
          return (
            <div className="rounded-lg border-2 border-emerald-500 bg-neutral-900/80 px-3 py-2">
              <div className="text-sm font-bold text-emerald-300">✟ Glyph of Sturla — Resurrection</div>
              <div className="mt-0.5 text-[11px] text-neutral-300">
                {riser ? <><span className="font-semibold text-emerald-200">{figureLabel(state, riser)}</span> rises! </> : 'A figure rises! '}
                Tap a glowing hex in your start zone to set it down (fresh, no wounds).
                {more > 0 && <span className="text-neutral-400"> {more} more to place after this.</span>}
              </div>
            </div>
          );
        })()}

        {/* UNDO MOVE — repeatable full rewind. Shown only while moves remain on the
            undo stack this turn and nothing has been committed (no attack yet). */}
        {myTurn && !pending && !state.movementEnded && state.turnAttacks.length === 0 && (
          <div className="flex gap-2">
            {(state.moveHistory?.length ?? 0) > 0 && (
              <button
                onClick={() => { onUndoMove(); setSelectedId(null); }}
                disabled={disabled}
                className="flex-1 rounded-lg border-2 border-sky-600 bg-neutral-950/85 px-3 py-2 text-sm font-semibold text-sky-300 backdrop-blur-sm transition hover:bg-sky-900/50 disabled:opacity-40"
                title="Take back your last move (until you end your move)"
              >
                ↶ Undo move ({state.moveHistory!.length})
              </button>
            )}
            <button
              onClick={() => { onEndMove(); setSelectedId(null); }}
              disabled={disabled}
              className="flex-1 rounded-lg border-2 border-emerald-600 bg-neutral-950/85 px-3 py-2 text-sm font-semibold text-emerald-300 backdrop-blur-sm transition hover:bg-emerald-900/50 disabled:opacity-40"
              title="Finish moving and switch to attacking — no figure can move again this turn"
            >
              ✓ End move → attack
            </button>
          </div>
        )}
        {/* Attack-phase cue: after End move, before any attack, so the player knows taps now ATTACK. */}
        {myTurn && !pending && state.movementEnded && state.turnAttacks.length === 0 && (
          <div className="rounded-lg border border-rose-700/60 bg-rose-950/30 px-3 py-2 text-center text-xs font-semibold text-rose-300">
            ⚔ Attack phase — tap a glowing figure’s target, or End turn
          </div>
        )}

        {/* End turn — pinned to the rail bottom on lg so the (tall) Now-acting
            card above can never push the primary action out of reach. */}
        {myTurn && !pending && (
          <button
            onClick={() => { onEndTurn(); setSelectedId(null); }}
            disabled={disabled}
            className="rounded-lg border-2 border-amber-600 bg-neutral-950/85 px-4 py-2 text-sm font-semibold text-amber-300 backdrop-blur-sm transition hover:bg-amber-900/50 disabled:opacity-40"
          >
            End turn ▶
          </button>
        )}

        {/* LOG — under End turn, collapsed by default. Folds in the LAST ATTACK
            dice (its standalone panel was removed) above the rolling text log. */}
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setLogOpen(o => !o)}
            title={logOpen ? 'Hide the battle log' : 'Show the battle log'}
            className="flex shrink-0 items-center gap-1 self-start rounded border border-neutral-700 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 transition hover:border-neutral-500"
          >
            📜 {logOpen ? 'Battle log ✕' : 'Log'}
          </button>
          {logOpen && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[11px] leading-relaxed text-neutral-400">
              {state.lastAttack && (
                <div className="mb-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-2 py-1.5 text-neutral-200">
                  <div className="mb-1 font-semibold uppercase tracking-wider text-neutral-400">Last attack</div>
                  <div className="mb-1">{state.lastAttack.attackerLabel} → {state.lastAttack.targetLabel}</div>
                  {state.lastAttack.breakdown && state.lastAttack.breakdown.length > 0 && (
                    <div className="mb-1 text-[10px] font-semibold text-amber-300">{state.lastAttack.breakdown.join('  ·  ')}</div>
                  )}
                  {state.lastAttack.d20Rolls && state.lastAttack.d20Rolls.length > 0 ? (
                    // A d20-roll special (Acid Breath …): show each figure's ROLL + outcome, not skulls/shields.
                    <div className="flex flex-col gap-0.5">
                      {state.lastAttack.d20Rolls.map((r, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className={'inline-flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold tabular-nums ' + (r.destroyed ? 'border-red-400 text-red-300' : 'border-neutral-500 text-neutral-200')}>{r.d20}</span>
                          <span className="text-neutral-300">{r.label}</span>
                          <span className="text-neutral-500">(needs {r.need}+)</span>
                          <span className={r.destroyed ? 'font-bold text-red-400' : 'text-neutral-500'}>{r.destroyed ? '→ destroyed!' : '→ survives'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                  <>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-orange-300">⚔</span>
                    {state.lastAttack.attackRoll.map((f, i) => <DieFace key={i} face={f} />)}
                    <span className="ml-1 font-bold text-orange-300">{state.lastAttack.skulls}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-sky-300">🛡</span>
                    {state.lastAttack.defenseRoll.map((f, i) => <DieFace key={i} face={f} />)}
                    <span className="ml-1 font-bold text-sky-300">{state.lastAttack.shields}</span>
                  </div>
                  <div className={`mt-1 font-semibold ${state.lastAttack.destroyed ? 'text-red-400' : state.lastAttack.wounds > 0 ? 'text-orange-300' : 'text-neutral-400'}`}>
                    {state.lastAttack.destroyed
                      ? `${state.lastAttack.targetLabel} is destroyed!`
                      : state.lastAttack.wounds > 0
                        ? `${state.lastAttack.wounds} wound${state.lastAttack.wounds === 1 ? '' : 's'} inflicted.`
                        : state.lastAttack.skulls > state.lastAttack.shields
                          ? 'Stealth Dodge — all damage blocked!'
                          : 'Attack blocked.'}
                  </div>
                  </>
                  )}
                  {state.lastAttack.counterWounds != null && state.lastAttack.counterWounds > 0 && (
                    <div className="mt-1 font-semibold text-fuchsia-300">⚔ Counter Strike — {state.lastAttack.targetLabel} reflects {state.lastAttack.counterWounds} wound{state.lastAttack.counterWounds === 1 ? '' : 's'} onto {state.lastAttack.attackerLabel}!</div>
                  )}
                </div>
              )}
              {state.log.slice(-40).reverse().map(e => (
                <div
                  key={e.seq}
                  className={e.tag === 'win' ? 'font-bold text-amber-300' : e.tag === 'activate' ? 'mt-1 font-bold' : e.tag === 'attack' ? 'text-red-300/80' : e.tag === 'fall' ? 'text-orange-300/90' : ''}
                  style={e.seat != null ? { color: seatColor(e.seat) } : undefined}
                >{e.text}</div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* CENTER — opponent army cards (top), board, my army cards (bottom). The
          board is already oriented so my start zone is at the bottom, so my cards
          below + the enemy's above put each player's cards on their figures' side.
          On lg+ this is a flex COLUMN whose middle (the board) flexes to fill all
          the space the two compact card strips leave — and the board does NOT
          scroll (the strips are shrink-0; only the board box flexes). */}
      <div className="relative flex min-w-0 flex-1 flex-col gap-2 lg:order-2 lg:min-h-0">
        {/* Opponent army rosters. On lg they OVERLAY the top of the board (out of
            the column flow) so the board owns the whole centre — the wrapper is
            click-through except over the panels themselves. On mobile they stack
            above the board as before. */}
        {state.players.some(p => !me || p.seat !== me.seat) && (
          // On lg+ each opponent's panel is pinned to its SEAT anchor around the board
          // (panelSlotAnchor — you are bottom-left, others fan out by seat); on mobile they
          // stack at the top in normal flow (lg:contents drops the wrapper box on desktop).
          <div className="flex flex-col items-start gap-1 lg:contents">
            {state.players
              .filter(p => !me || p.seat !== me.seat)
              .sort((a, b) => a.seat - b.seat)
              .map(p => (
                <div key={p.seat} className={'lg:pointer-events-none lg:absolute lg:z-20 lg:p-1 ' + panelSlotAnchor(p.seat)}>
                  <div className="lg:pointer-events-auto lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:overscroll-contain">{renderArmyRow(p.seat)}</div>
                </div>
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
        {/* Glyphs roster — overlaid on the RIGHT edge of the board, vertically centered,
            so it reads as a battlefield HUD instead of living in the side rail. Hidden as
            "?" until revealed. pointer-events-none so it never eats a board tap/drag;
            renders only when the map actually has glyphs. */}
        {state.glyphs && state.glyphs.length > 0 && (
          <div className="pointer-events-none absolute right-2 top-1/2 z-20 -translate-y-1/2">
            <GlyphsPanel glyphs={state.glyphs} />
          </div>
        )}
        {/* GLYPH FLASH — a transient banner so a triggered glyph (esp. a one-time one that vanishes)
            is never silent. Auto-dismisses; click to close early. z-30 sits above the seat panels. */}
        {glyphFlash && !ceremony && (
          <div key={glyphFlash.nonce} className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-2">
            <button
              type="button"
              onClick={() => setGlyphFlash(null)}
              className="pointer-events-auto max-w-md rounded-lg border border-amber-500/60 bg-neutral-900/95 px-3 py-2 text-left text-[11px] leading-snug text-amber-100 shadow-lg backdrop-blur transition hover:bg-neutral-900"
            >
              <div className="mb-0.5 flex items-center gap-1 text-amber-300">
                <span className="text-sm leading-none">⬡</span>
                <span className="font-bold uppercase tracking-wide">Glyph triggered</span>
              </div>
              {glyphFlash.lines.map((t, i) => <div key={i}>{t}</div>)}
            </button>
          </div>
        )}
        {/* ROLL CEREMONY — the shared d20 ritual (Mitonsoul curse / Sturla resurrection). EVERY
            player sees this panel and watches; only the current roller picks a figure + rolls. */}
        {ceremony && (() => {
          const isCurse = ceremony.mode === 'curse';
          const up = ceremony.queue[0]?.figureIds ?? [];
          const rollerName = state.players.find(p => p.seat === ceremony.seat)?.username ?? 'Player';
          const rollerColor = seatColor(ceremony.seat);
          const done = ceremony.results.length;
          const total = done + ceremony.queue.reduce((n, q) => n + q.figureIds.length, 0);
          const last = ceremony.results[ceremony.results.length - 1];
          const labelOf = (fid: string) => { const f = state.figures.find(x => x.id === fid); return f ? figureLabel(state, f) : fid; };
          return (
            <div className="pointer-events-none absolute inset-x-0 top-2 z-40 flex justify-center px-2">
              <div className={'pointer-events-auto w-full max-w-xs rounded-xl border-2 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur ' + (isCurse ? 'border-rose-500/80' : 'border-emerald-500/80')}>
                <div className={'flex items-center gap-1.5 text-sm font-bold ' + (isCurse ? 'text-rose-300' : 'text-emerald-300')}>
                  <span className="text-base leading-none">{isCurse ? '☠️' : '✟'}</span>
                  {isCurse ? 'Glyph of Mitonsoul — Massive Curse' : 'Glyph of Sturla — Resurrection'}
                </div>
                <div className="mt-0.5 text-[10px] text-neutral-400">
                  {isCurse ? 'Every figure rolls a d20 — a 1 destroys it.' : 'Every fallen rolls a d20 — a 20 raises it.'} <span className="text-neutral-500">({done}/{total})</span>
                </div>
                {/* Who's up */}
                <div className="mt-2 text-[11px] text-neutral-300">
                  <span className="font-semibold" style={{ color: rollerColor }}>{rollerName}</span>
                  {ceremonyIsMine ? ' — pick one of your figures, then roll:' : ' is rolling…'}
                </div>
                {/* Figure list — tap to select (shared highlight), then Roll */}
                <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                  {up.map(fid => {
                    const sel = ceremony.selectedFigureId === fid;
                    return (
                      <button
                        key={fid}
                        type="button"
                        disabled={!ceremonyIsMine || disabled}
                        onClick={() => onResolveChoice({ kind: 'roll_ceremony_select', figureId: fid })}
                        className={'rounded-md border px-2 py-1 text-[11px] font-medium transition disabled:cursor-default ' +
                          (sel
                            ? (isCurse ? 'border-rose-400 bg-rose-900/50 text-rose-100 ring-2 ring-rose-400' : 'border-emerald-400 bg-emerald-900/50 text-emerald-100 ring-2 ring-emerald-400')
                            : 'border-neutral-700 bg-neutral-900/70 text-neutral-200 enabled:hover:border-neutral-500')}
                      >
                        {labelOf(fid)}
                      </button>
                    );
                  })}
                </div>
                {/* Roll button (the current roller only) */}
                {ceremonyIsMine ? (
                  <button
                    type="button"
                    disabled={!ceremony.selectedFigureId || disabled}
                    onClick={() => onResolveChoice({ kind: 'roll_ceremony_roll' })}
                    className={'mt-2 w-full rounded-lg border-2 px-3 py-2 text-sm font-bold transition disabled:opacity-40 ' + (isCurse ? 'border-rose-500 bg-rose-950/70 text-rose-200 enabled:hover:bg-rose-900/60' : 'border-emerald-500 bg-emerald-950/70 text-emerald-200 enabled:hover:bg-emerald-900/60')}
                  >
                    🎲 {ceremony.selectedFigureId ? `Roll for ${labelOf(ceremony.selectedFigureId)}` : 'Select a figure first'}
                  </button>
                ) : (
                  <div className="mt-2 rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-center text-[11px] text-neutral-400">
                    {ceremony.selectedFigureId ? <>Selected <span className="font-semibold text-neutral-200">{labelOf(ceremony.selectedFigureId)}</span> — waiting for the roll…</> : 'Waiting for a pick…'}
                  </div>
                )}
                {/* The latest result */}
                {last && (
                  <div className={'mt-2 flex items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold ' +
                    (last.outcome === 'died' ? 'bg-rose-900/40 text-rose-200' : last.outcome === 'rose' ? 'bg-emerald-900/40 text-emerald-200' : 'bg-neutral-800/60 text-neutral-300')}>
                    <span className={'inline-flex h-6 w-6 items-center justify-center rounded-md border text-sm tabular-nums ' + (last.d20 === 1 ? 'border-rose-400 text-rose-200' : last.d20 === 20 ? 'border-emerald-400 text-emerald-200' : 'border-neutral-500 text-neutral-200')}>{last.d20}</span>
                    <span>{labelOf(last.figureId)} — {last.outcome === 'died' ? 'DESTROYED!' : last.outcome === 'rose' ? 'RISES!' : 'safe'}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {can3D ? (
          <HeroBoard3D
            state={boardState}
            onHexClick={clickHex}
            selectedId={selectedId}
            moveHexes={carryDestSet ?? (grappleMode ? destinations : safeMoveHexes)}
            dangerHexes={disengageHexes}
            shootHexes={shootRange}
            shootBlockedHexes={shootBlocked}
            climbHexes={grappleMode ? grappleHexes : undefined}
            targetIds={targets}
            powerTargetIds={new Set([...shackleTargets, ...chompTargetSet, ...grenadeTargetSet, ...fireLineVictims, ...explosionTargetSet, ...iceList, ...qList, ...wildList, ...acidList, ...throwList, ...(carryPassSet ?? []), ...choiceFigIds])}
            actionableIds={glowIds}
            auraIds={auraIds}
            splashIds={splashIds}
            viewerStartHexes={me ? startZones[me.seat] : undefined}
            viewerSeat={me?.seat}
            placeHexes={placeHexes}
            dropHexes={sturlaPlaceChoice ? sturlaPlaceSet : erlandChoice && erlandPick ? erlandDestSet : carryLandSet ?? (throwAim && bhHeroId ? new Set(throwLandingHexes(state, bhHeroId, throwAim.targetId)) : dropLegalSet)}
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
            const isSturlaPlace = sturlaPlaceChoice != null && sturlaPlaceSet.has(key); // Sturla resurrection drop
            const isDest = destinations.has(key) || isPlaceHex || isSturlaPlace;
            const isFireHex = fireLineMode && fireLineDirs.has(key); // slice 8 fire-line target space
            const isCloneOpt = cloneOptions.has(key);
            const isDropPick = !!dropPlacing && dropPicks.includes(key); // slice 8 chosen Drop landing
            const isDropLegal = !!dropPlacing && !isDropPick && dropLegalSet.has(key); // legal Drop landing
            const drawColumn = c.terrain !== 'water' && c.height > 0; // water = flat top
            const colors = isoTileColors(c.terrain, c.height, isDest);
            const topFill = isDropPick ? '#7c2d12' : isCloneOpt ? '#0e4f6e' : colors.top;
            const topStroke = isDropPick ? '#fb923c' : isDropLegal ? '#fdba74' : isFireHex ? '#fb923c' : isCloneOpt ? '#22d3ee' : isDest ? '#34d399' : colors.stroke;
            const startZoneSeat = Object.entries(startZones).find(([, keys]) => keys.includes(key))?.[0];
            const fig = figureAt(key); // ANCHOR figure (drawn once, here)
            const occupied = !!occupantAt(key); // either hex of a 2-hex figure
            const clickable = canAct || isCloneOpt || isSturlaPlace || (!!dropPlacing && (isDropLegal || isDropPick)) || (canPlace && (isPlaceHex || occupied));

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
                  const revealed = glyph.faceUp; // hidden (face-down) until a figure stops on it
                  const badge = revealed ? (GLYPH_BADGE[def.letter] ?? GLYPH_BADGE.B) : { bg: '#7f1d1d', ring: '#fca5a5' };
                  const lit = occupied; // occupied ⇒ already revealed (stopping reveals it)
                  const gx = occupied ? ctr.x - HEX * 0.42 : ctr.x;
                  const gy = occupied ? ctr.y + HEX * 0.16 : ctr.y;
                  const gr = occupied ? HEX * 0.22 : HEX * 0.3;
                  return (
                    <g onClick={() => clickHex(key)} style={{ pointerEvents: occupied ? 'none' : undefined }} className={canAct && !occupied ? 'cursor-pointer' : ''}>
                      <title>{revealed ? `${def.name}${lit ? ' (active)' : ''} — ${def.effect}` : 'Unknown glyph — step a figure onto it to reveal.'}</title>
                      <circle cx={gx} cy={gy} r={gr} fill={badge.bg} stroke={lit ? badge.ring : (revealed ? '#0a0a0a' : badge.ring)} strokeWidth={lit ? 2.5 : 1.5} opacity={lit ? 1 : revealed ? 0.6 : 0.8} />
                      <text x={gx} y={gy + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={gr * 1.1} fontWeight={900} fill="#fafafa" opacity={lit ? 1 : 0.85} style={{ userSelect: 'none', pointerEvents: 'none' }}>
                        {revealed ? def.letter : '?'}
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
                    {/* base GLOW — a soft, pulsing aura under the base while this
                        figure can still act (green=move left, amber=attack left).
                        It vanishes the instant the figure is 'done' (ring=null), so
                        a finished figure's base reads dull. Drawn before the crisp
                        ring so it sits behind it and the standee. */}
                    {ring && (
                      <ellipse
                        cx={aCx} cy={aCy} rx={HEX * 0.62 + baseSpan} ry={HEX * 0.38}
                        fill={ring} className="hs-base-glow"
                        style={{ filter: 'blur(4px)', pointerEvents: 'none' }}
                      />
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

        {/* (The placement in-hand tray now lives in the RIGHT RAIL's Deploy panel so the
            board owns the whole centre — see the deploy section above.) */}

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
        {/* My army strip — in normal play it OVERLAYS the bottom of the board (lg)
            to save vertical space; on mobile it sits below. But during PLACEMENT the
            in-hand tray already sits at the column bottom, so the overlay collided
            with it (chips printed over the cards). During placement keep the strip in
            NORMAL FLOW so it stacks cleanly below the tray. */}
        {me && (
          // Always pinned BOTTOM-LEFT (slot-0 anchor) as an OVERLAY — in placement too, now that the
          // in-hand tray moved to the rail — so a player panel never pushes/shrinks the board.
          <div className="flex flex-col items-start gap-1 lg:pointer-events-none lg:absolute lg:bottom-2 lg:left-2 lg:z-20">
            <div className="lg:pointer-events-auto lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:overscroll-contain">{renderArmyRow(me.seat)}</div>
          </div>
        )}
      </div>

      {/* (Battle log moved into the right rail, under End turn.) */}
    </div>
  );
}
