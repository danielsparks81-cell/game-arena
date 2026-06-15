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
import { OrbitControls, Billboard, Edges, useTexture } from '@react-three/drei';
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { MAPS, HS_CARDS } from '@/lib/games/heroscape';
import type { HSState, HexKey } from '@/lib/games/heroscape';

const SIZE = 1; // hex circumradius
const LEVEL = 0.35; // world height per elevation level
const BASE_H = 0.14;
const STANDEE_H = 1.9; // billboard height at scale 1 (a Medium/Height-5 figure)

const TERRAIN_COLOR: Record<string, string> = { grass: '#4f7a3a', rock: '#8b8b8f', sand: '#cdbb86', water: '#2f6f9f' };
const SEAT_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6'];

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
  placeHexes?: Set<HexKey>;
  dropHexes?: Set<HexKey>;
  dropPicks?: Set<HexKey>;
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

/** A height-scaled photo standee on an owner base (oval across both hexes for a
 *  double-space figure). Base glows amber when selected, red when an attack target. */
function Standee({ lead, trail, topY, cardId, color, selected, target, onClick }: {
  lead: [number, number]; trail: [number, number] | null; topY: number; cardId: string; color: string;
  selected: boolean; target: boolean; onClick?: () => void;
}) {
  const tex = useTexture(`/heroscape/figures/${cardId}.png`);
  const img = tex.image as HTMLImageElement | undefined;
  const aspect = img && img.width && img.height ? img.width / img.height : 0.62;
  const h = STANDEE_H * figScale(HS_CARDS[cardId]?.height ?? 5);
  const w = h * aspect;
  const cx = trail ? (lead[0] + trail[0]) / 2 : lead[0];
  const cz = trail ? (lead[1] + trail[1]) / 2 : lead[1];
  const r = SIZE * 0.58;
  let baseScaleX = 1, baseRotY = 0;
  if (trail) {
    const dx = trail[0] - lead[0], dz = trail[1] - lead[1];
    baseRotY = -Math.atan2(dz, dx);
    baseScaleX = (Math.hypot(dx, dz) / 2 + r) / r;
  }
  const ring = selected ? '#fbbf24' : target ? '#ef4444' : null;
  return (
    <group position={[cx, topY, cz]} onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}>
      <mesh position={[0, BASE_H / 2, 0]} rotation={[0, baseRotY, 0]} scale={[baseScaleX, 1, 1]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 1.08, BASE_H, 28]} />
        <meshStandardMaterial color={color} emissive={ring ?? '#000000'} emissiveIntensity={ring ? 0.7 : 0} roughness={0.5} metalness={0.2} />
      </mesh>
      <Billboard position={[0, BASE_H + h / 2, 0]}>
        <mesh castShadow>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={tex} transparent alphaTest={0.5} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </Billboard>
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

  const cardOf = (uid: string) => state.cards.find(c => c.uid === uid)?.cardId ?? '';
  const seatColor = (seat: number) => {
    const idx = state.players.findIndex(p => p.seat === seat);
    return state.players[idx]?.accent_color || SEAT_COLORS[idx] || '#a3a3a3';
  };
  const tileHighlight = (key: HexKey): string | null =>
    it.dropPicks?.has(key) ? '#f97316'
      : it.dropHexes?.has(key) ? '#fb923c'
        : it.moveHexes?.has(key) ? '#22c55e'
          : it.placeHexes?.has(key) ? '#38bdf8'
            : null;

  return (
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
              key={f.id} lead={lead} trail={trail} topY={topY} cardId={cardId} color={seatColor(f.ownerSeat)}
              selected={it.selectedId === f.id} target={!!it.targetIds?.has(f.id)}
              onClick={it.onHexClick ? () => it.onHexClick!(f.at!) : undefined}
            />
          );
        })}
      </Suspense>
    </group>
  );
}

export default function HeroBoard3D({ state, ...it }: { state: HSState } & Interact) {
  return (
    <div className="h-[60vh] w-full overflow-hidden rounded-xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950">
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
