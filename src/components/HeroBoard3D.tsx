'use client';
// HeroScape 3D board (React Three Fiber). Real WebGL: orbit/tilt/zoom, hex-prism
// terrain with elevation + water, thin seam lines between tiles, height-scaled
// photo standees on owner bases, and FULL click interaction (Phase 2).
//
// Interaction reuses the 2D board's brain: every tile AND figure routes its click
// back through the SAME `clickHex(key)` handler the SVG board uses, so select /
// move / attack / place / Drop all work with zero duplicated logic. The parent
// passes the already-computed highlight sets (move/target/place/drop) + selection,
// which we render as tinted tiles / ringed figures.
//
// Coordinate model: pointy-top axial (q,r) → world (x,z); elevation → y. Board
// recentered on the origin so camera/orbit target sit at (0,0,0).
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Billboard, Edges, Html } from '@react-three/drei';
import { Suspense, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { MAPS, HS_CARDS, HS_GLYPHS } from '@/lib/games/heroscape';
import type { HSState, HexKey } from '@/lib/games/heroscape';
import { cropOverride, analyzeCut, figureAnchor, figureSpan2 } from '@/lib/games/heroscape/figureBase';

const SIZE = 1; // hex circumradius
const LEVEL = 0.35; // world height per elevation level
const BASE_H = 0.14;
const STANDEE_H = 1.9; // legacy height-stat scale, still used for 2-hex figures
// Base-as-ruler sizing: a 1-hex figure is scaled so its detected base width renders at this
// world size. Calibrated (median figH/baseW≈1.49) so a median figure ≈ STANDEE_H tall;
// shorter/taller minis vary naturally. One knob — raise/lower to scale the whole roster.
const BASE_DISC_W = SIZE * 1.28;
const DISC_H = 0.14; // thickness of the player-colour base disc that sits on the hex
const GLYPH_RAISE = 0.16; // a glyph's whole hex sits slightly higher than its neighbours
const GLYPH_MAROON = '#7f1d1d'; // glyph hex tint + rune colour (maroon)
// BASE_CROP / BASE_CROP_BY_CARD now live in figureBase.ts (shared with the 2D gallery).

const TERRAIN_COLOR: Record<string, string> = { grass: '#4f7a3a', rock: '#8b8b8f', sand: '#cdbb86', water: '#2f6f9f' };
const SEAT_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6'];
// Team colours (allies share one); index = team id − 1 (lobby assigns ids 1/2/3).
const TEAM_COLORS = ['#f87171', '#60a5fa', '#4ade80'];

const parseQR = (key: string): [number, number] => { const [q, r] = key.split(',').map(Number); return [q, r]; };
const worldXZ = (q: number, r: number): [number, number] => [SIZE * Math.sqrt(3) * (q + r / 2), SIZE * 1.5 * r];
const figScale = (h: number): number => Math.min(2.7, Math.max(0.8, h / 5)); // Medium 5 ⇒ ×1

/** Interaction surface — all optional, so the board also works as a read-only
 *  preview when the parent passes nothing. */
type Interact = {
  onHexClick?: (key: HexKey) => void;
  selectedId?: string | null;
  moveHexes?: Set<HexKey>;
  /** The faint "max distance" backdrop — every hex the selected figure could still
   *  reach with its REMAINING Move; the bright moveHexes (one-tap steps) sit on top
   *  and it shrinks as the figure walks. */
  rangeHexes?: Set<HexKey>;
  /** Shooting-range envelope for a moving RANGED figure: the hexes within its reach
   *  (plus its own footprint). When present, every hex OUTSIDE this set is dimmed so
   *  the bright island's edge shows the furthest hex the figure could shoot from. */
  shootHexes?: Set<HexKey>;
  /** Reachable move destinations that PROVOKE a leaving-engagement swipe — rendered
   *  RED ("smart movement" warning). Disjoint from the green moveHexes. */
  dangerHexes?: Set<HexKey>;
  targetIds?: Set<string>;
  /** Figures targetable by an active special power (Chomp / Grenade / Mind
   *  Shackle) — glow fuchsia, distinct from the red normal-attack target. */
  powerTargetIds?: Set<string>;
  /** Figures of the now-acting card that still have to move this turn — their base disc
   *  lights up to guide "move each one once"; an id drops out the moment that figure moves. */
  actionableIds?: Set<string>;
  /** Figures currently buffed by a friendly position aura (Finn / Thorgrim / Raelin / Grimnak) —
   *  a soft, static gold disc glow so the player can SEE an aura is live. Lowest-priority ring
   *  (selection / attack target / power target / "still to act" all override it). */
  auraIds?: Set<string>;
  /** Figures a pending blast (Grenade aim) will hit — the armed target + its neighbours, friend or
   *  foe — an ORANGE "blast zone" ring shown while aiming, above the fuchsia candidate-target ring. */
  splashIds?: Set<string>;
  placeHexes?: Set<HexKey>;
  dropHexes?: Set<HexKey>;
  dropPicks?: Set<HexKey>;
  /** Sgt. Drake GRAPPLE GUN targets — a one-space climb-anywhere move. Coloured
   *  DISTINCTLY (violet) from a normal green move so the 25-level climb is obvious. */
  climbHexes?: Set<HexKey>;
  /** The viewing player's own start-zone hexes. The board auto-rotates so this
   *  zone faces the camera (near/bottom), so a player never has to spin the board
   *  to deploy or fight from their own side. */
  viewerStartHexes?: HexKey[];
  /** The viewing player's seat — the camera centres on THIS army (their figures),
   *  not the geometric board centre. */
  viewerSeat?: number;
};

/** Drag-to-move (HeroQuest-style): press on the selected figure and drag across hexes to
 *  trace a route, release to move. It's a CLIENT path-builder over the existing
 *  destination-based move — `start` begins on the figure, `extend` grows/backtracks the path
 *  through legal stop hexes (`moveHexes`), and release commits the endpoint via `onHexClick`
 *  (the same call a click on that hex makes). The engine is unchanged. */
/** One hexagonal-prism terrain tile + thin seam edges; tinted (emissive) when it
 *  is a highlighted move/place/Drop target. */
function HexTile({ x, z, height, terrain, highlight, glyph, dimmed, onClick }: {
  x: number; z: number; height: number; terrain: string; highlight: { color: string; dim?: boolean } | null; glyph?: boolean; dimmed?: boolean; onClick?: () => void;
}) {
  const isWater = terrain === 'water';
  // A glyph's whole hex sits slightly RAISED and is tinted maroon so it reads as a special space.
  const h = Math.max(0.2, height * LEVEL) * (isWater ? 0.6 : 1) + (glyph ? GLYPH_RAISE : 0);
  // Out of a moving ranged figure's reach → darken the base so the in-range island pops.
  const baseColor = glyph ? GLYPH_MAROON : (TERRAIN_COLOR[terrain] ?? '#666');
  const color = dimmed ? '#' + new THREE.Color(baseColor).multiplyScalar(0.34).getHexString() : baseColor;
  return (
    <mesh
      position={[x, h / 2, z]} castShadow receiveShadow
      onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
    >
      <cylinderGeometry args={[SIZE * 1.02, SIZE * 1.02, h, 6]} />
      <meshStandardMaterial
        color={color}
        emissive={highlight?.color ?? '#000000'}
        emissiveIntensity={highlight ? (highlight.dim ? 0.2 : 0.55) : 0}
        roughness={isWater ? 0.2 : 0.9}
        metalness={isWater ? 0.1 : 0}
        transparent={isWater}
        opacity={isWater ? 0.85 : 1}
        flatShading
      />
      {/* thin seam line around every hex so the grid reads clearly */}
      <Edges color="#13161a" />
    </mesh>
  );
}

/** Loads a figure's standee texture. Each SQUAD member has its own pose cut-out
 *  (`<cardId>-<index>.png`) so a 3-trooper squad (e.g. Krav Maga) shows three
 *  DISTINCT figures, not one model cloned; heroes use the single `<cardId>.png`.
 *  If a squad has fewer cut-outs than figures (e.g. Izumi: 3 figures, 2 poses) the
 *  missing variant falls back to the base art — mirroring the 2D board's onError
 *  chain — so a 404 can never crash the WebGL canvas. */
function useStandeeTexture(cardId: string, figIndex: number): THREE.Texture | null {
  const base = `/heroscape/figures/${cardId}.png`;
  const primary = HS_CARDS[cardId]?.type === 'squad' ? `/heroscape/figures/${cardId}-${figIndex}.png` : base;
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const apply = (t: THREE.Texture) => {
      t.colorSpace = THREE.SRGBColorSpace;
      if (alive) setTex(t); else t.dispose();
    };
    loader.load(primary, apply, undefined, () => {
      if (primary !== base) loader.load(base, apply, undefined, () => {}); // variant missing → base art
    });
    return () => { alive = false; };
  }, [primary, base]);
  return tex;
}

