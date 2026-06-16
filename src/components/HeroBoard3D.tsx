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
// Fraction of a figure cut-out's BOTTOM that is the moulded plastic base. We crop
// it off so the figure stands directly on the player's COLOUR disc instead of
// floating above it on its own base. Bases vary a lot, so a per-card override
// dials in any figure; the rest use the default. Raise if a base sliver remains,
// lower if feet get clipped. (Ankle-cropped source pics would let this go to ~0.)
const BASE_CROP = 0.26;
const BASE_CROP_BY_CARD: Record<string, number> = {
  // Per figure, e.g. sgt_drake_alexander: 0.22, ne_gok_sa: 0.3 — fill in from feedback.
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
  // Crop the moulded base off the bottom of the cut-out so the figure stands
  // ON the colour disc. A cloned texture keeps the shared image but samples only
  // the V range [BASE_CROP, 1]; the plane shrinks to match so the figure isn't
  // stretched, and its feet land at the disc top (y = BASE_H).
  const crop = BASE_CROP_BY_CARD[cardId] ?? BASE_CROP;
  const croppedTex = useMemo(() => {
    if (!tex) return null;
    const t = tex.clone();
    t.offset.set(0, crop);
    t.repeat.set(1, 1 - crop);
    return t;
  }, [tex, crop]);
  const h2 = h * (1 - crop);
  const cx = trail ? (lead[0] + trail[0]) / 2 : lead[0];
  const cz = trail ? (lead[1] + trail[1]) / 2 : lead[1];
  const r = SIZE * 0.58;
  let baseScaleX = 1, baseRotY = 0;
  if (trail) {
    const dx = trail[0] - lead[0], dz = trail[1] - lead[1];
    baseRotY = -Math.atan2(dz, dx);
    baseScaleX = (Math.hypot(dx, dz) / 2 + r) / r;
  }
  const ring = selected ? '#fbbf24' : target ? '#ef4444' : powerTarget ? '#e879f9' : null;
  const pips = Math.min(wounds, 8);
  return (
    <group position={[cx, topY, cz]} onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}>
      <mesh position={[0, BASE_H / 2, 0]} rotation={[0, baseRotY, 0]} scale={[baseScaleX, 1, 1]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 1.08, BASE_H, 28]} />
        <meshStandardMaterial color={color} emissive={ring ?? '#000000'} emissiveIntensity={ring ? 0.7 : 0} roughness={0.5} metalness={0.2} />
      </mesh>
      {/* Lock tilt (X) and roll (Z) so the standee stays UPRIGHT and only yaws to
          face the camera. A full billboard tips backward when you angle the camera
          down, lifting the figure's feet off the hex — that's the "floaty" look.
          Y-only keeps every figure planted on its base. */}
      {croppedTex && (
        <Billboard follow lockX lockZ position={[0, BASE_H + h2 / 2, 0]}>
          <mesh castShadow>
            <planeGeometry args={[w, h2]} />
            <meshBasicMaterial map={croppedTex} transparent alphaTest={0.5} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </Billboard>
      )}
      {/* Wound markers — a row of red pips floating above the figure's head. */}
      {pips > 0 && (
        <group position={[0, BASE_H + h2 + 0.22, 0]}>
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
