'use client';

// HeroScape FIGURE GALLERY — a flat, scrollable review of every figure. Each tile
// renders the cut-out CROPPED at its base line and seated on a player-colour disc,
// using the same crop + feet-centring math as the 3D board (figureBase.ts). Because
// the in-game figures are camera-facing billboards, this 2D front view matches the 3D
// look — but it scrolls instead of making you orbit a single board. SQUADS expand to
// one tile PER FIGURE. CLICK a tile to open that figure on a hex in the real 3D board.

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { HS_CARDS, MAPS } from '@/lib/games/heroscape';
import type { HSState, HexCell } from '@/lib/games/heroscape';
import { analyzeCut, cropOverride, figureAnchor, figureSpan2 } from '@/lib/games/heroscape/figureBase';

const HeroBoard3D = dynamic(() => import('@/components/HeroBoard3D'), { ssr: false });

const COLORS = ['#ef4444', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6'];
// Cache-bust for the figure PNGs — bump whenever a cut-out is re-cut so the gallery (and
// browser) fetch the new image instead of a stale same-named copy.
const IMG_V = '20260701l';

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
      // The "black dot" anchor (if set) overrides: its Y is the cut line, its X the centre —
      // matching the 3D board's useOpaqueBoundsV so the gallery never drifts from the board.
      const anchor = figureAnchor(tile.cardId, tile.index);
      const cutY = anchor ? Math.round(anchor.y * H) : Math.round(bot - clip * figH);
      const baseCx = anchor ? anchor.x * W : baseCenterX * W;
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

// Cut-line PICKER on the RAW cut-out (moulded base still on) with a 0.1 grid. Same-origin
// <img>, full res. SINGLE figures: one click = cut line (y) + centre (x). DOUBLE (2-hex)
// figures: TWO clicks = FRONT (head) then BACK (tail) at the base — the board sizes the
// figure so those land on the two hex marks, centres by their midpoint, cuts at the lower.
function MeasureModal({ tile, onClose, onSave }: { tile: Tile; onClose: () => void; onSave: (label: string, snippet: string) => void }) {
  const isDouble = (HS_CARDS[tile.cardId]?.baseSize ?? 1) === 2;
  // Pre-load the CURRENTLY-set point(s) so you can see what's selected and nudge from there.
  const current = isDouble
    ? (() => { const s = figureSpan2(tile.cardId, tile.index); return s ? [{ x: s.fx, y: s.fy }, { x: s.bx, y: s.by }] : []; })()
    : (() => { const a = figureAnchor(tile.cardId, tile.index); return a ? [{ x: a.x, y: a.y }] : []; })();
  const [pts, setPts] = useState<{ x: number; y: number }[]>(current);
  const [pristine, setPristine] = useState(current.length > 0); // true = showing the saved value, not yet re-clicked
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const f = (n: number) => n.toFixed(2);
  const ready = isDouble ? pts.length === 2 : pts.length === 1;
  const snippet = !ready ? ''
    : isDouble ? `'${tile.label}': { fx: ${f(pts[0].x)}, fy: ${f(pts[0].y)}, bx: ${f(pts[1].x)}, by: ${f(pts[1].y)} },`
      : `'${tile.label}': { x: ${f(pts[0].x)}, y: ${f(pts[0].y)} },`;
  const hint = pristine
    ? 'showing the current pick — click to re-pick'
    : isDouble
      ? (pts.length === 0 ? 'click where it sits over the FRONT hex mark (head/tail overhang)' : pts.length === 1 ? 'now over the BACK hex mark' : 'click to redo — front first')
      : 'click where the feet meet the base';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/85 p-4" onClick={onClose}>
      <div className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="mb-2 text-center text-sm text-neutral-200">{tile.name} {isDouble && <span className="rounded bg-amber-500/30 px-1 text-amber-200">2-hex</span>} — {hint}</div>
        <div
          className="relative mx-auto select-none"
          style={{ maxWidth: 460, cursor: 'crosshair', backgroundColor: '#9a9a9a', backgroundImage: 'conic-gradient(#8f8f8f 25%, #aaaaaa 0 50%, #8f8f8f 0 75%, #aaaaaa 0)', backgroundSize: '24px 24px' }}
          onClick={e => {
            const r = e.currentTarget.getBoundingClientRect();
            const p = { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
            setPts(prev => { const base = pristine ? [] : prev; return !isDouble ? [p] : base.length >= 2 ? [p] : [...base, p]; });
            setPristine(false);
            setSaved(false);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tile.src} alt={tile.name} className="pointer-events-none block h-auto w-full" />
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(y => (
            <div key={y} className="pointer-events-none absolute left-0 right-0" style={{ top: `${y}%`, borderTop: '1px solid rgba(0,0,0,0.25)' }}>
              <span className="absolute left-0 top-0 -translate-y-1/2 rounded bg-white/70 px-1 text-[10px] text-neutral-900">{(y / 100).toFixed(1)}</span>
            </div>
          ))}
          {!isDouble && pts.length === 1 && (
            <>
              <div className="pointer-events-none absolute left-0 right-0" style={{ top: `${pts[0].y * 100}%`, borderTop: '2px solid #ff3b3b' }} />
              <div className="pointer-events-none absolute bottom-0 top-0" style={{ left: `${pts[0].x * 100}%`, borderLeft: '2px solid #18b6d6' }} />
            </>
          )}
          {isDouble && pts.length === 2 && (
            <div className="pointer-events-none absolute" style={{ left: `${Math.min(pts[0].x, pts[1].x) * 100}%`, width: `${Math.abs(pts[0].x - pts[1].x) * 100}%`, top: `${Math.max(pts[0].y, pts[1].y) * 100}%`, borderTop: '2px solid #ff3b3b' }} />
          )}
          {pts.map((p, i) => (
            <div key={i} className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-900" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, background: i === 0 ? '#ffd000' : '#22d3ee' }} />
          ))}
        </div>
        <div className="mt-2 text-center text-sm text-neutral-100">
          {ready ? <>{pristine && <span className="text-neutral-400">current · </span>}<code className="select-all rounded bg-neutral-800 px-2 py-1 text-[12px] text-emerald-300">{snippet}</code></> : <span className="text-neutral-400">{hint}</span>}
        </div>
        <div className="mt-3 flex justify-center gap-2">
          {ready && (
            <button
              onClick={() => { onSave(tile.label, snippet); setSaved(true); }}
              className={`rounded-md border px-3 py-1 text-sm text-white ${saved ? 'border-emerald-600 bg-emerald-700' : 'border-emerald-500 bg-emerald-600 hover:bg-emerald-500'}`}
            >
              {saved ? 'Saved ✓' : 'Save pick'}
            </button>
          )}
          <button onClick={onClose} className="rounded-md border border-neutral-600 bg-neutral-800 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-700">Close ✕</button>
        </div>
      </div>
    </div>
  );
}

// WHITE-ERASER on the cut-out. Click a leftover-backdrop blob → FLOOD-erase it (alpha→0),
// bounded by RGB distance from the clicked colour so it stops at the painted figure (the same
// algorithm as heroscape-extract/floodseed.mjs). A BRUSH cleans up bits the flood misses.
// Edits the SAME PNG the board uses (full res, same-origin so the canvas isn't tainted) → what
// you see is what ships. Download the cleaned PNG; it gets dropped into public/heroscape/figures/.
function EraseModal({ tile, onClose }: { tile: Tile; onClose: () => void }) {
  const dispRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<Uint8ClampedArray | null>(null); // pristine pixels (for Reset)
  const workRef = useRef<ImageData | null>(null);          // current working pixels
  const dim = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const undo = useRef<Uint8ClampedArray[]>([]);
  const drawing = useRef(false);
  const [tol, setTol] = useState(55);
  const [mode, setMode] = useState<'flood' | 'brush' | 'restore'>('flood');
  const [brushR, setBrushR] = useState(16);
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [count, setCount] = useState(0);
  const [aspect, setAspect] = useState(1); // W/H of the loaded image → scale the canvas up to fill the screen

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const paint = () => {
    const cv = dispRef.current, work = workRef.current;
    if (!cv || !work) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.putImageData(work, 0, 0);
  };

  useEffect(() => {
    let tried = false;
    const img = new Image();
    const load = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
      const ox = oc.getContext('2d', { willReadFrequently: true }); if (!ox) return;
      ox.drawImage(img, 0, 0);
      const id = ox.getImageData(0, 0, W, H);
      baseRef.current = new Uint8ClampedArray(id.data);
      workRef.current = id;
      dim.current = { w: W, h: H };
      setAspect(W / H);
      const cv = dispRef.current; if (cv) { cv.width = W; cv.height = H; }
      undo.current = []; setCount(0); setLoaded(true);
      paint();
    };
    img.onload = load;
    img.onerror = () => { if (!tried && tile.fallbackSrc) { tried = true; img.src = tile.fallbackSrc; } };
    img.src = tile.src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile]);

  const snapshot = () => { const work = workRef.current; if (!work) return; undo.current.push(new Uint8ClampedArray(work.data)); if (undo.current.length > 12) undo.current.shift(); };

  const at = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const cv = dispRef.current; const { w: W, h: H } = dim.current;
    if (!cv) return { x: 0, y: 0 };
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * W);
    const y = Math.floor((e.clientY - r.top) / r.height * H);
    return { x: Math.max(0, Math.min(W - 1, x)), y: Math.max(0, Math.min(H - 1, y)) };
  };

  // Brush radius in BITMAP px = the on-screen radius (brushR) scaled up by how much the canvas
  // is shrunk to fit. Without this, the brush is only a few px on a big figure and Restore/Erase
  // feel like they do nothing.
  const bmRadius = () => { const cv = dispRef.current; if (!cv) return brushR; const r = cv.getBoundingClientRect(); return r.width ? Math.max(1, Math.round(brushR * dim.current.w / r.width)) : brushR; };

  const flood = (sx: number, sy: number) => {
    const work = workRef.current; if (!work) return;
    const { w: W, h: H } = dim.current; const d = work.data; const N = W * H;
    const p0 = (sy * W + sx) * 4; if (d[p0 + 3] < 40) return; // already transparent
    const sr = d[p0], sg = d[p0 + 1], sb = d[p0 + 2]; const t2 = tol * tol;
    snapshot();
    const seen = new Uint8Array(N); const st: number[] = [sy * W + sx]; seen[sy * W + sx] = 1; let n = 0;
    const ok = (q: number) => { if (seen[q] || d[q * 4 + 3] < 40) return false; const dr = d[q * 4] - sr, dg = d[q * 4 + 1] - sg, db = d[q * 4 + 2] - sb; return dr * dr + dg * dg + db * db <= t2; };
    while (st.length) {
      const p = st.pop() as number; d[p * 4 + 3] = 0; n++; const x = p % W;
      if (x > 0 && ok(p - 1)) { seen[p - 1] = 1; st.push(p - 1); }
      if (x < W - 1 && ok(p + 1)) { seen[p + 1] = 1; st.push(p + 1); }
      if (p - W >= 0 && ok(p - W)) { seen[p - W] = 1; st.push(p - W); }
      if (p + W < N && ok(p + W)) { seen[p + W] = 1; st.push(p + W); }
    }
    paint(); setCount(c => c + n);
  };

  const brush = (sx: number, sy: number) => {
    const work = workRef.current; if (!work) return;
    const { w: W, h: H } = dim.current; const d = work.data; const r = bmRadius(), r2 = r * r;
    for (let y = Math.max(0, sy - r); y <= Math.min(H - 1, sy + r); y++)
      for (let x = Math.max(0, sx - r); x <= Math.min(W - 1, sx + r); x++) { const dx = x - sx, dy = y - sy; if (dx * dx + dy * dy <= r2) d[(y * W + x) * 4 + 3] = 0; }
    paint();
  };

  // Restore brush — paint the ORIGINAL pixels (baseRef) back, so an over-eager flood/erase can
  // be repaired locally without Reset wiping all your other erases.
  const restore = (sx: number, sy: number) => {
    const work = workRef.current, base = baseRef.current; if (!work || !base) return;
    const { w: W, h: H } = dim.current; const d = work.data; const r = bmRadius(), r2 = r * r;
    for (let y = Math.max(0, sy - r); y <= Math.min(H - 1, sy + r); y++)
      for (let x = Math.max(0, sx - r); x <= Math.min(W - 1, sx + r); x++) { const dx = x - sx, dy = y - sy; if (dx * dx + dy * dy <= r2) { const i = (y * W + x) * 4; d[i] = base[i]; d[i + 1] = base[i + 1]; d[i + 2] = base[i + 2]; d[i + 3] = base[i + 3]; } }
    paint();
  };

  const stroke = (x: number, y: number) => { if (mode === 'restore') restore(x, y); else brush(x, y); };
  const onDown = (e: ReactMouseEvent<HTMLCanvasElement>) => { const { x, y } = at(e); if (mode === 'flood') { flood(x, y); return; } drawing.current = true; snapshot(); stroke(x, y); };
  const onMove = (e: ReactMouseEvent<HTMLCanvasElement>) => { if (mode !== 'flood') setCur({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); if (mode !== 'flood' && drawing.current) { const { x, y } = at(e); stroke(x, y); } };
  const onUp = () => { drawing.current = false; };
  const onLeave = () => { drawing.current = false; setCur(null); };
  const doUndo = () => { const prev = undo.current.pop(); const work = workRef.current; if (prev && work) { work.data.set(prev); paint(); } };
  const doReset = () => { const base = baseRef.current, work = workRef.current; if (base && work) { work.data.set(base); undo.current = []; setCount(0); paint(); } };
  const download = () => { const cv = dispRef.current; if (!cv) return; cv.toBlob(b => { if (!b) return; const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${tile.label}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }, 'image/png'); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/85 p-4" onClick={onClose}>
      <div className="flex max-h-[98vh] w-full max-w-[98vw] flex-col overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="mb-2 text-center text-sm text-neutral-200">
          {tile.name} — {mode === 'flood' ? 'click each white blob to erase it' : mode === 'brush' ? 'drag to erase' : 'drag over an erased (checkered) area to bring it back'}
          {!loaded && <span className="text-neutral-400"> · loading…</span>}
        </div>
        <div className="relative mx-auto w-fit">
          <canvas
            ref={dispRef}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onLeave}
            className="block select-none"
            style={{ width: `min(96vw, ${(aspect * 80).toFixed(1)}vh)`, height: 'auto', maxWidth: '96vw', maxHeight: '80vh', cursor: mode === 'flood' ? 'crosshair' : 'none', backgroundColor: '#9a9a9a', backgroundImage: 'conic-gradient(#8f8f8f 25%, #aaaaaa 0 50%, #8f8f8f 0 75%, #aaaaaa 0)', backgroundSize: '24px 24px' }}
          />
          {cur && mode !== 'flood' && (
            <div className="pointer-events-none absolute rounded-full" style={{ left: cur.x - brushR, top: cur.y - brushR, width: brushR * 2, height: brushR * 2, border: mode === 'restore' ? '2px solid #34d399' : '2px solid #f87171', boxShadow: '0 0 0 1px rgba(0,0,0,0.7)' }} />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm text-neutral-200">
          <button onClick={() => setMode('flood')} className={`rounded-md border px-2 py-1 ${mode === 'flood' ? 'border-sky-400 bg-sky-700 text-white' : 'border-neutral-600 bg-neutral-800'}`}>🪣 Flood</button>
          <button onClick={() => setMode('brush')} className={`rounded-md border px-2 py-1 ${mode === 'brush' ? 'border-sky-400 bg-sky-700 text-white' : 'border-neutral-600 bg-neutral-800'}`}>🖌 Erase</button>
          <button onClick={() => setMode('restore')} className={`rounded-md border px-2 py-1 ${mode === 'restore' ? 'border-emerald-400 bg-emerald-700 text-white' : 'border-neutral-600 bg-neutral-800'}`}>↩ Restore</button>
          {mode === 'flood'
            ? <label className="flex items-center gap-1">spread {tol}<input type="range" min={10} max={120} value={tol} onChange={e => setTol(+e.target.value)} /></label>
            : <label className="flex items-center gap-1">brush {brushR}px<input type="range" min={4} max={60} value={brushR} onChange={e => setBrushR(+e.target.value)} /></label>}
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button onClick={doUndo} className="rounded-md border border-neutral-600 bg-neutral-800 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-700">↶ Undo</button>
          <button onClick={doReset} className="rounded-md border border-neutral-600 bg-neutral-800 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-700">Reset</button>
          <button onClick={download} className="rounded-md border border-emerald-500 bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-500">⬇ Download PNG</button>
          <button onClick={onClose} className="rounded-md border border-neutral-600 bg-neutral-800 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-700">Close ✕</button>
        </div>
        <div className="mt-1 text-center text-[11px] text-neutral-400">erased {count.toLocaleString()} px · saves as <code className="text-neutral-300">{tile.label}.png</code> (drop it back to me)</div>
      </div>
    </div>
  );
}

export default function HeroScapeSandbox() {
  const [sel, setSel] = useState<Tile | null>(null);
  const [measure, setMeasure] = useState(false);
  const [measTile, setMeasTile] = useState<Tile | null>(null);
  const [erase, setErase] = useState(false);
  const [eraseTile, setEraseTile] = useState<Tile | null>(null);
  // Picks accumulate (localStorage-backed) so you can mark several figures, then "Copy all"
  // one block to paste back — the deployed app can't write source, so chat is the hand-off.
  const [picks, setPicks] = useState<Record<string, string>>({});
  useEffect(() => { try { const s = localStorage.getItem('hs_anchor_picks2'); if (s) setPicks(JSON.parse(s)); } catch { /* ignore */ } }, []);
  const savePick = (label: string, snippet: string) => setPicks(prev => {
    const next = { ...prev, [label]: snippet };
    try { localStorage.setItem('hs_anchor_picks2', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const clearPicks = () => { setPicks({}); try { localStorage.removeItem('hs_anchor_picks2'); } catch { /* ignore */ } };
  const picksText = Object.values(picks).join('\n');
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
      <p className="mb-2 text-sm text-neutral-600">
        Every figure ({tiles.length} total, squads expanded) cropped and seated on its player disc.{' '}
        {erase ? 'White eraser ON: click a figure, then click each leftover-white blob to flood-erase it (brush for the rest), and Download the cleaned PNG to send back.' : measure ? 'Cut-line picker ON: click a figure, then click where its feet meet the base — it prints the anchor to paste back.' : 'Click any figure to open it on a hex in the real 3D board (orbit/zoom).'}
      </p>
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur">
        <span className="mr-1 text-sm font-semibold text-neutral-800">Figure gallery</span>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-700">
          <input type="checkbox" checked={measure} onChange={e => { setMeasure(e.target.checked); if (e.target.checked) setErase(false); }} />
          Cut-line picker
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-700">
          <input type="checkbox" checked={erase} onChange={e => { setErase(e.target.checked); if (e.target.checked) setMeasure(false); }} />
          White eraser
        </label>
      </div>
      {Object.keys(picks).length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="mb-1 font-medium text-amber-900">{Object.keys(picks).length} pick(s) saved — paste into chat to lock in &amp; redeploy</div>
          <pre className="overflow-x-auto whitespace-pre rounded bg-white p-2 text-[12px] text-neutral-800">{picksText}</pre>
          <div className="mt-2 flex gap-2">
            <button onClick={() => navigator.clipboard?.writeText(picksText)} className="rounded-md border border-amber-400 bg-white px-3 py-1 hover:bg-amber-100">Copy all</button>
            <button onClick={clearPicks} className="rounded-md border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100">Clear</button>
          </div>
        </div>
      )}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {tiles.map(t => {
          // Status "light": BLUE = this figure has a saved cut-line pick (a committed
          // FIGURE_ANCHOR / FIGURE_SPAN2, or one picked this session); RED = still needs one.
          const hasPick = !!(figureAnchor(t.cardId, t.index) || figureSpan2(t.cardId, t.index) || picks[t.label]);
          return (
            <button
              key={t.key}
              onClick={() => (erase ? setEraseTile(t) : measure ? setMeasTile(t) : setSel(t))}
              className={`relative rounded-lg border bg-white p-2 text-center transition hover:bg-neutral-50 ${erase ? 'border-rose-300 hover:border-rose-500' : measure ? 'border-amber-300 hover:border-amber-500' : 'border-neutral-200 hover:border-sky-500'}`}
              title={erase ? `Erase white on ${t.name}` : measure ? `Pick cut line for ${t.name}` : `Open ${t.name} in 3D`}
            >
              <span
                className="absolute bottom-1.5 left-1.5 z-10 h-2.5 w-2.5 rounded-full ring-1 ring-black/25"
                style={{ background: hasPick ? '#3b82f6' : '#ef4444' }}
                title={hasPick ? 'cut line saved' : 'no cut-line pick yet'}
              />
              <FigureTile tile={t} />
              <div className="mt-1 truncate text-xs font-medium text-neutral-800">{t.name}</div>
              <div className="text-[11px] text-neutral-500">{t.label} · crop {cropOverride(t.cardId, t.index) ?? 'auto'}</div>
            </button>
          );
        })}
      </div>
      {sel && <FigureModal tile={sel} onClose={() => setSel(null)} />}
      {measTile && <MeasureModal tile={measTile} onClose={() => setMeasTile(null)} onSave={savePick} />}
      {eraseTile && <EraseModal tile={eraseTile} onClose={() => setEraseTile(null)} />}
    </main>
  );
}
