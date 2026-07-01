'use client';
// HeroScape CARD-ART CROP PICKER (dev tool). The play/draft card shows each `cards-full/<id>.jpg`
// (the FULL card render) in a ~40%-wide art box via CSS background-size/position (HeroScapeBoard
// `CARD_ART_CROP`). This page shows the WHOLE card with a fixed-aspect crop BOX you just MOVE around
// (click/drag to position it over the figure) and a slider to size it. What's inside the box is the
// card art. Copy the result into HeroScapeBoard.tsx. Work autosaves to localStorage.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { HS_CARDS, CARD_IDENTITY, HS_ART_ASPECT } from '@/lib/games/heroscape';

const CARD_ASPECT = HS_ART_ASPECT; // SHARED with the in-game art box → the crop is exact
const IMG_ASPECT = 936 / 1512;   // every cards-full render is this size
const LS_KEY = 'hs_cardcrop_v4';

type Rect = { fx: number; fy: number; fw: number; fh: number }; // fractions of the image (0..1)
const CARDS = Object.keys(HS_CARDS).sort((a, b) => HS_CARDS[a].name.localeCompare(HS_CARDS[b].name));
const jpg = (id: string) => `/heroscape/cards-full/${id}.jpg`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
// box height fraction so the box's DISPLAYED aspect = CARD_ASPECT.
const hOf = (fw: number) => fw * IMG_ASPECT / CARD_ASPECT;
const DEFAULT_FW = 0.41; // default box size (zoom) for an un-cropped card — a tighter start than the art box's 46%
const DEFAULT: Rect = { fx: 0.04, fy: 0.15, fw: DEFAULT_FW, fh: hOf(DEFAULT_FW) }; // figure-ish upper-left start

/** A crop box → the CSS background-size / position that shows exactly that region in the art box. */
function cssOf(c: Rect): { size: string; position: string } {
  const size = `${(100 / c.fw).toFixed(1)}%`;
  const posX = c.fw < 0.999 ? (c.fx / (1 - c.fw)) * 100 : 50;
  const posY = c.fh < 0.999 ? (c.fy / (1 - c.fh)) * 100 : 50;
  return { size, position: `${posX.toFixed(1)}% ${posY.toFixed(1)}%` };
}

