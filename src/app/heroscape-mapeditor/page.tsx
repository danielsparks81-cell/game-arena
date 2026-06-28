'use client';

// STAR FIELD — SYMMETRIC TERRAIN EDITOR. Paint walls / ridges / peaks / water on the 2-6 player Star
// Field; EVERY edit is mirrored to all SIX arms (60° rotation about the centre), so the battlefield
// stays perfectly symmetric no matter what you do. "Export" produces the four ready-to-paste seed
// lines for makeStarMap in maps.ts — no more guessing hex coordinates off a screenshot.
//
// Why a separate tool: the Star Field is PROCEDURAL (seeds + symmetry), so it can't go through the
// freeform /heroscape-mapmaker, which speaks parseMap row strings. This editor works at the seed
// level and keeps the 6-fold symmetry by construction.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STAR_FIELD, hexKey } from '@/lib/games/heroscape';

type Terrain = 'grass' | 'rock' | 'water';
type Cell = { q: number; r: number; h: number; t: Terrain };
type Brush = 'wall' | 'peak' | 'ridge' | 'water' | 'grass';

const S = 15; // hex radius (centre → vertex)
const rot60 = (q: number, r: number): [number, number] => [-r, q + r];
function orbit(q: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  let cq = q, cr = r;
  for (let i = 0; i < 6; i++) { out.push([cq, cr]); [cq, cr] = rot60(cq, cr); }
  return out;
}
const centerDist = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

const BRUSHES: { key: Brush; t: Terrain; h: number; label: string; swatch: string }[] = [
  { key: 'wall',  t: 'rock',  h: 15, label: 'Wall',  swatch: '#3f4146' },
  { key: 'peak',  t: 'grass', h: 3,  label: 'Peak h3',  swatch: '#2f5e1c' },
  { key: 'ridge', t: 'grass', h: 2,  label: 'Ridge h2', swatch: '#477f2a' },
  { key: 'water', t: 'water', h: 1,  label: 'Water', swatch: '#3f9fd6' },
  { key: 'grass', t: 'grass', h: 1,  label: 'Grass (erase)', swatch: '#5f9e3a' },
];
const BRUSH_BY_KEY = Object.fromEntries(BRUSHES.map(b => [b.key, b])) as Record<Brush, (typeof BRUSHES)[number]>;
const GRASS_SHADE = ['#5f9e3a', '#5f9e3a', '#4f8a30', '#3f7426']; // index by height (≥3 clamps)
function cellColor(c: Cell): string {
  if (c.t === 'rock') return '#3f4146';
  if (c.t === 'water') return '#3f9fd6';
  return GRASS_SHADE[Math.min(c.h, 3)] ?? '#3f7426';
}

