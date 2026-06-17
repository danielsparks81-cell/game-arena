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
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Billboard, Edges } from '@react-three/drei';
import { Suspense, useMemo, useState, useEffect } from 'react';
import * as THREE from 'three';
import { MAPS, HS_CARDS } from '@/lib/games/heroscape';
import type { HSState, HexKey } from '@/lib/games/heroscape';

const SIZE = 1; // hex circumradius
const LEVEL = 0.35; // world height per elevation level
const BASE_H = 0.14;
const STANDEE_H = 1.9; // billboard height at scale 1 (a Medium/Height-5 figure)
const DISC_H = 0.14; // thickness of the player-colour base disc that sits on the hex
// Fraction of the FIGURE's height (padding-independent), measured up from the feet,
// that is the moulded base. We CROP it off at that line and butt the figure's cut edge
// straight onto the player's colour disc on the hex — no recolour, the disc IS the
// base. Line sits across the feet: raise if a base sliver still shows above the disc,
// lower if it crops into the feet. Measured by eye per figure; rest use the default.
const BASE_CROP = 0.2;
const BASE_CROP_BY_CARD: Record<string, number> = {
  drake: 0.25,            // line just below the boots (verified on image)
  ne_gok_sa: 0.23,        // line across the lower claws (verified on image)
  zettian_guards: 0.28,
  deathwalker_9000: 0.18,
  raelin: 0.16,
  grimnak: 0.13,          // 2-hex oval base, tall rider
};

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
  targetIds?: Set<string>;
  /** Figures targetable by an active special power (Chomp / Grenade / Mind
   *  Shackle) — glow fuchsia, distinct from the red normal-attack target. */
  powerTargetIds?: Set<string>;
  placeHexes?: Set<HexKey>;
  dropHexes?: Set<HexKey>;
  dropPicks?: Set<HexKey>;
  /** The viewing player's own start-zone hexes. The board auto-rotates so this
   *  zone faces the camera (near/bottom), so a player never has to spin the board
   *  to deploy or fight from their own side. */
  viewerStartHexes?: HexKey[];
};

/** One hexagonal-prism terrain tile + thin seam edges; tinted (emissive) when it
 *  is a highlighted move/place/Drop target. */
function HexTile({ x, z, height, terrain, highlight, onClick }: {
  x: number; z: number; height: number; terrain: string; highlight: string | null; onClick?: () => void;
}) {
  const isWater = terrain === 'water';
  const h = Math.max(0.2, height * LEVEL) * (isWater ? 0.6 : 1);
  return (
    <mesh position={[x, h / 2, z]} castShadow receiveShadow onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}>
      <cylinderGeometry args={[SIZE * 1.02, SIZE * 1.02, h, 6]} />
      <meshStandardMaterial
        color={TERRAIN_COLOR[terrain] ?? '#666'}
        emissive={highlight ?? '#000000'}
        emissiveIntensity={highlight ? 0.55 : 0}
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
function useOpaqueBoundsV(img: HTMLImageElement | undefined, clip: number): { bottomV: number; topV: number; baseCenterX: number } {
  const [b, setB] = useState({ bottomV: 0, topV: 1, baseCenterX: 0.5 });
  useEffect(() => {
    if (!img || !img.complete || !img.width || !img.height) return;
    try {
      const W = img.width, H = img.height;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, W, H).data;
      const rowOpaque = (y: number) => { for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) return true; return false; };
      let bottom = H - 1; for (; bottom > 0; bottom--) if (rowOpaque(bottom)) break;
      let top = 0; for (; top < H - 1; top++) if (rowOpaque(top)) break;
      // Horizontal centroid of the FEET — opaque pixels in a band just above the crop
      // line — so a figure can be re-centred by where it actually stands on the disc,
      // not by the image centre (an off-centre/asymmetric pose shifts the base sideways).
      const figH = Math.max(1, bottom - top);
      const cutRow = bottom - clip * figH;
      const bandTop = Math.max(top, Math.round(cutRow - 0.1 * figH));
      let sx = 0, n = 0;
      for (let y = bandTop; y <= cutRow && y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) { sx += x; n++; }
      const baseCenterX = n ? sx / n / W : 0.5;
      setB({ bottomV: 1 - bottom / H, topV: 1 - top / H, baseCenterX });
    } catch { /* leave defaults */ }
  }, [img, clip]);
  return b;
}