/** Opaque bounds of the cut-out in V coords (0 = image bottom, 1 = top): `bottomV` =
 *  lowest opaque row (so we plant the figure on the hex by its real base, no float
 *  from transparent padding), `topV` = highest opaque row. Together they give the
 *  figure's true height so the base-recolour line is a fraction of the FIGURE, not of
 *  the image — robust to however much padding a cut-out has. */
function useOpaqueBoundsV(img: HTMLImageElement | undefined, clipOverride?: number, anchor?: { x: number; y: number }): { bottomV: number; topV: number; baseCenterX: number; baseWidthFrac: number; clip: number } {
  const [b, setB] = useState({ bottomV: 0, topV: 1, baseCenterX: 0.5, baseWidthFrac: 0.5, clip: 0.16 });
  const ax = anchor?.x, ay = anchor?.y;
  useEffect(() => {
    if (!img || !img.complete || !img.width || !img.height) return;
    try {
      const W = img.width, H = img.height;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, W, H).data;
      // The crop line is auto-detected from the cut-out (widest-band rule); a per-figure
      // override only steps in for flyers/wings where that rule misfires.
      const { top, bottom, clip, baseCenterX, baseWidthFrac } = analyzeCut(d, W, H, clipOverride);
      const bottomV = 1 - bottom / H, topV = 1 - top / H;
      // The "black dot" anchor (if set) wins: its Y becomes the crop line and its X the
      // centre. cutV = 1 − anchor.y (image-Y→V); express it as the figure-fraction `clip`
      // the shader already consumes. Size (baseWidthFrac) is left alone.
      let finalClip = clip, finalCenterX = baseCenterX;
      if (ax !== undefined && ay !== undefined) {
        finalCenterX = ax;
        const cutV = 1 - ay;
        finalClip = Math.max(0, Math.min(0.95, (cutV - bottomV) / Math.max(topV - bottomV, 1e-3)));
      }
      setB({ bottomV, topV, baseCenterX: finalCenterX, baseWidthFrac, clip: finalClip });
    } catch { /* leave defaults */ }
  }, [img, clipOverride, ax, ay]);
  return b;
}

