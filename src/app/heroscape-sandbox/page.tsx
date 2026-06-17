'use client';

// HeroScape FIGURE GALLERY — a dev-only page that drops every figure onto a flat
// board grid so you can spin the camera and eyeball all the bases / crops / centering
// at once, without drafting armies or firing up a game. Reuses the real 3D board
// (HeroBoard3D) so what you see here is exactly what you get in play.

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { MAPS, type HSMap } from '@/lib/games/heroscape/maps';
import { HS_CARDS } from '@/lib/games/heroscape/content';
import type { HSState, HexCell } from '@/lib/games/heroscape/types';

const HeroBoard3D = dynamic(() => import('@/components/HeroBoard3D'), { ssr: false });

const COLORS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6'];
const COLS = 6; // figures per row, spaced 2 hexes apart so they don't occlude

export default function HeroScapeSandbox() {
  const { state, units } = useMemo(() => {
    const units = Object.values(HS_CARDS).filter(c => c.type === 'squad' || c.type === 'hero');
    const positions = units.map((_, i) => [(i % COLS) * 2, Math.floor(i / COLS) * 2] as const);

    // A continuous flat grass grid big enough to hold the spaced-out figures.
    const cells: Record<string, HexCell> = {};
    const maxQ = (COLS - 1) * 2;
    const maxR = Math.floor((units.length - 1) / COLS) * 2;
    for (let r = 0; r <= maxR; r++) for (let q = 0; q <= maxQ; q++) cells[`${q},${r}`] = { q, r, height: 1, terrain: 'grass' };
    const galleryMap: HSMap = { id: '__gallery__', name: 'Gallery', cols: maxQ + 1, rows: maxR + 1, cells, startZones: {}, glyphSpots: [], glyphs: [] };
    MAPS['__gallery__'] = galleryMap; // register so the board's MAPS[mapId] lookup resolves

    // One card + one figure per unit, cycled through the six player colours so every
    // disc colour shows up. index 1 loads a squad's first pose; heroes ignore it.
    const cards = units.map((c, i) => ({ uid: `g-${c.id}`, cardId: c.id, ownerSeat: i % COLORS.length, orderMarkers: [], attackMod: 0, defenseMod: 0 }));
    const figures = units.map((c, i) => ({ id: `g-${c.id}-1`, cardUid: `g-${c.id}`, ownerSeat: i % COLORS.length, at: `${positions[i][0]},${positions[i][1]}`, index: 1, wounds: 0 }));
    const players = COLORS.map((accent_color, seat) => ({ seat, playerId: `g${seat}`, username: `P${seat}`, accent_color }));

    // The 3D scene only reads mapId/players/cards/figures/glyphs, so a partial state is
    // enough — cast past the rest of HSState (round/phase/etc. are never touched here).
    return { units, state: { mapId: '__gallery__', players, cards, figures, glyphs: [] } as unknown as HSState };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 p-4 text-neutral-200">
      <h1 className="text-lg font-semibold">HeroScape figure gallery</h1>
      <p className="mb-3 text-sm text-neutral-400">
        All {units.length} figures on player discs — drag to orbit, scroll to zoom. Cycled through the six player colours. No game setup needed.
      </p>
      <div className="h-[78vh]">
        <HeroBoard3D state={state} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
        {units.map(c => <span key={c.id}>{c.name}</span>)}
      </div>
    </main>
  );
}
