'use client';
// HeroScape CARD-ART CROP PICKER (dev tool). The play/draft card shows each `cards/<id>.jpg`
// in a 40%-wide art box with CSS background-size/position (see HeroScapeBoard `CARD_ART_CROP`).
// Eyeballing those values from screenshots is miserable, so this page lets you frame each card
// VISUALLY: drag to pan, slide to zoom, watch a faithful mini-card preview, then copy the
// generated `CARD_ART_CROP` object straight into HeroScapeBoard.tsx. Per the build-pickers rule:
// a click-to-specify tool beats guessing. Work autosaves to localStorage.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { HS_CARDS, CARD_IDENTITY } from '@/lib/games/heroscape';

type Crop = { size: string; position: string };
const DEFAULT: Crop = { size: 'cover', position: '50% 50%' };
const LS_KEY = 'hs_cardcrop_v1';

const CARDS = Object.keys(HS_CARDS).sort((a, b) => HS_CARDS[a].name.localeCompare(HS_CARDS[b].name));
const jpg = (id: string) => `/heroscape/cards/${id}.jpg`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function parsePos(p: string): { x: number; y: number } {
  if (p === 'center') return { x: 50, y: 50 };
  const m = p.match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
  return m ? { x: +m[1], y: +m[2] } : { x: 50, y: 50 };
}
const fmtPos = (x: number, y: number) => `${Math.round(x)}% ${Math.round(y)}%`;

