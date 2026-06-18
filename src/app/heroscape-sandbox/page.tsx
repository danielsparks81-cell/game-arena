'use client';

// HeroScape FIGURE GALLERY — a flat, scrollable review of every figure. Each tile
// renders the cut-out CROPPED at its base line and seated on a player-colour disc,
// using the same crop + feet-centring math as the 3D board (figureBase.ts). Because
// the in-game figures are camera-facing billboards, this 2D front view matches the 3D
// look — but it scrolls instead of making you orbit a single board. SQUADS expand to
// one tile PER FIGURE. CLICK a tile to open that figure on a hex in the real 3D board.

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HS_CARDS, MAPS } from '@/lib/games/heroscape';
import type { HSState, HexCell } from '@/lib/games/heroscape';
import { analyzeCut, cropOverride } from '@/lib/games/heroscape/figureBase';

const HeroBoard3D = dynamic(() => import('@/components/HeroBoard3D'), { ssr: false });

const COLORS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6'];
// Cache-bust for the figure PNGs — bump whenever a cut-out is re-cut so the gallery (and
// browser) fetch the new image instead of a stale same-named copy.
const IMG_V = '20260618e';

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

type Tile = { key: string; cardId: string; index: number; color: string; name: string; label: string; src: string; fallbackSrc?: string };

function FigureTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let triedFallback = false;
    const img = new Image();
    const draw = () => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const TW = cv.width, TH = cv.height;
      ctx.clearRect(0, 0, TW, TH);
      const W = img.width, H = img.height;
      const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
      const ox = oc.getContext('2d', { willReadFrequently: true });
      if (!ox) return;
      ox.drawImage(img, 0, 0);
      const d = ox.getImageData(0, 0, W, H).data;
      // Same auto base-crop rule as the 3D board (figureBase.analyzeCut), so the gallery
      // matches the board.
      const { top, bottom: bot, left: lft, right: rgt, clip, baseCenterX } = analyzeCut(d, W, H, cropOverride(tile.cardId, tile.index));
      const figH = bot - top;
      const cutY = Math.round(bot - clip * figH);
      const baseCx = baseCenterX * W;
      const visW = rgt - lft + 1, visH = cutY - top + 1;
      const discCy = TH - 62, discRx = TW * 0.4, discRy = 22;
      const sc = Math.min((TW - 28) / visW, (discCy - 18) / visH);
      const feetTileX = TW / 2; // centre the BASE on the disc (overhang is fine), matching the board
      const dx = feetTileX - (baseCx - lft) * sc;
      const dy = discCy - visH * sc;
      ctx.fillStyle = shade(tile.color, 0.6); ctx.beginPath(); ctx.ellipse(TW / 2, discCy + 9, discRx, discRy, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tile.color; ctx.beginPath(); ctx.ellipse(TW / 2, discCy, discRx, discRy, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(img, lft, top, visW, visH, dx, dy, visW * sc, visH * sc);
    };
    img.onload = draw;
    img.onerror = () => { if (!triedFallback && tile.fallbackSrc) { triedFallback = true; img.src = tile.fallbackSrc; } };
    img.src = tile.src;
  }, [tile]);
  return <canvas ref={ref} width={400} height={440} style={{ width: '100%', height: 'auto', display: 'block' }} />;
}

// One flat grass hex cluster, registered once, for the click-to-open 3D inspector.
function ensureSoloMap() {
  if (MAPS['__solo__']) return;
  const cells: Record<string, HexCell> = {};
  for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) cells[`${q},${r}`] = { q, r, height: 1, terrain: 'grass' };
  MAPS['__solo__'] = { id: '__solo__', name: 'Solo', cols: 3, rows: 3, cells, startZones: {}, glyphSpots: [], glyphs: [] };
}