/** A height-scaled photo standee on an owner base (oval across both hexes for a
 *  double-space figure). The base glows: amber = selected, red = attack target,
 *  fuchsia = special-power target (Chomp / Grenade / Mind Shackle). Red pips float
 *  above the head, one per wound taken. */
/** Outline of a 2-hex "peanut" base: a circular lobe centred over EACH hex (at ±d on
 *  the long axis) joined by a PINCHED waist — not a uniform pill. waistY (< lobeR) is
 *  the half-depth at the neck; the smaller it is, the more pronounced the pinch. */
function peanutShape(d: number, lobeR: number, waistY: number): THREE.Shape {
  const s = Math.sqrt(Math.max(lobeR * lobeR - waistY * waistY, 1e-4)); // x of the inner-waist point
  const beta = Math.atan2(waistY, s);
  const N = 22;
  const sh = new THREE.Shape();
  for (let i = 0; i <= N; i++) { // right lobe outer arc (top-inner → rightmost → bottom-inner)
    const a = (Math.PI - beta) - (i / N) * 2 * (Math.PI - beta);
    const x = d + lobeR * Math.cos(a), y = lobeR * Math.sin(a);
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  sh.lineTo(0, -waistY * 0.82); // pinched bottom waist
  for (let i = 0; i <= N; i++) { // left lobe outer arc (bottom-inner → leftmost → top-inner)
    const a = -beta - (i / N) * 2 * (Math.PI - beta);
    sh.lineTo(-d + lobeR * Math.cos(a), lobeR * Math.sin(a));
  }
  sh.lineTo(0, waistY * 0.82); // pinched top waist
  sh.closePath();
  return sh;
}

function Standee({ lead, trail, topY, cardId, figIndex, color, selected, target, powerTarget, splash, actionable, aura, wounds, onClick }: {
  lead: [number, number]; trail: [number, number] | null; topY: number; cardId: string; figIndex: number; color: string;
  selected: boolean; target: boolean; powerTarget: boolean; splash: boolean; actionable: boolean; aura: boolean; wounds: number; onClick?: () => void;
}) {
  const tex = useStandeeTexture(cardId, figIndex);
  const img = tex?.image as HTMLImageElement | undefined;
  const aspect = img && img.width && img.height ? img.width / img.height : 0.62;
  // Disc glow priority: selection > attack target > power target > "still to move" (a softer
  // cyan glow on the now-acting card's un-moved figures, so the player sees who's left).
  const strongRing = selected ? '#fbbf24' : target ? '#ef4444' : splash ? '#fb923c' : powerTarget ? '#e879f9' : null;
  // Aura is the LOWEST-priority glow (soft gold) — any stronger status overrides it.
  const ring = strongRing ?? (actionable ? '#67e8f9' : aura ? '#fde047' : null);
  const { bottomV, topV, baseCenterX, baseWidthFrac, clip } = useOpaqueBoundsV(img, cropOverride(cardId, figIndex), figureAnchor(cardId, figIndex));
  // 2-hex peanut geometry — span (hex-centre distance) is needed BEFORE sizing.
  let span = 0, discRotY = 0;
  if (trail) {
    const dx = trail[0] - lead[0], dz = trail[1] - lead[1];
    span = Math.hypot(dx, dz);
    discRotY = -Math.atan2(dz, dx);
  }
  // DOUBLE figures: the user's two-click FRONT/BACK pick sizes the figure so head + tail land
  // on the two hex marks, centres it by their midpoint, and crops at the lower point. (Un-picked
  // doubles fall back to the height stat.) The cut/centre override the single-click anchor.
  const span2 = trail ? figureSpan2(cardId, figIndex) : undefined;
  let effClip = clip, effCenterX = baseCenterX;
  if (span2) {
    effCenterX = (span2.fx + span2.bx) / 2;
    const cutV2 = 1 - Math.max(span2.fy, span2.by);
    effClip = Math.max(0, Math.min(0.95, (cutV2 - bottomV) / Math.max(topV - bottomV, 1e-3)));
  }
  // SIZE: 1-hex by the base ruler; 2-hex by the FRONT→BACK span so the figure bridges both
  // hexes (the two picks map to the hex-centre distance). Un-picked 2-hex use the height stat.
  const extent2 = span2 ? Math.max(Math.abs(span2.fx - span2.bx), 0.1) : 1;
  const h = trail
    ? (span2 ? (span / extent2) / aspect : STANDEE_H * figScale(HS_CARDS[cardId]?.height ?? 5))
    : (BASE_DISC_W / Math.max(baseWidthFrac, 0.15)) / aspect;
  const w = h * aspect;
  // CROP the moulded base off at the crop line and butt the figure's cut edge onto the
  // player's colour disc — the disc IS the base.
  const cutV = bottomV + effClip * (topV - bottomV); // V of the crop line (figV = effClip)
  // PIVOT the billboard around the figure's cut edge, locked at the hex centre ON PLANE
  // WITH THE DISC TOP (not sunk into the disc cylinder), so the figure sits ON the disc
  // and spinning/angling the camera rotates it IN PLACE instead of sliding across the
  // hex. The plane is offset up so its cut edge meets the pivot at the disc top.
  const pivotY = DISC_H;
  const planeOffsetY = h / 2 - cutV * h;
  // Single-hex figures whose feet sit off the image centre get nudged back onto the
  // disc by HALF the offset — splitting the difference between the figure's overall
  // centre and its base, so the base reads centred without throwing the silhouette off.
  // Shift so the BASE centre (not the figure centroid) sits on the hex centre; overhang
  // (sword/arm into a neighbour hex) is intended. Full shift — no "split the difference".
  // Shift so the centre sits on the hex centre. 1-hex always; 2-hex only when a span2 pick
  // exists (so front/back land on the marks) — plain 2-hex stay centred on the peanut.
  const baseShiftX = (!trail || span2) ? -(effCenterX - 0.5) * w : 0;
  const headY = pivotY + planeOffsetY + h / 2; // figure top, for the wound pips
  const figMat = useMemo(() => {
    if (!tex) return null;
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uClip: { value: effClip }, uBot: { value: bottomV }, uTop: { value: topV } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform sampler2D map; uniform float uClip; uniform float uBot; uniform float uTop; varying vec2 vUv;' +
        'void main(){ float figV = (vUv.y - uBot) / max(uTop - uBot, 0.001);' +
        'if (figV < uClip) discard;' +
        'vec4 t = texture2D(map, vUv); if (t.a < 0.5) discard;' +
        // sRGB textures are linearised on sample, but a custom ShaderMaterial gets no
        // output colour-space pass (built-in materials do), so figures rendered DARKER
        // than the terrain/discs. Encode linear -> sRGB here so brightness matches.
        'vec3 c = mix(t.rgb * 12.92, 1.055 * pow(max(t.rgb, 0.0), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), t.rgb));' +
        'gl_FragColor = vec4(c, 1.0); }',
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }, [tex, effClip, bottomV, topV]);
  const cx = trail ? (lead[0] + trail[0]) / 2 : lead[0];
  const cz = trail ? (lead[1] + trail[1]) / 2 : lead[1];
  const r = SIZE * 0.74 * 0.9; // single-hex disc radius — reduced 10% (was SIZE*0.74 ≈ 80% of the hex)
  // 2-hex base = a PEANUT (a lobe over each hex + a pinched waist), extruded flat. The
  // lobe radius is < the 1-hex disc so it doesn't read too "deep"; the waist pinch is
  // what makes it a peanut rather than a uniform pill.
  const peanut = useMemo(() => (span > 0 ? peanutShape(span / 2, SIZE * 0.62, SIZE * 0.34) : null), [span]);
  const discProps = { color, emissive: ring ?? '#000000', emissiveIntensity: strongRing ? 0.9 : actionable ? 0.5 : aura ? 0.4 : 0, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide };
  // 2-hex SWAY: a double-space figure must not billboard freely or its wide plane swings
  // perpendicular and hangs off the peanut. Keep its footprint along the peanut's long axis,
  // letting it sway toward the camera only up to the angle where its base edge still fits
  // inside the peanut (half-width ≈ the lobe radius) with margin.
  const swayRef = useRef<THREE.Group>(null);
  const planeRef = useRef<THREE.Mesh>(null);
  // "Still to move" discs softly PULSE so the un-moved members of the now-acting card stand
  // out (a stronger ring — selected/target — wins and stays solid). The disc goes dark the
  // instant the figure moves (actionable flips false → discProps sets intensity 0).
  const discMatRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const m = discMatRef.current;
    if (!m || !actionable || strongRing) return;
    m.emissiveIntensity = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.5));
  });
  useFrame(({ camera }) => {
    const g = swayRef.current;
    if (!g || !trail) return;
    const ux = trail[0] - lead[0], uz = trail[1] - lead[1];
    const ll = Math.hypot(ux, uz) || 1;
    const lx = ux / ll, lz = uz / ll;                          // long-axis unit
    let cdx = camera.position.x - cx, cdz = camera.position.z - cz;
    const cl = Math.hypot(cdx, cdz) || 1; cdx /= cl; cdz /= cl;  // camera dir unit
    let px = -lz, pz = lx;                                       // perpendicular to long axis…
    let flipped = false;
    if (px * cdx + pz * cdz < 0) { px = lz; pz = -lx; flipped = true; } // …on the camera's side
    const ang = Math.atan2(px * cdz - pz * cdx, px * cdx + pz * cdz); // signed perp→camera
    // LOCK doubles FLAT along the peanut — zero sway, so the footprint stays put and never
    // tilts/swings off-centre (even a few degrees swung the ends on a big figure). The plane
    // still flips sides (mirror-couple below) to keep facing the camera, but it never tilts.
    const dmax = 0;
    const a = Math.max(-dmax, Math.min(dmax, ang));
    const ca = Math.cos(a), sa = Math.sin(a);
    g.rotation.y = Math.atan2(px * ca - pz * sa, px * sa + pz * ca);
    // NO HEAD-FLIP: when we turn the plane to face the camera from the OTHER side, the
    // photo would otherwise mirror and the figure's head/lead would jump to the opposite
    // hex. Counter it by mirroring the texture (scale.x = -1) in lockstep with that turn,
    // so the head always points the SAME world direction. Negate baseShiftX too so an
    // off-centre figure doesn't jump sideways at the flip. The swap lands when the plane
    // goes edge-on (camera crossing the long axis), so it's invisible.
    if (planeRef.current) {
      planeRef.current.scale.x = flipped ? -1 : 1;
      planeRef.current.position.x = flipped ? -baseShiftX : baseShiftX;
    }
  });
  // SMART-MOVEMENT WALK: glide the figure toward its hex at a constant speed instead
  // of snapping, so a click-to-move (and each AI step) reads as the figure walking the
  // direct line to its destination. Snaps on first placement (no drift in from the
  // origin) and on a board-spanning jump (Airborne drop / reseat), which aren't walks.
  const rootRef = useRef<THREE.Group>(null);
  const placedRef = useRef(false);
  useFrame((_, delta) => {
    const g = rootRef.current;
    if (!g) return;
    if (!placedRef.current) { g.position.set(cx, topY, cz); placedRef.current = true; return; }
    g.position.y = topY; // height changes snap; only the horizontal walk eases
    const dx = cx - g.position.x, dz = cz - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return;
    if (dist > 22) { g.position.x = cx; g.position.z = cz; return; } // teleport, not a walk → snap
    const step = Math.min(dist, 20 * delta); // ~20 world units/sec — a quick walk
    g.position.x += (dx / dist) * step;
    g.position.z += (dz / dist) * step;
  });
  const pips = Math.min(wounds, 8);
  return (
    <group
      ref={rootRef}
      onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
    >
      {/* The player-colour 3D disc IS the base: the cropped figure butts straight onto
          its top. Glows the ring colour when selected / targeted. */}
      {peanut ? (
        <group rotation={[0, discRotY, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <extrudeGeometry args={[peanut, { depth: DISC_H, bevelEnabled: false }]} />
            <meshStandardMaterial ref={discMatRef} {...discProps} />
          </mesh>
        </group>
      ) : (
        <mesh position={[0, DISC_H / 2, 0]} receiveShadow>
          <cylinderGeometry args={[r, r * 1.04, DISC_H, 28]} />
          <meshStandardMaterial ref={discMatRef} {...discProps} />
        </mesh>
      )}
      {/* Single-hex figures FULL-billboard (always face the camera) so you never catch one
          edge-on. 2-hex figures use a CLAMPED sway (see useFrame) that keeps their footprint
          on the peanut instead of spinning off it. */}
      {figMat && (trail ? (
        <group ref={swayRef} position={[0, pivotY, 0]}>
          {/* raycast disabled: the tall image must NOT catch clicks meant for hexes it visually
              overlaps (e.g. a big dragon's wings over a neighbour hex). The base DISC below is
              the clickable target for the figure; clicks over the image fall through to the hex. */}
          <mesh ref={planeRef} position={[baseShiftX, planeOffsetY, 0]} raycast={() => null}>
            <planeGeometry args={[w, h]} />
            <primitive object={figMat} attach="material" />
          </mesh>
        </group>
      ) : (
        <Billboard follow position={[0, pivotY, 0]}>
          {/* raycast disabled — see the 2-hex note above: the disc is the click target so the
              figure's image can't steal clicks aimed at a neighbouring hex. */}
          <mesh position={[baseShiftX, planeOffsetY, 0]} raycast={() => null}>
            <planeGeometry args={[w, h]} />
            <primitive object={figMat} attach="material" />
          </mesh>
        </Billboard>
      ))}
      {/* Wound markers — a row of red pips floating above the figure's head. */}
      {pips > 0 && (
        <group position={[0, headY + 0.22, 0]}>
          {Array.from({ length: pips }, (_, i) => (
            <mesh key={i} position={[(i - (pips - 1) / 2) * 0.2, 0, 0]}>
              <sphereGeometry args={[0.08, 12, 12]} />
              <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" emissiveIntensity={0.5} roughness={0.4} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/** A power GLYPH on the board — a MAROON rune-disc lying flat on its (raised) hex top. It starts
 *  HIDDEN (face-down): a dim disc with a "?" and no identity, until a figure stops on it and flips
 *  it face-up. Once revealed it glows brighter while a figure CONTROLS it, and its ring is wide
 *  enough to show AROUND that figure. Hovering pops a tooltip — its name + effect once revealed,
 *  or "Unknown glyph" while still hidden. */
function GlyphMarker({ x, z, topY, active, faceUp, name, effect }: {
  x: number; z: number; topY: number; active: boolean; faceUp: boolean; name: string; effect: string;
}) {
  const [hover, setHover] = useState(false);
  const lit = faceUp && active; // brightest only when REVEALED and currently controlled
  return (
    <group
      position={[x, topY + 0.04, z]}
      onPointerOver={e => { e.stopPropagation(); setHover(true); }}
      onPointerOut={e => { e.stopPropagation(); setHover(false); }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[SIZE * 0.5, SIZE * 0.84, 28]} />
        <meshStandardMaterial color={GLYPH_MAROON} emissive="#b91c1c" emissiveIntensity={lit ? 1.15 : faceUp ? 0.5 : 0.28} side={THREE.DoubleSide} transparent opacity={faceUp ? 0.95 : 0.82} metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[SIZE * 0.5, 28]} />
        <meshStandardMaterial color="#3b0a0a" emissive={GLYPH_MAROON} emissiveIntensity={lit ? 0.6 : 0.22} side={THREE.DoubleSide} transparent opacity={0.85} />
      </mesh>
      {/* A hidden glyph wears a persistent "?" so its location is known but its power isn't. */}
      {!faceUp && (
        <Html center position={[0, 0.06, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fca5a5', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>?</div>
        </Html>
      )}
      {hover && (
        <Html center position={[0, 0.55, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ width: 172, borderRadius: 8, border: '1px solid #b91c1c', background: 'rgba(24,10,10,0.96)', padding: '6px 9px', color: '#fecaca', fontSize: 11, lineHeight: 1.35, textAlign: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.55)' }}>
            {faceUp ? (
              <>
                <div style={{ fontWeight: 700, color: '#fca5a5', marginBottom: 2 }}>{name}{active ? ' · active' : ''}</div>
                <div>{effect}</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, color: '#fca5a5', marginBottom: 2 }}>Unknown glyph</div>
                <div>Hidden — step a figure onto it to reveal.</div>
              </>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

function Scene({ state, it }: { state: HSState; it: Interact }) {
  const map = MAPS[state.mapId];
  const cells = useMemo(() => (map ? Object.values(map.cells) : []), [map]);
  // Hexes that hold a glyph — their tiles render raised + maroon, and figures on them sit higher.
  const glyphSet = useMemo(() => new Set((state.glyphs ?? []).map(g => g.at)), [state.glyphs]);
  const [cx, cz] = useMemo(() => {
    if (!cells.length) return [0, 0];
    let sx = 0, sz = 0;
    for (const c of cells) { const [x, z] = worldXZ(c.q, c.r); sx += x; sz += z; }
    return [sx / cells.length, sz / cells.length];
  }, [cells]);

  // Auto-rotate the whole board so the VIEWING player's start zone faces the
  // camera (the near/bottom edge) — so a player never has to spin the board to
  // deploy or fight from their own side. Angle brings the zone's centroid to +Z.
  const faceAngle = useMemo(() => {
    const zone = it.viewerStartHexes;
    if (!zone || zone.length === 0) return 0;
    let sx = 0, sz = 0;
    for (const k of zone) { const [x, z] = worldXZ(...parseQR(k)); sx += x; sz += z; }
    const vx = sx / zone.length - cx, vz = sz / zone.length - cz;
    return Math.abs(vx) < 1e-4 && Math.abs(vz) < 1e-4 ? 0 : Math.atan2(-vx, vz);
  }, [it.viewerStartHexes, cx, cz]);

  const cardOf = (uid: string) => state.cards.find(c => c.uid === uid)?.cardId ?? '';
  const seatColor = (seat: number) => {
    const idx = state.players.findIndex(p => p.seat === seat);
    // Team games: allies share their team colour; free-for-all keeps seat colours.
    const team = state.players[idx]?.team;
    if (team !== undefined) return TEAM_COLORS[(team - 1) % TEAM_COLORS.length] ?? '#a3a3a3';
    return state.players[idx]?.accent_color || SEAT_COLORS[idx] || '#a3a3a3';
  };
  // Highlight priority for a tile: Drop picks/targets, then the Grapple climb set,
  // then the BRIGHT one-tap step set, then the FAINT remaining-Move range backdrop,
  // then placement. Bright green = tap to step here; faint green = still in reach.
  const tileHighlight = (key: HexKey): { color: string; dim?: boolean } | null =>
    (it.dropPicks?.has(key) ? { color: '#f97316' }
      : it.dropHexes?.has(key) ? { color: '#fb923c' }
        : it.climbHexes?.has(key) ? { color: '#a855f7' } // Grapple Gun climb target — distinct from a normal move
          : it.dangerHexes?.has(key) ? { color: '#ef4444' } // RED = reachable, but moving here provokes a swipe
            : it.moveHexes?.has(key) ? { color: '#22c55e' } // green = a safe move destination
              : it.rangeHexes?.has(key) ? { color: '#22c55e', dim: true } // (legacy) faint within-Move backdrop
                : it.placeHexes?.has(key) ? { color: '#38bdf8' }
                  : null);
  // When a moving ranged figure's shooting envelope is present, darken every hex
  // OUTSIDE it so the bright reach island stands out and its edge reads as the
  // furthest targetable hex.
  const hasShoot = (it.shootHexes?.size ?? 0) > 0;
  const isDimmed = (key: HexKey): boolean => hasShoot && !it.shootHexes!.has(key);

  return (
    <group rotation={[0, faceAngle, 0]}>
    <group position={[-cx, 0, -cz]}>
      {cells.map(c => {
        const [x, z] = worldXZ(c.q, c.r);
        const key = `${c.q},${c.r}`;
        return (
          <HexTile
            key={key} x={x} z={z} height={c.height} terrain={c.terrain}
            highlight={tileHighlight(key)}
            glyph={glyphSet.has(key)}
            dimmed={isDimmed(key)}
            onClick={it.onHexClick ? () => it.onHexClick!(key) : undefined}
          />
        );
      })}
      {/* Power glyphs sit on the ground (rendered after tiles, before figures). */}
      {(state.glyphs ?? []).map(g => {
        const gc = map?.cells[g.at];
        if (!gc) return null;
        const [gx, gz] = worldXZ(...parseQR(g.at));
        const gTop = Math.max(0.2, gc.height * LEVEL) * (gc.terrain === 'water' ? 0.6 : 1) + GLYPH_RAISE;
        const active = state.figures.some(f => f.at === g.at); // a figure stands on it → activated
        const def = HS_GLYPHS[g.id];
        return <GlyphMarker key={g.at} x={gx} z={gz} topY={gTop} active={active} faceUp={g.faceUp} name={def?.name ?? 'Glyph'} effect={def?.effect ?? ''} />;
      })}
      <Suspense fallback={null}>
        {state.figures.filter(f => f.at != null).map(f => {
          const lead = worldXZ(...parseQR(f.at!));
          const trail = f.at2 ? worldXZ(...parseQR(f.at2)) : null;
          const cell = map?.cells[f.at!];
          const topY = Math.max(0.2, (cell?.height ?? 1) * LEVEL) * (cell?.terrain === 'water' ? 0.6 : 1) + (glyphSet.has(f.at!) ? GLYPH_RAISE : 0);
          const cardId = cardOf(f.cardUid);
          if (!cardId) return null;
          return (
            <Standee
              key={f.id} lead={lead} trail={trail} topY={topY} cardId={cardId} figIndex={f.index} color={seatColor(f.ownerSeat)}
              selected={it.selectedId === f.id} target={!!it.targetIds?.has(f.id)}
              powerTarget={!!it.powerTargetIds?.has(f.id)} splash={!!it.splashIds?.has(f.id)} actionable={!!it.actionableIds?.has(f.id)} aura={!!it.auraIds?.has(f.id)} wounds={f.wounds}
              onClick={it.onHexClick ? () => it.onHexClick!(f.at!) : undefined}
            />
          );
        })}
      </Suspense>
    </group>
    </group>
  );
}

/** Eases the OrbitControls target toward `desired` whenever it changes (a tapped
 *  hex, or the viewer's army moving), then stops driving so manual orbit/pan is free
 *  in between. Snaps on the first frame so there's no swoop in from the origin on
 *  mount. Works WITH OrbitControls' own damping (makeDefault registers controls). */
function CameraRig({ desired }: { desired: [number, number, number] }) {
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update: () => void } | null;
  const want = useRef(new THREE.Vector3(desired[0], desired[1], desired[2]));
  const animating = useRef(false);
  const inited = useRef(false);
  useEffect(() => {
    want.current.set(desired[0], desired[1], desired[2]);
    animating.current = true; // a new command — ease to it
  }, [desired]);
  useFrame(() => {
    if (!controls) return;
    const t = controls.target;
    if (!inited.current) { t.copy(want.current); controls.update(); inited.current = true; animating.current = false; return; }
    if (!animating.current) return;
    if (t.distanceToSquared(want.current) < 0.0016) { t.copy(want.current); animating.current = false; }
    else t.lerp(want.current, 0.16);
    controls.update();
  });
  return null;
}

export default function HeroBoard3D({ state, bg, ...it }: { state: HSState; bg?: string } & Interact) {
  // Tap-to-step movement: a tap on a figure selects it (its legal single steps light up green),
  // and a tap on a highlighted neighbour walks it there one hex — all routed through `it.onHexClick`,
  // the same handler a tile/standee click uses, so the engine stays the single source of truth.
  // Frame the camera to the ACTUAL map size. The board is recentred on the origin, so its radius
  // (centroid → farthest hex) drives the start distance, how far you can zoom out, and the shadow
  // frustum — small maps stay as before; the big Star Field starts framed and can pull way back.
  const fit = useMemo(() => {
    const map = MAPS[state.mapId];
    const cells = map ? Object.values(map.cells) : [];
    if (!cells.length) return { dist: 20.6, max: 40, shadow: 20 };
    let sx = 0, sz = 0;
    for (const c of cells) { const [x, z] = worldXZ(c.q, c.r); sx += x; sz += z; }
    const cx = sx / cells.length, cz = sz / cells.length;
    let R = 0;
    for (const c of cells) { const [x, z] = worldXZ(c.q, c.r); R = Math.max(R, Math.hypot(x - cx, z - cz)); }
    const dist = Math.min(160, Math.max(18, R * 2.5));
    return { dist, max: Math.max(40, dist * 1.8), shadow: Math.max(20, R + 6) };
  }, [state.mapId]);
  const myFigKey = state.figures.filter(f => f.ownerSeat === it.viewerSeat && f.at != null).map(f => f.at).join('|');
  const zoneKey = (it.viewerStartHexes ?? []).join('|');
  // The board's recenter (centroid → origin) + face-rotation (spins so the viewer's
  // zone meets the camera) as a single transform, so any hex key can be mapped to
  // its SCENE-space world position — used for both the army focus and click-to-pan.
  const frame = useMemo(() => {
    const map = MAPS[state.mapId];
    const cells = map ? Object.values(map.cells) : [];
    if (!cells.length) return { cx: 0, cz: 0, fa: 0 };
    let sx = 0, sz = 0;
    for (const c of cells) { const [x, z] = worldXZ(c.q, c.r); sx += x; sz += z; }
    const cx = sx / cells.length, cz = sz / cells.length;
    const zone = it.viewerStartHexes ?? [];
    let fa = 0;
    if (zone.length) {
      let zx = 0, zz = 0;
      for (const k of zone) { const [x, z] = worldXZ(...parseQR(k)); zx += x; zz += z; }
      const vx = zx / zone.length - cx, vz = zz / zone.length - cz;
      if (Math.abs(vx) > 1e-4 || Math.abs(vz) > 1e-4) fa = Math.atan2(-vx, vz);
    }
    return { cx, cz, fa };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mapId, zoneKey]);
  const hexToWorld = useCallback((key: HexKey): [number, number, number] => {
    const [x, z] = worldXZ(...parseQR(key));
    const rx = x - frame.cx, rz = z - frame.cz, c = Math.cos(frame.fa), s = Math.sin(frame.fa);
    return [rx * c + rz * s, 0, -rx * s + rz * c];
  }, [frame]);
  // Default focus = the VIEWER's army (their on-board figures), recomputed only when
  // THEIR figures move (a stable key) so it doesn't re-snap on an enemy's move; falls
  // back to the start zone (placement), then board centre (spectator). Rounded to ½.
  const armyTarget = useMemo<[number, number, number]>(() => {
    const ats = myFigKey ? myFigKey.split('|') : (it.viewerStartHexes ?? []);
    if (!ats.length) return [0, 0, 0];
    let ax = 0, az = 0;
    for (const k of ats) { const [x, , z] = hexToWorld(k); ax += x; az += z; }
    return [Math.round((ax / ats.length) * 2) / 2, 0, Math.round((az / ats.length) * 2) / 2];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myFigKey, zoneKey, hexToWorld]);
  // The target the camera pans to. Latest intent wins: the army by default, but a
  // TAPPED/clicked hex takes over (so you can re-centre anywhere with a tap); a later
  // army move re-follows the army. CameraRig eases the target to this, then releases
  // so manual orbit/pan stays free between commands.
  const [desired, setDesired] = useState<[number, number, number]>(armyTarget);
  useEffect(() => { setDesired(armyTarget); }, [armyTarget]);
  const handleHexClick = useCallback((key: HexKey) => {
    setDesired(hexToWorld(key));
    it.onHexClick?.(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexToWorld, it.onHexClick]);
  const itForScene = { ...it, onHexClick: handleHexClick };
  const camPos: [number, number, number] = [armyTarget[0], fit.dist * 0.63, armyTarget[2] + fit.dist * 0.776];
  return (
    <div className={`h-full min-h-[60vh] w-full overflow-hidden rounded-xl border border-neutral-800 ${bg ?? 'bg-gradient-to-b from-neutral-900 to-neutral-950'}`}>
      <Canvas shadows camera={{ position: camPos, fov: 45 }} dpr={[1, 2]}>
        <hemisphereLight args={['#cfe3ff', '#3a3320', 0.7]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[8, 16, 6]} intensity={1.5} castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-fit.shadow} shadow-camera-right={fit.shadow} shadow-camera-top={fit.shadow} shadow-camera-bottom={-fit.shadow}
          shadow-bias={-0.0004}
        />
        <Scene state={state} it={itForScene} />
        <OrbitControls makeDefault enablePan enableDamping minDistance={6} maxDistance={fit.max} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2.15} />
        <CameraRig desired={desired} />
      </Canvas>
    </div>
  );
}