export default function CardCropPicker() {
  const [crops, setCrops] = useState<Record<string, Crop>>({});
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [coverPct, setCoverPct] = useState(100);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const id = CARDS[i];
  const def = HS_CARDS[id];
  const ident = CARD_IDENTITY[id];
  const crop = crops[id] ?? DEFAULT;
  const pos = parsePos(crop.position);

  // Load / persist work so a long framing session survives a refresh.
  useEffect(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) setCrops(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(crops)); } catch { /* ignore */ }
  }, [crops]);

  // Measure the TRUE `cover` scale for this card's box (image natural size vs the live box), so the
  // zoom slider can start exactly at cover with no visual jump when you first nudge it.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const img = new Image();
    img.onload = () => {
      const bw = el.clientWidth, bh = el.clientHeight;
      if (!bw || !bh || !img.naturalWidth) return;
      const scale = Math.max(bw / img.naturalWidth, bh / img.naturalHeight);
      setCoverPct((img.naturalWidth * scale / bw) * 100);
    };
    img.src = jpg(id);
  }, [id]);

  const update = useCallback((patch: Partial<Crop>) => {
    setCrops(c => ({ ...c, [id]: { ...(c[id] ?? DEFAULT), ...patch } }));
  }, [id]);
  const reset = useCallback(() => {
    setCrops(c => { const n = { ...c }; delete n[id]; return n; });
  }, [id]);

  // Drag the image to pan (background-position). Dragging right reveals the LEFT of the image, so
  // position-x decreases — 1:1 with box size feels natural enough; the live preview is the truth.
  const onDown = (e: React.PointerEvent) => {
    const p = parsePos((crops[id] ?? DEFAULT).position);
    drag.current = { x: e.clientX, y: e.clientY, px: p.x, py: p.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, el = boxRef.current;
    if (!d || !el) return;
    const nx = clamp(d.px - (e.clientX - d.x) / el.clientWidth * 100, 0, 100);
    const ny = clamp(d.py - (e.clientY - d.y) / el.clientHeight * 100, 0, 100);
    update({ position: fmtPos(nx, ny) });
  };
  const onUp = () => { drag.current = null; };

  const sizePct = crop.size === 'cover' ? coverPct : parseFloat(crop.size) || coverPct;
  const onZoom = (v: number) => update({ size: Math.abs(v - coverPct) < 0.6 ? 'cover' : `${v.toFixed(1)}%` });
  const nudge = (dx: number, dy: number) => update({ position: fmtPos(clamp(pos.x + dx, 0, 100), clamp(pos.y + dy, 0, 100)) });

  const rows = [
    def?.species,
    `${def?.common ? 'Common' : 'Unique'} ${def?.type === 'hero' ? 'Hero' : 'Squad'}`,
    def?.unitClass,
    ident?.personality,
    ident?.world,
  ].filter(Boolean) as string[];

  const edited = useMemo(
    () => Object.entries(crops).filter(([, c]) => c.position !== DEFAULT.position || c.size !== DEFAULT.size),
    [crops],
  );
  const exportText = useMemo(() => {
    if (!edited.length) return '// No overrides yet — every card uses the default cover / center.';
    const body = edited.map(([cid, c]) => {
      const key = /^[a-z_][a-z0-9_]*$/.test(cid) ? cid : `'${cid}'`;
      return `  ${key}: { size: '${c.size}', position: '${c.position}' },`;
    }).join('\n');
    return `const CARD_ART_CROP: Record<string, { size: string; position: string }> = {\n${body}\n};`;
  }, [edited]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(exportText); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* ignore */ }
  };

  const artStyle: React.CSSProperties = {
    backgroundImage: `url('${jpg(id)}')`,
    backgroundSize: crop.size,
    backgroundPosition: crop.position,
    backgroundRepeat: 'no-repeat',
    cursor: drag.current ? 'grabbing' : 'grab',
    touchAction: 'none',
  };

  return (
    <div className="min-h-screen bg-neutral-950 px-5 py-4 text-neutral-200">
      <div className="mx-auto max-w-[72rem]">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-extrabold tracking-wide text-white">HeroScape · Card-art crop picker</h1>
          <span className="text-xs text-neutral-400">Drag the art to pan · slide to zoom · copy the result into <code className="text-amber-300">HeroScapeBoard.tsx</code></span>
          <Link href="/heroscape-mapmaker" className="ml-auto text-xs text-sky-400 hover:underline">⬡ HS maps</Link>
        </header>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
          {/* ---- LEFT: the live mini-card preview + controls ---- */}
          <section>
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
              <span>{i + 1} / {CARDS.length}</span>
              <span className="font-mono">{def?.name}</span>
            </div>

            {/* A faithful mini-card: header + a band whose 40% art box self-stretches to the text
                column height, exactly like the in-game card, so this is WYSIWYG. */}
            <div className="overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-lg">
              <div className="flex items-center gap-1.5 border-b-2 border-amber-600/70 bg-neutral-900 px-2 py-1.5">
                {ident?.general && <span className="rounded bg-amber-700 px-1 py-0.5 text-[8px] font-bold uppercase text-white">{ident.general}</span>}
                <span className="truncate text-sm font-extrabold uppercase tracking-wide text-white">{def?.name}</span>
              </div>
              <div className="flex">
                <div
                  ref={boxRef}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                  className="relative w-2/5 shrink-0 self-stretch overflow-hidden bg-neutral-950 ring-1 ring-inset ring-sky-500/40"
                  style={artStyle}
                  aria-label="Drag to pan the card art"
                />
                <div className="w-3/5 space-y-0.5 bg-neutral-900 px-2 py-2 text-[10px] leading-tight text-neutral-300">
                  {rows.map((r, k) => <div key={k} className={k === 0 ? 'font-bold text-white' : ''}>{r}</div>)}
                  <div className="mt-1 border-t border-neutral-700 pt-1 font-mono text-[9px] text-neutral-400">
                    L{def?.life} · M{def?.move} · R{def?.range} · A{def?.attack} · D{def?.defense}
                  </div>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="mt-3 space-y-3 rounded-md border border-neutral-800 bg-neutral-900/60 p-3">
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-neutral-400">
                  <span>Zoom</span><span className="font-mono">{crop.size}</span>
                </div>
                <input
                  type="range" min={Math.round(coverPct)} max={Math.round(coverPct * 3)} step={1} value={Math.round(sizePct)}
                  onChange={e => onZoom(+e.target.value)} className="w-full accent-sky-500"
                />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-neutral-400">
                  <span>Position</span><span className="font-mono">{crop.position}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="grid grid-cols-3 gap-1">
                    <span />
                    <button onClick={() => nudge(0, -2)} className="rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-neutral-700">↑</button>
                    <span />
                    <button onClick={() => nudge(-2, 0)} className="rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-neutral-700">←</button>
                    <button onClick={() => update({ position: '50% 50%' })} className="rounded bg-neutral-800 px-1 py-0.5 text-[9px] hover:bg-neutral-700">center</button>
                    <button onClick={() => nudge(2, 0)} className="rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-neutral-700">→</button>
                    <span />
                    <button onClick={() => nudge(0, 2)} className="rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-neutral-700">↓</button>
                    <span />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setI(p => (p - 1 + CARDS.length) % CARDS.length)} className="flex-1 rounded bg-neutral-800 py-1 text-xs hover:bg-neutral-700">◀ Prev</button>
                <button onClick={reset} className="rounded bg-rose-900/70 px-3 py-1 text-xs hover:bg-rose-800">Reset</button>
                <button onClick={() => setI(p => (p + 1) % CARDS.length)} className="flex-1 rounded bg-neutral-800 py-1 text-xs hover:bg-neutral-700">Next ▶</button>
              </div>
            </div>
          </section>

          {/* ---- RIGHT: thumbnail grid + export ---- */}
          <section className="space-y-4">
            <div>
              <div className="mb-1 text-xs text-neutral-400">All cards — click to edit · <span className="text-sky-400">blue ring</span> = framed</div>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                {CARDS.map((cid, k) => {
                  const c = crops[cid];
                  const isEd = !!c && (c.position !== DEFAULT.position || c.size !== DEFAULT.size);
                  return (
                    <button
                      key={cid}
                      onClick={() => setI(k)}
                      title={HS_CARDS[cid].name}
                      className={'relative aspect-[3/4] overflow-hidden rounded border ' + (k === i ? 'border-amber-400' : isEd ? 'border-sky-500' : 'border-neutral-800 hover:border-neutral-600')}
                      style={{ backgroundImage: `url('${jpg(cid)}')`, backgroundSize: (c ?? DEFAULT).size, backgroundPosition: (c ?? DEFAULT).position, backgroundRepeat: 'no-repeat' }}
                    >
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-0.5 text-[7px] text-white">{HS_CARDS[cid].shortName ?? HS_CARDS[cid].name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-neutral-400">{edited.length} override{edited.length === 1 ? '' : 's'} — paste over <code className="text-amber-300">CARD_ART_CROP</code></span>
                <button onClick={copy} className="rounded bg-emerald-700 px-3 py-1 text-xs font-bold hover:bg-emerald-600">{copied ? '✓ Copied' : 'Copy'}</button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-md border border-neutral-800 bg-black/50 p-3 text-[11px] leading-snug text-emerald-300">{exportText}</pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