export default function CardCropPicker() {
  const [crops, setCrops] = useState<Record<string, Rect>>({});
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragging = useRef(false);

  const id = CARDS[i];
  const def = HS_CARDS[id];
  const ident = CARD_IDENTITY[id];
  const box = crops[id] ?? DEFAULT;   // the box shown (default until you move it)
  const committed = !!crops[id];
  const css = cssOf(box);

  useEffect(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) setCrops(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(crops)); } catch { /* ignore */ }
  }, [crops]);

  // --- Move the box: click/drag CENTERS it on the pointer (clamped in-bounds) -----
  const place = (e: React.PointerEvent) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return;
    const fw = box.fw, fh = box.fh;
    const cx = clamp((e.clientX - r.left) / r.width, fw / 2, 1 - fw / 2);
    const cy = clamp((e.clientY - r.top) / r.height, fh / 2, 1 - fh / 2);
    setCrops(c => ({ ...c, [id]: { fx: cx - fw / 2, fy: cy - fh / 2, fw, fh } }));
  };
  const onDown = (e: React.PointerEvent) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); place(e); };
  const onMove = (e: React.PointerEvent) => { if (dragging.current) place(e); };
  const onUp = () => { dragging.current = false; };

  // --- Size the box (slider). Re-centre + clamp so it stays on the image. ----------
  const setSize = (fw: number) => {
    const fh = hOf(fw);
    const cx = clamp(box.fx + box.fw / 2, fw / 2, 1 - fw / 2);
    const cy = clamp(box.fy + box.fh / 2, fh / 2, 1 - fh / 2);
    setCrops(c => ({ ...c, [id]: { fx: cx - fw / 2, fy: cy - fh / 2, fw, fh } }));
  };

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
    if (!edited.length) return '// No crops yet — move the box over a figure. Un-cropped cards keep their existing portrait.';
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

  const pct = (n: number) => `${n * 100}%`;

  return (
    <div className="min-h-screen bg-neutral-950 px-5 py-4 text-neutral-200">
      <div className="mx-auto max-w-[84rem]">
        <div className="sticky top-0 z-20 -mx-5 -mt-4 border-b border-neutral-800 bg-neutral-950 px-5 pb-3 pt-4">
        <header className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-extrabold tracking-wide text-white">HeroScape · Card-art crop picker</h1>
          <span className="text-xs text-neutral-400">CLICK/DRAG to move the box over the figure · slider sizes it. What's in the box is the card art.</span>
          <Link href="/heroscape-mapmaker" className="ml-auto text-xs text-sky-400 hover:underline">⬡ HS maps</Link>
        </header>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[auto_1fr]">
          {/* ---- LEFT: the FULL card, fully visible, with a movable crop box ---- */}
          <section>
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
              <span>{i + 1} / {CARDS.length} · <span className="font-mono text-neutral-200">{def?.name}</span></span>
              <span>{committed ? <span className="text-sky-400">cropped ✓</span> : 'drag the box onto the figure'}</span>
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
                className="block max-h-[80vh] w-auto cursor-move touch-none"
              />
              {/* dim everything outside the box */}
              <div className="pointer-events-none absolute inset-0 bg-black/55" style={{
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pct(box.fx)} ${pct(box.fy)}, ${pct(box.fx)} ${pct(box.fy + box.fh)}, ${pct(box.fx + box.fw)} ${pct(box.fy + box.fh)}, ${pct(box.fx + box.fw)} ${pct(box.fy)}, ${pct(box.fx)} ${pct(box.fy)})`,
              }} />
              {/* the crop box */}
              <div className="pointer-events-none absolute border-2 border-sky-400 shadow-[0_0_0_1px_rgba(0,0,0,0.7)]" style={{ left: pct(box.fx), top: pct(box.fy), width: pct(box.fw), height: pct(box.fh) }} />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-neutral-400">Box size</span>
              <input type="range" min={0.18} max={0.85} step={0.01} value={box.fw} onChange={e => setSize(+e.target.value)} className="flex-1 accent-sky-500" />
              <span className="w-10 text-right font-mono text-[11px] text-neutral-300">{Math.round(box.fw * 100)}%</span>
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
                {/* art box matches the in-game card: 46% width, HS_ART_ASPECT shape */}
                <div className="w-[46%] shrink-0 self-start bg-neutral-950" style={{ aspectRatio: CARD_ASPECT, backgroundImage: `url('${jpg(id)}')`, backgroundSize: css.size, backgroundPosition: css.position, backgroundRepeat: 'no-repeat' }} />
                <div className="w-[54%] space-y-0.5 bg-neutral-900 px-2 py-2 text-[10px] leading-tight text-neutral-300">
                  {rows.map((r, k) => <div key={k} className={k === 0 ? 'font-bold text-white' : ''}>{r}</div>)}
                  <div className="mt-1 border-t border-neutral-700 pt-1 font-mono text-[9px] text-neutral-400">L{def?.life} · M{def?.move} · R{def?.range} · A{def?.attack} · D{def?.defense}</div>
                </div>
              </div>
            </div>
          </section>
        </div>
        </div>

        {/* below the frozen line — scrolls with the page */}
        <div className="mt-3 space-y-3">
            <div>
              <div className="mb-1 text-xs text-neutral-400">All cards — click to edit · <span className="text-sky-400">blue ring</span> = cropped</div>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                {CARDS.map((cid, k) => {
                  const c = crops[cid];
                  const e = cssOf(c ?? DEFAULT);
                  return (
                    <button
                      key={cid}
                      onClick={() => setI(k)}
                      title={HS_CARDS[cid].name}
                      className={'relative aspect-[3/4] overflow-hidden rounded border ' + (k === i ? 'border-amber-400' : c ? 'border-sky-500' : 'border-neutral-800 hover:border-neutral-600')}
                      style={c ? { backgroundImage: `url('${jpg(cid)}')`, backgroundSize: e.size, backgroundPosition: e.position, backgroundRepeat: 'no-repeat' } : { backgroundImage: `url('${jpg(cid)}')`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
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
        </div>
      </div>
    </div>
  );
}