/** A height-scaled photo standee on an owner base (oval across both hexes for a
 *  double-space figure). The base glows: amber = selected, red = attack target,
 *  fuchsia = special-power target (Chomp / Grenade / Mind Shackle). Red pips float
 *  above the head, one per wound taken. */
function Standee({ lead, trail, topY, cardId, figIndex, color, selected, target, powerTarget, wounds, onClick }: {
  lead: [number, number]; trail: [number, number] | null; topY: number; cardId: string; figIndex: number; color: string;
  selected: boolean; target: boolean; powerTarget: boolean; wounds: number; onClick?: () => void;
}) {
  const tex = useStandeeTexture(cardId, figIndex);
  const img = tex?.image as HTMLImageElement | undefined;
  const aspect = img && img.width && img.height ? img.width / img.height : 0.62;
  const h = STANDEE_H * figScale(HS_CARDS[cardId]?.height ?? 5);
  const w = h * aspect;
  // CROP the moulded base off at the feet line (everything below `clip` fraction of the
  // figure's height is discarded) and butt the figure's cut edge onto the player's
  // colour disc — the disc IS the base. A hair of overlap hides the seam.
  const ring = selected ? '#fbbf24' : target ? '#ef4444' : powerTarget ? '#e879f9' : null;
  const clip = BASE_CROP_BY_CARD[cardId] ?? BASE_CROP;
  const { bottomV, topV, baseCenterX } = useOpaqueBoundsV(img, clip);
  const cutV = bottomV + clip * (topV - bottomV); // V of the crop line (figV = clip)
  // PIVOT the billboard around the figure's cut edge, locked at the hex centre ON PLANE
  // WITH THE DISC TOP (not sunk into the disc cylinder), so the figure sits ON the disc
  // and spinning/angling the camera rotates it IN PLACE instead of sliding across the
  // hex. The plane is offset up so its cut edge meets the pivot at the disc top.
  const pivotY = DISC_H;
  const planeOffsetY = h / 2 - cutV * h;
  // Single-hex figures whose feet sit off the image centre get nudged back onto the
  // disc by HALF the offset — splitting the difference between the figure's overall
  // centre and its base, so the base reads centred without throwing the silhouette off.
  const baseShiftX = trail ? 0 : -(baseCenterX - 0.5) * w * 0.5;
  const headY = pivotY + planeOffsetY + h / 2; // figure top, for the wound pips
  const figMat = useMemo(() => {
    if (!tex) return null;
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uClip: { value: clip }, uBot: { value: bottomV }, uTop: { value: topV } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform sampler2D map; uniform float uClip; uniform float uBot; uniform float uTop; varying vec2 vUv;' +
        'void main(){ float figV = (vUv.y - uBot) / max(uTop - uBot, 0.001);' +
        'if (figV < uClip) discard;' +
        'vec4 t = texture2D(map, vUv); if (t.a < 0.5) discard;' +
        'gl_FragColor = vec4(t.rgb, 1.0); }',
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }, [tex, clip, bottomV, topV]);
  const cx = trail ? (lead[0] + trail[0]) / 2 : lead[0];
  const cz = trail ? (lead[1] + trail[1]) / 2 : lead[1];
  const r = SIZE * 0.74; // disc ≈ 80% of the hex; the figure's image edges sit on it
  let baseScaleX = 1, baseRotY = 0;
  if (trail) {
    const dx = trail[0] - lead[0], dz = trail[1] - lead[1];
    baseRotY = -Math.atan2(dz, dx);
    baseScaleX = (Math.hypot(dx, dz) / 2 + r) / r;
  }
  const pips = Math.min(wounds, 8);
  return (
    <group position={[cx, topY, cz]} onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}>
      {/* The player-colour 3D disc IS the base: the cropped figure butts straight onto
          its top. Oval across both hexes for a 2-space figure. Glows the ring colour
          when selected / targeted. */}
      <mesh position={[0, DISC_H / 2, 0]} rotation={[0, baseRotY, 0]} scale={[baseScaleX, 1, 1]} receiveShadow>
        <cylinderGeometry args={[r, r * 1.04, DISC_H, 28]} />
        <meshStandardMaterial color={color} emissive={ring ?? '#000000'} emissiveIntensity={ring ? 0.9 : 0} roughness={0.5} metalness={0.2} />
      </mesh>
      {/* Single-hex figures FULL-billboard (always face the camera) so you never catch
          one edge-on from a steep angle; 2-hex figures lock tilt/roll to keep their
          orientation across the two hexes. */}
      {figMat && (
        <Billboard follow lockX={!!trail} lockZ={!!trail} position={[0, pivotY, 0]}>
          <mesh position={[baseShiftX, planeOffsetY, 0]}>
            <planeGeometry args={[w, h]} />
            <primitive object={figMat} attach="material" />
          </mesh>
        </Billboard>
      )}
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

/** A power GLYPH on the board — a glowing gold rune-ring lying flat on the hex
 *  top (under any figure standing on it), so glyphs read clearly in 3D the way
 *  they do on the 2D board. */
function GlyphMarker({ x, z, topY }: { x: number; z: number; topY: number }) {
  return (
    <group position={[x, topY + 0.03, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <ringGeometry args={[SIZE * 0.3, SIZE * 0.62, 28]} />
        <meshStandardMaterial color="#fcd34d" emissive="#f59e0b" emissiveIntensity={0.9} side={THREE.DoubleSide} transparent opacity={0.92} metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, -0.01]}>
        <circleGeometry args={[SIZE * 0.3, 28]} />
        <meshStandardMaterial color="#1c1407" emissive="#a16207" emissiveIntensity={0.35} side={THREE.DoubleSide} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

function Scene({ state, it }: { state: HSState; it: Interact }) {
  const map = MAPS[state.mapId];
  const cells = useMemo(() => (map ? Object.values(map.cells) : []), [map]);
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
  const tileHighlight = (key: HexKey): string | null =>
    it.dropPicks?.has(key) ? '#f97316'
      : it.dropHexes?.has(key) ? '#fb923c'
        : it.moveHexes?.has(key) ? '#22c55e'
          : it.placeHexes?.has(key) ? '#38bdf8'
            : null;

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
            onClick={it.onHexClick ? () => it.onHexClick!(key) : undefined}
          />
        );
      })}
      {/* Power glyphs sit on the ground (rendered after tiles, before figures). */}
      {(state.glyphs ?? []).map(g => {
        const gc = map?.cells[g.at];
        if (!gc) return null;
        const [gx, gz] = worldXZ(...parseQR(g.at));
        const gTop = Math.max(0.2, gc.height * LEVEL) * (gc.terrain === 'water' ? 0.6 : 1);
        return <GlyphMarker key={g.at} x={gx} z={gz} topY={gTop} />;
      })}
      <Suspense fallback={null}>
        {state.figures.filter(f => f.at != null).map(f => {
          const lead = worldXZ(...parseQR(f.at!));
          const trail = f.at2 ? worldXZ(...parseQR(f.at2)) : null;
          const cell = map?.cells[f.at!];
          const topY = Math.max(0.2, (cell?.height ?? 1) * LEVEL) * (cell?.terrain === 'water' ? 0.6 : 1);
          const cardId = cardOf(f.cardUid);
          if (!cardId) return null;
          return (
            <Standee
              key={f.id} lead={lead} trail={trail} topY={topY} cardId={cardId} figIndex={f.index} color={seatColor(f.ownerSeat)}
              selected={it.selectedId === f.id} target={!!it.targetIds?.has(f.id)}
              powerTarget={!!it.powerTargetIds?.has(f.id)} wounds={f.wounds}
              onClick={it.onHexClick ? () => it.onHexClick!(f.at!) : undefined}
            />
          );
        })}
      </Suspense>
    </group>
    </group>
  );
}

export default function HeroBoard3D({ state, ...it }: { state: HSState } & Interact) {
  return (
    <div className="h-full min-h-[60vh] w-full overflow-hidden rounded-xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950">
      <Canvas shadows camera={{ position: [0, 13, 16], fov: 45 }} dpr={[1, 2]}>
        <hemisphereLight args={['#cfe3ff', '#3a3320', 0.7]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[8, 16, 6]} intensity={1.5} castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20}
          shadow-bias={-0.0004}
        />
        <Scene state={state} it={it} />
        <OrbitControls makeDefault enablePan enableDamping minDistance={6} maxDistance={40} minPolarAngle={0.15} maxPolarAngle={Math.PI / 2.15} target={[0, 0, 0]} />
      </Canvas>
    </div>
  );
}
