'use client';
// HeroScape CARD-ART CROP PICKER (dev tool). The play/draft card shows each `cards/<id>.jpg`
// in a ~40%-wide art box via CSS background-size/position (see HeroScapeBoard `CARD_ART_CROP`).
// This page lets you frame each card VISUALLY: the FULL scan is shown large on the left; DRAG A BOX
// over the figure (the box is locked to the card's portrait aspect) and that region becomes the card
// art. A live preview + a copy-ready `CARD_ART_CROP` block on the right. Work autosaves to localStorage.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { HS_CARDS, CARD_IDENTITY } from '@/lib/games/heroscape';

// The card art box is a portrait rectangle (~40% of the card width, full body height). The crop box
// is locked to this width/height ratio so what you draw is exactly what shows.
const CARD_ASPECT = 0.72;
const LS_KEY = 'hs_cardcrop_v2';

type Rect = { fx: number; fy: number; fw: number; fh: number }; // fractions of the image (0..1)
const CARDS = Object.keys(HS_CARDS).sort((a, b) => HS_CARDS[a].name.localeCompare(HS_CARDS[b].name));
// Crop from the FULL card render (banner + figure + stats + power text) so there's real framing room.
// The game shows your crop of this same image (HtmlCardHeader uses cards-full/<id>.jpg when a crop exists).
const jpg = (id: string) => `/heroscape/cards-full/${id}.jpg`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A crop rectangle → the CSS background-size / position that shows exactly that region in the box. */
function cssOf(c: Rect | null): { size: string; position: string } {
  if (!c) return { size: 'cover', position: 'center' };
  const size = `${(100 / c.fw).toFixed(1)}%`;
  const posX = c.fw < 0.999 ? (c.fx / (1 - c.fw)) * 100 : 50;
  const posY = c.fh < 0.999 ? (c.fy / (1 - c.fh)) * 100 : 50;
  return { size, position: `${posX.toFixed(1)}% ${posY.toFixed(1)}%` };
}

