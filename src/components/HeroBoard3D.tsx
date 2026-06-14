'use client';
// HeroScape 3D board — Phase 1 (React Three Fiber). A real WebGL scene replacing
// the fixed SVG isometric view: free orbit (left-drag), pan (right-drag), zoom
// (wheel), real hex-prism terrain with elevation + water, soft shadows, and
// figures as camera-facing photo STANDEES on owner-colored bases (with silhouette
// shadows via alpha-tested depth). Read-only preview in Phase 1 — interaction
// (click-to-move/attack, highlights, the .glb model upgrade) lands in Phase 2.
//
// Coordinate model: pointy-top axial (q,r) → world (x,z); elevation → y.
//   x = SIZE·√3·(q + r/2)   z = SIZE·1.5·r   tileTop = height·LEVEL
// The whole board is recentered to the origin so the camera/orbit target sit at
// (0,0,0) regardless of map shape.
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Billboard, useTexture } from '@react-three/drei';
import { Suspense, useMemo } from 'react';
import * as THREE from 'three';
import { MAPS } from '@/lib/games/heroscape';
import type { HSState } from '@/lib/games/heroscape';
import { HS_CARDS } from '@/lib/games/heroscape';

const SIZE = 1; // hex circumradius (world units)
const LEVEL = 0.35; // world height per elevation level
const BASE_H = 0.14; // figure base disc thickness
const STANDEE_H = 1.9; // figure billboard height

const TERRAIN_COLOR: Record<string, string> = {
  grass: '#4f7a3a',
  rock: '#8b8b8f',
  sand: '#cdbb86',
  water: '#2f6f9f',
};
const SEAT_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6'];

const parseQR = (key: string): [number, number] => {
  const [q, r] = key.split(',').map(Number);
  return [q, r];
};
const worldXZ = (q: number, r: number): [number, number] => [SIZE * Math.sqrt(3) * (q + r / 2), SIZE * 1.5 * r];

/** One hexagonal-prism terrain tile (a 6-sided cylinder), colored by terrain,
 *  its top face at y = height·LEVEL. Water tiles are a touch lower + translucent. */
function HexTile({ x, z, height, terrain }: { x: number; z: number; height: number; terrain: string }) {
  const isWater = terrain === 'water';
  const h = Math.max(0.2, height * LEVEL) * (isWater ? 0.6 : 1);
  return (
    // Pointy-top hexagon: THREE's 6-sided cylinder is already pointy-top (a vertex
    // toward ±Z), which is what the axial→world spacing expects — so NO rotation.
    // A hair of extra radius (×1.02) closes anti-aliased hairline seams between
    // same-height tiles without visible overlap.
    <mesh position={[x, h / 2, z]} castShadow receiveShadow>
      <cylinderGeometry args={[SIZE * 1.02, SIZE * 1.02, h, 6]} />
      <meshStandardMaterial
        color={TERRAIN_COLOR[terrain] ?? '#666'}
        roughness={isWater ? 0.2 : 0.9}
        metalness={isWater ? 0.1 : 0}
        transparent={isWater}
        opacity={isWater ? 0.8 : 1}
        flatShading
      />
    </mesh>
  );
}

/** A figure: a camera-facing photo standee on an owner-colored base disc. The
 *  billboard casts a SILHOUETTE shadow (alpha-tested depth), so it reads as a
 *  standing model rather than a flat sticker. */
function Standee({ x, topY, z, cardId, color }: { x: number; topY: number; z: number; cardId: string; color: string }) {
  const tex = useTexture(`/heroscape/figures/${cardId}.png`);
  // Keep the figure's aspect ratio (textures are portrait-ish); width from height.
  const img = tex.image as HTMLImageElement | undefined;
  const aspect = img && img.width && img.height ? img.width / img.height : 0.62;
  const w = STANDEE_H * aspect;
  return (
    <group position={[x, topY, z]}>
      {/* base disc — ownership color, casts a round contact shadow */}
      <mesh position={[0, BASE_H / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[SIZE * 0.55, SIZE * 0.6, BASE_H, 24]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
      </mesh>
      {/* photo billboard, bottom-anchored on the base, always facing the camera */}
      <Billboard position={[0, BASE_H + STANDEE_H / 2, 0]}>
        <mesh castShadow>
          <planeGeometry args={[w, STANDEE_H]} />
          <meshBasicMaterial map={tex} transparent alphaTest={0.5} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

function Scene({ state }: { state: HSState }) {
  const map = MAPS[state.mapId];
  const cells = useMemo(() => (map ? Object.values(map.cells) : []), [map]);
  // Recenter the board on the origin (average tile XZ).
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

  return (
    <group position={[-cx, 0, -cz]}>
      {/* terrain */}
      {cells.map(c => {
        const [x, z] = worldXZ(c.q, c.r);
        return <HexTile key={`${c.q},${c.r}`} x={x} z={z} height={c.height} terrain={c.terrain} />;
      })}
      {/* figures (Phase 1: standees only; .glb upgrade lands in Phase 2) */}
      <Suspense fallback={null}>
        {state.figures
          .filter(f => f.at != null)
          .map(f => {
            const [q, r] = parseQR(f.at!);
            const [x, z] = worldXZ(q, r);
            const cell = map?.cells[f.at!];
            const topY = Math.max(0.2, (cell?.height ?? 1) * LEVEL) * (cell?.terrain === 'water' ? 0.6 : 1);
            const cardId = cardOf(f.cardUid);
            if (!cardId) return null;
            return <Standee key={f.id} x={x} topY={topY} z={z} cardId={cardId} color={seatColor(f.ownerSeat)} />;
          })}
      </Suspense>
    </group>
  );
}

export default function HeroBoard3D({ state }: { state: HSState; currentUserId?: string }) {
  return (
    <div className="h-[60vh] w-full overflow-hidden rounded-xl border border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950">
      <Canvas shadows camera={{ position: [0, 13, 16], fov: 45 }} dpr={[1, 2]}>
        <hemisphereLight args={['#cfe3ff', '#3a3320', 0.7]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[8, 16, 6]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
          shadow-bias={-0.0004}
        />
        <Scene state={state} />
        <OrbitControls
          makeDefault
          enablePan
          enableDamping
          minDistance={6}
          maxDistance={40}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 2.15}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
}
