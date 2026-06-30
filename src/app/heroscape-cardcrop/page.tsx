'use client';
// HeroScape CARD-ART CROP PICKER (dev tool). The play/draft card shows each `cards-full/<id>.jpg`
// (the FULL card render) in a ~40%-wide art box via CSS background-size/position (HeroScapeBoard
// `CARD_ART_CROP`). This page is a FIXED crop FRAME (locked to the card's portrait aspect): DRAG the
// card behind it to position the figure, SCROLL or the slider to zoom. What's in the frame is exactly
// what the card shows. Copy the result into HeroScapeBoard.tsx. Work autosaves to localStorage.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { HS_CARDS, CARD_IDENTITY } from '@/lib/games/heroscape';

const CARD_ASPECT = 0.72;        // the in-game art box, width / height
const IMG_ASPECT = 936 / 1512;   // every cards-full render is this size
const LS_KEY = 'hs_cardcrop_v3';

type Crop = { zoom: number; x: number; y: number }; // background-size %, position x/y %
const NEW: Crop = { zoom: 135, x: 30, y: 26 };        // a sane figure-ish starting view; you then drag/zoom
const CARDS = Object.keys(HS_CARDS).sort((a, b) => HS_CARDS[a].name.localeCompare(HS_CARDS[b].name));
const jpg = (id: string) => `/heroscape/cards-full/${id}.jpg`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const cssOf = (c: Crop | null): { size: string; position: string } =>
  c ? { size: `${c.zoom.toFixed(1)}%`, position: `${c.x.toFixed(1)}% ${c.y.toFixed(1)}%` } : { size: 'contain', position: 'center' };