export default function CardCropPicker() {
  const [crops, setCrops] = useState<Record<string, Rect>>({});
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null); // live box while dragging
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; rw: number; rh: number } | null>(null);

  const id = CARDS[i];
  const def = HS_CARDS[id];
  const ident = CARD_IDENTITY[id];
  const crop = crops[id] ?? null;
  const overlay = marquee ?? crop; // what rectangle to draw on the image
  const css = cssOf(crop);

  // Load / persist work so a long framing session survives a refresh.
  useEffect(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) setCrops(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(crops)); } catch { /* ignore */ }
  }, [crops]);

  // --- Drag a crop box on the full image (locked to CARD_ASPECT) ---------------
  const onDown = (e: React.PointerEvent) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { x: clamp(e.clientX - r.left, 0, r.width), y: clamp(e.clientY - r.top, 0, r.height), rw: r.width, rh: r.height };
    setMarquee({ fx: drag.current.x / r.width, fy: drag.current.y / r.height, fw: 0, fh: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const s = drag.current, r = imgRef.current?.getBoundingClientRect();
    if (!s || !r) return;
    const cx = clamp(e.clientX - r.left, 0, s.rw), cy = clamp(e.clientY - r.top, 0, s.rh);
    const dx = cx - s.x, dy = cy - s.y;
    const dirX = dx >= 0 ? 1 : -1, dirY = dy >= 0 ? 1 : -1;
    let w = Math.abs(dx), h = w / CARD_ASPECT; // lock height to width via the card aspect
    const maxW = dirX > 0 ? s.rw - s.x : s.x, maxH = dirY > 0 ? s.rh - s.y : s.y;
    if (w > maxW) { w = maxW; h = w / CARD_ASPECT; }
    if (h > maxH) { h = maxH; w = h * CARD_ASPECT; }
    const x0 = dirX > 0 ? s.x : s.x - w, y0 = dirY > 0 ? s.y : s.y - h;
    setMarquee({ fx: x0 / s.rw, fy: y0 / s.rh, fw: w / s.rw, fh: h / s.rh });
  };
  const onUp = () => {
    const m = marquee;
    drag.current = null;
    if (m && m.fw > 0.03 && m.fh > 0.03) setCrops(c => ({ ...c, [id]: m }));
    setMarquee(null);
  };

  const reset = () => setCrops(c => { const n = { ...c }; delete n[id]; return n; });
  const go = (d: number) => { setI(p => (p + d + CARDS.length) % CARDS.length); setMarquee(null); };

  const rows = [
    def?.species,
    `${def?.common ? 'Common' : 'Unique'} ${def?.type === 'hero' ? 'Hero' : 'Squad'}`,
    def?.unitClass,
    ident?.personality,
    ident?.world,
  ].filter(Boolean) as string[];

  const edited = useMemo(() => Object.entries(crops), [crops]);
  const exportText = useMemo(() => {
    if (!edited.length) return '// No crops yet — draw a box over a figure. Un-cropped cards use cover / center.';
    const body = edited.map(([cid, c]) => {
      const e = cssOf(c);
      const key = /^[a-z_][a-z0-9_]*$/.test(cid) ? cid : `'${cid}'`;
      return `  ${key}: { size: '${e.size}', position: '${e.position}' },`;
    }).join('\n');
    return `const CARD_ART_CROP: Record<string, { size: string; position: string }> = {\n${body}\n};`;
  }, [edited]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(exportText); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen bg-neutral-950 px-5 py-4 text-neutral-200">
      <div className="mx-auto max-w-[88rem]">
        <header className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-extrabold tracking-wide text-white">HeroScape · Card-art crop picker</h1>
          <span className="text-xs text-neutral-400">Drag a box over the figure on the full scan — that region becomes the card art. Then copy into <code className="text-amber-300">HeroScapeBoard.tsx</code>.</span>
          <Link href="/heroscape-mapmaker" className="ml-auto text-xs text-sky-400 hover:underline">⬡ HS maps</Link>
        </header>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          {/* ---- LEFT: the FULL scan, large, with a drag-to-crop box ---- */}
          <section>
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
              <span>{i + 1} / {CARDS.length} · <span className="font-mono text-neutral-200">{def?.name}</span></span>
              <span>{crop ? <span className="text-sky-400">cropped ✓ — drag again to re-frame</span> : 'drag a box to crop'}</span>
            </div>
            <div className="relative inline-block select-none overflow-hidden rounded-lg border border-neutral-700 bg-black">
              <img
                ref={imgRef}
                src={jpg(id)}
                alt={def?.name}
                draggable={false}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                className="block max-h-[78vh] w-auto cursor-crosshair touch-none"
              />
              {/* The crop box overlay (live while dragging, else the stored crop) + dimmed surround */}
              {overlay && overlay.fw > 0 && (
                <>
                  <div className="pointer-events-none absolute inset-0 bg-black/50" style={{
                    clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${overlay.fx * 100}% ${overlay.fy * 100}%, ${overlay.fx * 100}% ${(overlay.fy + overlay.fh) * 100}%, ${(overlay.fx + overlay.fw) * 100}% ${(overlay.fy + overlay.fh) * 100}%, ${(overlay.fx + overlay.fw) * 100}% ${overlay.fy * 100}%, ${overlay.fx * 100}% ${overlay.fy * 100}%)`,
                  }} />
                  <div className="pointer-events-none absolute border-2 border-sky-400 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" style={{
                    left: `${overlay.fx * 100}%`, top: `${overlay.fy * 100}%`, width: `${overlay.fw * 100}%`, height: `${overlay.fh * 100}%`,
                  }} />
                </>
              )}
            </div>
          </section>

          {/* ---- RIGHT: live preview + nav + export + thumbnails ---- */}
          <section className="space-y-3">
            {/* Live preview: the card header + the art box (CARD_ASPECT) showing the crop, beside the rows. */}
            <div className="overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-lg">
              <div className="flex items-center gap-1.5 border-b-2 border-amber-600/70 bg-neutral-900 px-2 py-1.5">
                {ident?.general && <span className="rounded bg-amber-700 px-1 py-0.5 text-[8px] font-bold uppercase text-white">{ident.general}</span>}
                <span className="truncate text-sm font-extrabold uppercase tracking-wide text-white">{def?.name}</span>
              </div>
              <div className="flex">
                <div className="w-2/5 shrink-0 bg-neutral-950" style={{ aspectRatio: String(CARD_ASPECT), backgroundImage: `url('${jpg(id)}')`, backgroundSize: css.size, backgroundPosition: css.position, backgroundRepeat: 'no-repeat' }} />
                <div className="w-3/5 space-y-0.5 bg-neutral-900 px-2 py-2 text-[10px] leading-tight text-neutral-300">
                  {rows.map((r, k) => <div key={k} className={k === 0 ? 'font-bold text-white' : ''}>{r}</div>)}
                  <div className="mt-1 border-t border-neutral-700 pt-1 font-mono text-[9px] text-neutral-400">L{def?.life} · M{def?.move} · R{def?.range} · A{def?.attack} · D{def?.defense}</div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => go(-1)} className="flex-1 rounded bg-neutral-800 py-1 text-xs hover:bg-neutral-700">◀ Prev</button>
              <button onClick={reset} className="rounded bg-rose-900/70 px-3 py-1 text-xs hover:bg-rose-800">Reset</button>
              <button onClick={() => go(1)} className="flex-1 rounded bg-neutral-800 py-1 text-xs hover:bg-neutral-700">Next ▶</button>
            </div>

            <div>
              <div className="mb-1 text-xs text-neutral-400">All cards — click to edit · <span className="text-sky-400">blue ring</span> = cropped</div>
              <div className="grid grid-cols-6 gap-1.5">
                {CARDS.map((cid, k) => {
                  const c = crops[cid] ?? null;
                  const e = cssOf(c);
                  return (
                    <button
                      key={cid}
                      onClick={() => { setI(k); setMarquee(null); }}
                      title={HS_CARDS[cid].name}
                      className={'relative aspect-[3/4] overflow-hidden rounded border ' + (k === i ? 'border-amber-400' : c ? 'border-sky-500' : 'border-neutral-800 hover:border-neutral-600')}
                      style={{ backgroundImage: `url('${jpg(cid)}')`, backgroundSize: e.size, backgroundPosition: e.position, backgroundRepeat: 'no-repeat' }}
                    >
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-0.5 text-[7px] text-white">{HS_CARDS[cid].shortName ?? HS_CARDS[cid].name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-neutral-400">{edited.length} crop{edited.length === 1 ? '' : 's'} — paste over <code className="text-amber-300">CARD_ART_CROP</code></span>
                <button onClick={copy} className="rounded bg-emerald-700 px-3 py-1 text-xs font-bold hover:bg-emerald-600">{copied ? '✓ Copied' : 'Copy'}</button>
              </div>
              <pre className="max-h-60 overflow-auto rounded-md border border-neutral-800 bg-black/50 p-3 text-[11px] leading-snug text-emerald-300">{exportText}</pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