export default function StarFieldEditor() {
  const zoneHexes = useMemo(() => new Set(Object.values(STAR_FIELD.startZones).flat() as string[]), []);
  const initial = useMemo<Record<string, Cell>>(() => {
    const m: Record<string, Cell> = {};
    for (const [k, c] of Object.entries(STAR_FIELD.cells)) m[k] = { q: c.q, r: c.r, h: c.height, t: c.terrain as Terrain };
    return m;
  }, []);
  const [cells, setCells] = useState<Record<string, Cell>>(initial);
  const [brush, setBrush] = useState<Brush>('wall');
  const [copied, setCopied] = useState(false);
  const painting = useRef(false);
  const brushRef = useRef(brush);
  brushRef.current = brush;

  useEffect(() => {
    const up = () => { painting.current = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  // Paint the clicked hex AND its whole 6-fold orbit (skipping off-board + start-zone hexes).
  const applyAt = useCallback((q: number, r: number) => {
    setCells(prev => {
      const b = BRUSH_BY_KEY[brushRef.current];
      const out = { ...prev };
      let changed = false;
      for (const [oq, or2] of orbit(q, r)) {
        const k = hexKey(oq, or2);
        const cur = prev[k];
        if (!cur || zoneHexes.has(k)) continue; // off-board, or a deploy zone (kept fair = read-only)
        if (cur.t !== b.t || cur.h !== b.h) { out[k] = { ...cur, t: b.t, h: b.h }; changed = true; }
      }
      return changed ? out : prev;
    });
  }, [zoneHexes]);
  const onDown = useCallback((q: number, r: number) => { painting.current = true; applyAt(q, r); }, [applyAt]);
  const onEnter = useCallback((q: number, r: number) => { if (painting.current) applyAt(q, r); }, [applyAt]);

  // Layout: pointy-top axial → pixel, offset so the whole star fits with a margin.
  const layout = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const k in cells) {
      const c = cells[k];
      const x = S * Math.sqrt(3) * (c.q + c.r / 2), y = S * 1.5 * c.r;
      pos[k] = { x, y };
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { pos, minX, maxX, minY, maxY };
  }, [cells]);
  const PAD = S + 6;
  const offX = PAD - layout.minX, offY = PAD - layout.minY;
  const vbW = (layout.maxX - layout.minX + 2 * PAD).toFixed(0);
  const vbH = (layout.maxY - layout.minY + 2 * PAD).toFixed(0);
  const corners = (cx: number, cy: number) => {
    let p = '';
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 90); p += `${(cx + S * Math.cos(a)).toFixed(1)},${(cy + S * Math.sin(a)).toFixed(1)} `; }
    return p.trim();
  };

  const counts = useMemo(() => {
    let walls = 0, peaks = 0, ridges = 0, water = 0;
    for (const k in cells) {
      const c = cells[k];
      if (c.t === 'rock') walls++;
      else if (c.t === 'water') water++;
      else if (c.h === 3) peaks++;
      else if (c.h === 2 && centerDist(c.q, c.r) > 2) ridges++;
    }
    return { walls, peaks, ridges, water };
  }, [cells]);

  // Export: one canonical seed per orbit, per feature → the four makeStarMap lines.
  const code = useMemo(() => {
    const rep = (q: number, r: number): [number, number] =>
      orbit(q, r).reduce((b, c) => (c[0] > b[0] || (c[0] === b[0] && c[1] > b[1]) ? c : b));
    const seedsFor = (pred: (c: Cell) => boolean): [number, number][] => {
      const seen = new Set<string>(); const seeds: [number, number][] = [];
      for (const k in cells) {
        const c = cells[k];
        if (!pred(c) || seen.has(k)) continue;
        for (const [oq, or2] of orbit(c.q, c.r)) seen.add(hexKey(oq, or2));
        seeds.push(rep(c.q, c.r));
      }
      return seeds.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    };
    const fmt = (seeds: [number, number][]) =>
      seeds.length ? `new Set([${seeds.map(([q, r]) => `...orbit(${q}, ${r})`).join(', ')}])` : 'new Set<string>()';
    const walls = seedsFor(c => c.t === 'rock');
    const peaks = seedsFor(c => c.t === 'grass' && c.h === 3);
    const ridges = seedsFor(c => c.t === 'grass' && c.h === 2 && centerDist(c.q, c.r) > 2);
    const water = seedsFor(c => c.t === 'water');
    return [
      '// Paste into makeStarMap (src/lib/games/heroscape/maps.ts) — or send to Claude to wire in + deploy:',
      `const walls = ${fmt(walls)};`,
      `const peaks = ${fmt(peaks)};`,
      `const slopes = ${fmt(ridges)};`,
      `const water = ${fmt(water)};`,
    ].join('\n');
  }, [cells]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><span className="text-sky-400">✶</span> Star Field — Symmetric Terrain Editor</h1>
          <div className="flex items-center gap-3 text-xs">
            <a href="/heroscape-mapmaker" className="text-neutral-400 transition hover:text-sky-300">⬡ freeform maps</a>
            <a href="/lobby" className="text-neutral-400 transition hover:text-emerald-400">← lobby</a>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Paint</span>
          {BRUSHES.map(b => (
            <button
              key={b.key}
              onClick={() => setBrush(b.key)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${brush === b.key ? 'border-sky-400 bg-sky-950/50 text-sky-200 ring-1 ring-sky-400' : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500'}`}
            >
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: b.swatch }} />{b.label}
            </button>
          ))}
          <button onClick={() => setCells(initial)} className="ml-2 rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:border-neutral-500">Reset to current map</button>
          <span className="ml-auto text-[11px] text-neutral-500">every paint mirrors to all 6 arms · deploy zones are locked</span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <div className="overflow-auto rounded-lg border border-neutral-800 bg-neutral-900/30 p-2" style={{ maxHeight: '70vh', touchAction: 'none' }}>
            <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: Math.max(Number(vbW), 320), height: 'auto', display: 'block', userSelect: 'none' }}>
              {Object.entries(cells).map(([k, c]) => {
                const p = layout.pos[k];
                const cx = p.x + offX, cy = p.y + offY;
                const inZone = zoneHexes.has(k);
                const label = c.t === 'grass' && c.h >= 2 ? String(c.h) : '';
                return (
                  <g
                    key={k}
                    onPointerDown={e => { if (!inZone) { e.preventDefault(); onDown(c.q, c.r); } }}
                    onPointerEnter={() => { if (!inZone) onEnter(c.q, c.r); }}
                    style={{ cursor: inZone ? 'not-allowed' : 'pointer' }}
                  >
                    <polygon points={corners(cx, cy)} fill="#6b4a24" />
                    <polygon
                      points={corners(cx, cy).split(' ').map(pt => { const [x, y] = pt.split(',').map(Number); return `${(cx + (x - cx) * 0.9).toFixed(1)},${(cy + (y - cy) * 0.9).toFixed(1)}`; }).join(' ')}
                      fill={cellColor(c)}
                      opacity={inZone ? 0.55 : 1}
                    />
                    {inZone && <polygon points={corners(cx, cy)} fill="none" stroke="#fbbf24" strokeWidth={2} pointerEvents="none" />}
                    {label && <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" stroke="rgba(0,0,0,0.5)" strokeWidth={0.4} pointerEvents="none">{label}</text>}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-300">
              <div className="mb-1 font-semibold text-neutral-200">Feature hex counts (×6 arms)</div>
              <div className="text-neutral-400">walls {counts.walls} · peaks {counts.peaks} · ridges {counts.ridges} · water {counts.water}</div>
              <div className="mt-1.5 text-[11px] text-neutral-500">Amber-outlined hexes are deploy zones — locked so the map stays fair. The centre plateau (radius ≤2) stays flat by the engine; paint over it only if you mean to.</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-200">maps.ts seeds</span>
                <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="rounded border border-sky-700 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-950/40">{copied ? 'Copied!' : 'Copy'}</button>
              </div>
              <textarea readOnly value={code} className="h-56 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-[10px] leading-tight text-neutral-300" />
              <p className="mt-2 text-[11px] text-neutral-500">Replace the four <code className="text-neutral-400">walls/peaks/slopes/water</code> lines in <code className="text-neutral-400">makeStarMap</code> with these — or send them to Claude to wire in + deploy. Each <code className="text-neutral-400">orbit(q,r)</code> is one seed mirrored to all six arms.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