export default function CardCropPicker() {
  const [crops, setCrops] = useState<Record<string, Crop>>({});
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ px: number; py: number; base: Crop } | null>(null);

  const id = CARDS[i];
  const def = HS_CARDS[id];
  const ident = CARD_IDENTITY[id];
  const crop = crops[id] ?? null;
  const css = cssOf(crop);

  useEffect(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) setCrops(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(crops)); } catch { /* ignore */ }
  }, [crops]);

  // --- Drag the card behind the fixed frame (pan) + scroll/slider (zoom) -------
  const onDown = (e: React.PointerEvent) => {
    const base = crops[id] ?? NEW;
    if (!crops[id]) setCrops(c => ({ ...c, [id]: base }));
    dragRef.current = { px: e.clientX, py: e.clientY, base };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current, f = frameRef.current;
    if (!d || !f) return;
    const fw = f.clientWidth, fh = f.clientHeight;
    const dispW = fw * d.base.zoom / 100, dispH = dispW / IMG_ASPECT;
    const ovW = Math.max(1, dispW - fw), ovH = Math.max(1, dispH - fh);
    const x = clamp(d.base.x - (e.clientX - d.px) / ovW * 100, 0, 100);
    const y = clamp(d.base.y - (e.clientY - d.py) / ovH * 100, 0, 100);
    setCrops(c => ({ ...c, [id]: { ...d.base, x, y } }));
  };
  const onUp = () => { dragRef.current = null; };
  const setZoom = (z: number) => setCrops(c => ({ ...c, [id]: { ...(c[id] ?? NEW), zoom: clamp(z, 100, 500) } }));
  const onWheel = (e: React.WheelEvent) => { setZoom((crops[id] ?? NEW).zoom * (1 - e.deltaY * 0.0012)); };

  const reset = () => setCrops(c => { const n = { ...c }; delete n[id]; return n; });
  const go = (d: number) => setI(p => (p + d + CARDS.length) % CARDS.length);

  const rows = [
    def?.species,
    `${def?.common ? 'Common' : 'Unique'} ${def?.type === 'hero' ? 'Hero' : 'Squad'}`,
    def?.unitClass,
    ident?.personality,
    ident?.world,
  ].filter(Boolean) as string[];

  const edited = useMemo(() => Object.entries(crops), [crops]);
  const exportText = useMemo(() => {
    if (!edited.length) return '// No crops yet — drag a card behind the frame. Un-cropped cards use the existing portrait.';
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
      <div className="mx-auto max-w-[80rem]">
        <header className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-extrabold tracking-wide text-white">HeroScape · Card-art crop picker</h1>
          <span className="text-xs text-neutral-400">DRAG the card behind the frame to position the figure · SCROLL or the slider to zoom. The frame IS the card art.</span>
          <Link href="/heroscape-mapmaker" className="ml-auto text-xs text-sky-400 hover:underline">⬡ HS maps</Link>
        </header>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[auto_1fr]">
          {/* ---- LEFT: the FIXED crop frame — drag the card inside it ---- */}
          <section>
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
              <span>{i + 1} / {CARDS.length} · <span className="font-mono text-neutral-200">{def?.name}</span></span>
              <span>{crop ? <span className="text-sky-400">cropped ✓</span> : 'drag to frame the figure'}</span>
            </div>
            <div
              ref={frameRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onWheel={onWheel}
              className="relative cursor-move touch-none overflow-hidden rounded-lg border-2 border-sky-500 bg-black shadow-lg"
              style={{ height: 'min(76vh, 620px)', aspectRatio: CARD_ASPECT, backgroundImage: `url('${jpg(id)}')`, backgroundSize: css.size, backgroundPosition: css.position, backgroundRepeat: 'no-repeat' }}
            >
              {/* subtle frame corners so the fixed box reads clearly */}
              <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/20" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-neutral-400">Zoom</span>
              <input type="range" min={100} max={400} step={1} value={Math.round((crop ?? NEW).zoom)} onChange={e => setZoom(+e.target.value)} className="flex-1 accent-sky-500" />
              <span className="w-12 text-right font-mono text-[11px] text-neutral-300">{Math.round((crop ?? NEW).zoom)}%</span>
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={() => go(-1)} className="flex-1 rounded bg-neutral-800 py-1 text-xs hover:bg-neutral-700">◀ Prev</button>
              <button onClick={reset} className="rounded bg-rose-900/70 px-3 py-1 text-xs hover:bg-rose-800">Reset</button>
              <button onClick={() => go(1)} className="flex-1 rounded bg-neutral-800 py-1 text-xs hover:bg-neutral-700">Next ▶</button>
            </div>
          </section>

          {/* ---- RIGHT: how it looks on the card + thumbnails + export ---- */}
          <section className="space-y-3">
            <div className="overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-lg">
              <div className="flex items-center gap-1.5 border-b-2 border-amber-600/70 bg-neutral-900 px-2 py-1.5">
                {ident?.general && <span className="rounded bg-amber-700 px-1 py-0.5 text-[8px] font-bold uppercase text-white">{ident.general}</span>}
                <span className="truncate text-sm font-extrabold uppercase tracking-wide text-white">{def?.name}</span>
              </div>
              <div className="flex">
                <div className="w-2/5 shrink-0 bg-neutral-950" style={{ aspectRatio: CARD_ASPECT, backgroundImage: `url('${jpg(id)}')`, backgroundSize: css.size, backgroundPosition: css.position, backgroundRepeat: 'no-repeat' }} />
                <div className="w-3/5 space-y-0.5 bg-neutral-900 px-2 py-2 text-[10px] leading-tight text-neutral-300">
                  {rows.map((r, k) => <div key={k} className={k === 0 ? 'font-bold text-white' : ''}>{r}</div>)}
                  <div className="mt-1 border-t border-neutral-700 pt-1 font-mono text-[9px] text-neutral-400">L{def?.life} · M{def?.move} · R{def?.range} · A{def?.attack} · D{def?.defense}</div>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-neutral-400">All cards — click to edit · <span className="text-sky-400">blue ring</span> = cropped</div>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                {CARDS.map((cid, k) => {
                  const c = crops[cid] ?? null;
                  const e = cssOf(c);
                  return (
                    <button
                      key={cid}
                      onClick={() => setI(k)}
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
              <pre className="max-h-56 overflow-auto rounded-md border border-neutral-800 bg-black/50 p-3 text-[11px] leading-snug text-emerald-300">{exportText}</pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
