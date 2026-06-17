'use client';

// HeroScape FIGURE GALLERY — a flat, scrollable review of every figure. Each tile
// renders the cut-out CROPPED at its base line and seated on a player-colour disc,
// using the same crop + feet-centring math as the 3D board (figureBase.ts). Because
// the in-game figures are camera-facing billboards, this 2D front view matches the 3D
// look — but it scrolls instead of making you orbit a single board.

import { useEffect, useRef } from 'react';
import { HS_CARDS } from '@/lib/games/heroscape';
import { BASE_CROP, BASE_CROP_BY_CARD } from '@/lib/games/heroscape/figureBase';

const COLORS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6'];

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

function FigureTile({ cardId, color }: { cardId: string; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const img = new Image();
    img.onload = () => {
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
      const rowOp = (y: number) => { for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) return true; return false; };
      const colOp = (x: number) => { for (let y = 0; y < H; y++) if (d[(y * W + x) * 4 + 3] > 128) return true; return false; };
      let top = 0, bot = H - 1, lft = 0, rgt = W - 1;
      while (top < H - 1 && !rowOp(top)) top++;
      while (bot > 0 && !rowOp(bot)) bot--;
      while (lft < W - 1 && !colOp(lft)) lft++;
      while (rgt > 0 && !colOp(rgt)) rgt--;
      const clip = BASE_CROP_BY_CARD[cardId] ?? BASE_CROP;
      const figH = bot - top;
      const cutY = Math.round(bot - clip * figH); // crop line, in image rows
      // feet centroid (band just above the cut) → re-centre by HALF the offset (split)
      const bandTop = Math.max(top, Math.round(cutY - 0.1 * figH));
      let sx = 0, n = 0;
      for (let y = bandTop; y <= cutY; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) { sx += x; n++; }
      const baseCx = n ? sx / n : (lft + rgt) / 2;
      const visW = rgt - lft + 1, visH = cutY - top + 1;
      const discCy = TH - 62, discRx = TW * 0.4, discRy = 22;
      const sc = Math.min((TW - 28) / visW, (discCy - 18) / visH);
      const feetTileX = TW / 2 + (baseCx - W / 2) * sc * 0.5; // half-offset, like the board
      const dx = feetTileX - (baseCx - lft) * sc;
      const dy = discCy - visH * sc; // cut edge lands on the disc top
      // disc: a rim hint behind, then the colour top
      ctx.fillStyle = shade(color, 0.6); ctx.beginPath(); ctx.ellipse(TW / 2, discCy + 9, discRx, discRy, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(TW / 2, discCy, discRx, discRy, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(img, lft, top, visW, visH, dx, dy, visW * sc, visH * sc);
    };
    img.src = `/heroscape/figures/${cardId}.png`;
  }, [cardId, color]);
  return <canvas ref={ref} width={400} height={440} style={{ width: '100%', height: 'auto', display: 'block' }} />;
}

export default function HeroScapeSandbox() {
  const units = Object.values(HS_CARDS).filter(c => c.type === 'squad' || c.type === 'hero');
  return (
    <main className="min-h-screen bg-neutral-950 p-4 text-neutral-200">
      <h1 className="text-lg font-semibold">HeroScape figure gallery</h1>
      <p className="mb-4 text-sm text-neutral-400">
        Every figure cropped and seated on its player disc — scroll to review bases, crops, and centering. The crop value is under each; tell me which to nudge (higher = more base off, lower = keep more feet).
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {units.map((c, i) => (
          <div key={c.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-center">
            <FigureTile cardId={c.id} color={COLORS[i % COLORS.length]} />
            <div className="mt-1 truncate text-xs font-medium text-neutral-200" title={c.name}>{c.name}</div>
            <div className="text-[11px] text-neutral-500">{c.id} · crop {BASE_CROP_BY_CARD[c.id] ?? BASE_CROP}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