function FigureModal({ tile, onClose }: { tile: Tile; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const state = useMemo<HSState>(() => {
    ensureSoloMap();
    const cards = [{ uid: `s-${tile.cardId}`, cardId: tile.cardId, ownerSeat: 0, orderMarkers: [], attackMod: 0, defenseMod: 0 }];
    // Double-space (baseSize 2) figures occupy a 2nd hex so the inspector shows their
    // 2-hex peanut disc, not a single-hex circle.
    const big = (HS_CARDS[tile.cardId]?.baseSize ?? 1) === 2;
    const figures = [{ id: `s-${tile.cardId}-${tile.index}`, cardUid: `s-${tile.cardId}`, ownerSeat: 0, at: '1,1', at2: big ? '2,1' : undefined, index: tile.index, wounds: 0 }];
    const players = [{ seat: 0, playerId: 's0', username: 'P', accent_color: tile.color }];
    return { mapId: '__solo__', players, cards, figures, glyphs: [] } as unknown as HSState;
  }, [tile]);
  return (
    <div className="fixed inset-0 z-50 bg-neutral-200/95 p-3 sm:p-6" onClick={onClose}>
      <div className="mx-auto flex h-full max-w-5xl flex-col" onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between text-neutral-800">
          <div className="text-sm font-medium">{tile.name} <span className="text-neutral-500">· {tile.label} · crop {cropOverride(tile.cardId, tile.index) ?? 'auto'}</span></div>
          <button onClick={onClose} className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-100">Close ✕</button>
        </div>
        <div className="min-h-0 flex-1">
          <HeroBoard3D state={state} bg="bg-gradient-to-b from-white to-neutral-200" />
        </div>
      </div>
    </div>
  );
}

export default function HeroScapeSandbox() {
  const [sel, setSel] = useState<Tile | null>(null);
  // All 1-hex figures first, then all 2-hex (double-space), each group A→Z by name.
  const units = Object.values(HS_CARDS)
    .filter(c => c.type === 'squad' || c.type === 'hero')
    .sort((a, b) => ((a.baseSize ?? 1) - (b.baseSize ?? 1)) || a.name.localeCompare(b.name));
  const tiles: Tile[] = units.flatMap((c, ci) => {
    const color = COLORS[ci % COLORS.length];
    const isSquad = c.type === 'squad';
    return Array.from({ length: Math.max(1, c.figures) }, (_, k) => {
      const idx = k + 1;
      return {
        key: `${c.id}-${idx}`,
        cardId: c.id,
        index: idx,
        color,
        name: c.figures > 1 ? `${c.name} #${idx}` : c.name,
        label: isSquad ? `${c.id}-${idx}` : c.id,
        src: isSquad ? `/heroscape/figures/${c.id}-${idx}.png?v=${IMG_V}` : `/heroscape/figures/${c.id}.png?v=${IMG_V}`,
        fallbackSrc: isSquad ? `/heroscape/figures/${c.id}.png?v=${IMG_V}` : undefined,
      };
    });
  });
  return (
    <main className="min-h-screen bg-white p-4 text-neutral-900">
      <h1 className="text-lg font-semibold">HeroScape figure gallery</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Every figure ({tiles.length} total, squads expanded) cropped and seated on its player disc. Click any figure to open it on a hex in the real 3D board (orbit/zoom). Crop value is under each — tell me which to nudge.
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {tiles.map(t => (
          <button
            key={t.key}
            onClick={() => setSel(t)}
            className="rounded-lg border border-neutral-200 bg-white p-2 text-center transition hover:border-sky-500 hover:bg-neutral-50"
            title={`Open ${t.name} in 3D`}
          >
            <FigureTile tile={t} />
            <div className="mt-1 truncate text-xs font-medium text-neutral-800">{t.name}</div>
            <div className="text-[11px] text-neutral-500">{t.label} · crop {cropOverride(t.cardId, t.index) ?? 'auto'}</div>
          </button>
        ))}
      </div>
      {sel && <FigureModal tile={sel} onClose={() => setSel(null)} />}
    </main>
  );
}
