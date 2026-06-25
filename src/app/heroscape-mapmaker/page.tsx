'use client';

// HeroScape LEVEL CREATOR — an author-time tool to paint a battlefield: terrain
// (grass / rock / sand / water), per-hex height, trees (cosmetic for now), start
// zones (up to 6 seats) and power-glyph spots. It speaks the same odd-r offset token
// grid as maps.ts, so "Export" produces a ready-to-paste `parseMap(...)` block. Work
// autosaves to localStorage; you can also save named drafts and load any built-in map
// to remix it. Reached from the top bar (⬡ HS maps).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAPS, HS_GLYPHS, offsetToAxial, hexKey, axialToOffset } from '@/lib/games/heroscape';
import type { HSGlyphId } from '@/lib/games/heroscape';

type TerrainCode = 'G' | 'R' | 'S' | 'W';
type Cell = { t: TerrainCode | null; h: number; tree: boolean; glyph: HSGlyphId | null; zone: number };
type Brush =
  | { kind: 'terrain'; t: TerrainCode }
  | { kind: 'height'; h: number }
  | { kind: 'tree' }
  | { kind: 'glyph' }
  | { kind: 'zone'; seat: number }
  | { kind: 'erase' };

const TERRAIN_COLOR: Record<TerrainCode, string> = { G: '#5f9e3a', R: '#9a9b97', S: '#caa468', W: '#3f9fd6' };
const GROUT = '#6b4a24';
const SEAT_COLORS = ['#e23b3b', '#2f7ae5', '#f4c020', '#9b46d6', '#f0871d', '#36b14a']; // red blue yellow purple orange green
const GLYPH_IDS = Object.keys(HS_GLYPHS) as HSGlyphId[];
const S = 22; // hex radius (centre → vertex)
const DX = S * Math.sqrt(3); // column step
const DY = S * 1.5; // row step
const HEIGHTS = [1, 2, 3, 4, 5, 6, 7];
const DRAFTS_KEY = 'hs_mapmaker_drafts';
const CURRENT_KEY = 'hs_mapmaker_current';

function emptyCell(): Cell { return { t: 'G', h: 1, tree: false, glyph: null, zone: 0 }; }
function makeGrid(cols: number, rows: number, fill: () => Cell): Cell[] {
  return Array.from({ length: cols * rows }, fill);
}
function hexCorners(cx: number, cy: number): string {
  let p = '';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    p += `${(cx + S * Math.cos(a)).toFixed(1)},${(cy + S * Math.sin(a)).toFixed(1)} `;
  }
  return p.trim();
}
function centre(col: number, row: number): { cx: number; cy: number } {
  return { cx: DX * (col + 0.5 * (row & 1)) + DX / 2, cy: DY * row + S };
}

const Hex = memo(function Hex({ cell, col, row, onDown, onEnter }: {
  cell: Cell; col: number; row: number;
  onDown: (col: number, row: number) => void; onEnter: (col: number, row: number) => void;
}) {
    const { cx, cy } = centre(col, row);
    const pts = hexCorners(cx, cy);
    const fill = cell.t ? TERRAIN_COLOR[cell.t] : 'rgba(120,120,120,0.10)';
    const label = cell.t ? (cell.t === 'W' ? '0' : String(cell.h)) : '';
    return (
      <g
        onPointerDown={e => { e.preventDefault(); onDown(col, row); }}
        onPointerEnter={() => onEnter(col, row)}
        style={{ cursor: 'pointer' }}
      >
        <polygon points={pts} fill={GROUT} />
        <polygon points={hexCorners(cx, cy).split(' ').map(p => {
          const [x, y] = p.split(',').map(Number);
          return `${(cx + (x - cx) * 0.88).toFixed(1)},${(cy + (y - cy) * 0.88).toFixed(1)}`;
        }).join(' ')} fill={fill} />
        {cell.zone > 0 && (
          <polygon points={pts} fill="none" stroke={SEAT_COLORS[cell.zone - 1]} strokeWidth={3.5} pointerEvents="none" />
        )}
        {label && (
          <text x={cx} y={cy + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff"
            stroke="rgba(0,0,0,0.5)" strokeWidth={0.5} pointerEvents="none">{label}</text>
        )}
        {cell.tree && <circle cx={cx} cy={cy - 11} r={4} fill="#1e5a16" pointerEvents="none" />}
        {cell.glyph && <circle cx={cx} cy={cy + 12} r={3.5} fill="#b91c1c" stroke="#fff" strokeWidth={0.5} pointerEvents="none" />}
      </g>
    );
});

export default function MapMaker() {
  const [cols, setCols] = useState(16);
  const [rows, setRows] = useState(12);
  const [cells, setCells] = useState<Cell[]>(() => makeGrid(16, 12, emptyCell));
  const [name, setName] = useState('My Battlefield');
  const [brush, setBrush] = useState<Brush>({ kind: 'terrain', t: 'G' });
  const [glyphId, setGlyphId] = useState<HSGlyphId>('mitonsoul');
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const painting = useRef(false);
  const brushRef = useRef(brush);
  const glyphRef = useRef(glyphId);
  brushRef.current = brush;
  glyphRef.current = glyphId;

  const idx = (c: number, r: number) => r * cols + c;

  // Load autosaved draft + saved-draft names on mount.
  useEffect(() => {
    try {
      const cur = localStorage.getItem(CURRENT_KEY);
      if (cur) {
        const d = JSON.parse(cur);
        if (d && Array.isArray(d.cells) && d.cols && d.rows) {
          setCols(d.cols); setRows(d.rows); setCells(d.cells); setName(d.name ?? 'My Battlefield');
        }
      }
      const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
      setSavedNames(Object.keys(drafts));
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Autosave the working draft.
  useEffect(() => {
    try { localStorage.setItem(CURRENT_KEY, JSON.stringify({ name, cols, rows, cells })); } catch { /* quota */ }
  }, [name, cols, rows, cells]);

  useEffect(() => {
    const up = () => { painting.current = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const applyAt = useCallback((c: number, r: number) => {
    setCells(prev => {
      const i = r * cols + c;
      const cell = prev[i];
      const b = brushRef.current;
      const next: Cell = { ...cell };
      if (b.kind === 'erase') { next.t = null; next.h = 1; next.tree = false; next.glyph = null; next.zone = 0; }
      else if (b.kind === 'terrain') { next.t = b.t; if (next.h < 1) next.h = 1; }
      else if (b.kind === 'height') { if (next.t) next.h = b.h; }
      else if (b.kind === 'tree') { if (!next.t) { next.t = 'G'; next.h = 1; } next.tree = true; }
      else if (b.kind === 'glyph') { if (!next.t) { next.t = 'G'; next.h = 1; } next.glyph = glyphRef.current; }
      else if (b.kind === 'zone') { if (!next.t) { next.t = 'G'; next.h = 1; } next.zone = b.seat; }
      if (next.t === cell.t && next.h === cell.h && next.tree === cell.tree && next.glyph === cell.glyph && next.zone === cell.zone) return prev;
      const out = prev.slice();
      out[i] = next;
      return out;
    });
  }, [cols]);

  const onDown = useCallback((c: number, r: number) => { painting.current = true; applyAt(c, r); }, [applyAt]);
  const onEnter = useCallback((c: number, r: number) => { if (painting.current) applyAt(c, r); }, [applyAt]);

  function resize(nc: number, nr: number) {
    nc = Math.max(4, Math.min(30, nc)); nr = Math.max(4, Math.min(26, nr));
    setCells(prev => {
      const out = makeGrid(nc, nr, () => ({ t: null, h: 1, tree: false, glyph: null, zone: 0 }));
      for (let r = 0; r < Math.min(rows, nr); r++) for (let c = 0; c < Math.min(cols, nc); c++) out[r * nc + c] = prev[r * cols + c];
      return out;
    });
    setCols(nc); setRows(nr);
  }

  function clearAll() {
    setCells(makeGrid(cols, rows, () => ({ t: 'G', h: 1, tree: false, glyph: null, zone: 0 })));
  }

  function loadMap(id: string) {
    const m = MAPS[id];
    if (!m) return;
    let maxC = 0, maxR = 0;
    const tmp: Record<string, Cell> = {};
    for (const [key, cell] of Object.entries(m.cells)) {
      const { col, row } = axialToOffset(key);
      maxC = Math.max(maxC, col); maxR = Math.max(maxR, row);
      tmp[`${col},${row}`] = { t: cell.terrain === 'grass' ? 'G' : cell.terrain === 'rock' ? 'R' : cell.terrain === 'sand' ? 'S' : 'W', h: cell.height, tree: false, glyph: null, zone: 0 };
    }
    const nc = maxC + 1, nr = maxR + 1;
    const grid = makeGrid(nc, nr, () => ({ t: null, h: 1, tree: false, glyph: null, zone: 0 }));
    for (const [k, v] of Object.entries(tmp)) { const [c, r] = k.split(',').map(Number); grid[r * nc + c] = v; }
    Object.entries(m.startZones).forEach(([seat, keys]) => {
      for (const key of keys) { const { col, row } = axialToOffset(key); const g = grid[row * nc + col]; if (g) g.zone = Number(seat) + 1; }
    });
    for (const gp of m.glyphs) { const { col, row } = axialToOffset(gp.at); const g = grid[row * nc + col]; if (g) g.glyph = gp.id; }
    setCols(nc); setRows(nr); setCells(grid); setName(m.name);
  }

  function saveDraft() {
    try {
      const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
      drafts[name] = { name, cols, rows, cells };
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      setSavedNames(Object.keys(drafts));
    } catch { /* quota */ }
  }
  function loadDraft(n: string) {
    try {
      const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
      const d = drafts[n];
      if (d) { setCols(d.cols); setRows(d.rows); setCells(d.cells); setName(d.name); }
    } catch { /* ignore */ }
  }

  const slug = useMemo(() => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'custom_map', [name]);

  const stats = useMemo(() => {
    let hexes = 0, zones = 0, trees = 0, glyphs = 0; const byT: Record<string, number> = {};
    for (const c of cells) { if (!c.t) continue; hexes++; byT[c.t] = (byT[c.t] || 0) + 1; if (c.zone) zones++; if (c.tree) trees++; if (c.glyph) glyphs++; }
    return { hexes, zones, trees, glyphs, byT };
  }, [cells]);

  const code = useMemo(() => {
    const rowsTxt: string[] = [];
    for (let r = 0; r < rows; r++) {
      const tk: string[] = [];
      for (let c = 0; c < cols; c++) { const cell = cells[r * cols + c]; tk.push(cell.t ? `${cell.t}${cell.t === 'W' ? 1 : cell.h}` : '.'); }
      rowsTxt.push(`    row${r + 1}: ${tk.join(' ')}`);
    }
    const glyphLayout: string[] = [];
    const zoneKeys: Record<number, string[]> = {};
    const trees: string[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cell = cells[r * cols + c];
      if (!cell.t) continue;
      if (cell.glyph) glyphLayout.push(`    { id: '${cell.glyph}', col: ${c}, row: ${r} },`);
      if (cell.zone) { const { q, r: rr } = offsetToAxial(c, r); (zoneKeys[cell.zone - 1] ||= []).push(`'${hexKey(q, rr)}'`); }
      if (cell.tree) trees.push(`(${c},${r})`);
    }
    const zoneTxt = Object.keys(zoneKeys).length
      ? `  m.startZones = {\n${Object.entries(zoneKeys).map(([s, ks]) => `    ${s}: [${ks.join(', ')}],`).join('\n')}\n  };\n`
      : '';
    const treeTxt = trees.length ? `  // trees (cosmetic; no forest mechanic yet): ${trees.join(' ')}\n` : '';
    return (
`export const ${slug.toUpperCase()}_MAP: HSMap = (() => {
  const m = parseMap(
    '${slug}',
    '${name.replace(/'/g, "\\'")}',
    \`
${rowsTxt.join('\n')}
  \`,
    [
${glyphLayout.join('\n')}
    ],
  );
${zoneTxt}${treeTxt}  return m;
})();
// then register it: add \`${slug}: ${slug.toUpperCase()}_MAP\` to the MAPS record.`);
  }, [cells, cols, rows, name, slug]);

  const vbW = (DX * cols + DX / 2 + 4).toFixed(0);
  const vbH = (DY * rows + S + 4).toFixed(0);

  const btn = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs font-medium transition ${active ? 'border-sky-400 bg-sky-950/50 text-sky-200 ring-1 ring-sky-400' : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500'}`;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><span className="text-sky-400">⬡</span> HeroScape Level Creator</h1>
          <a href="/lobby" className="text-xs text-neutral-400 transition hover:text-emerald-400">← Back to lobby</a>
        </div>

        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">Map name
            <input value={name} onChange={e => setName(e.target.value)} className="w-48 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">Columns
            <input type="number" value={cols} min={4} max={30} onChange={e => resize(+e.target.value, rows)} className="w-20 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">Rows
            <input type="number" value={rows} min={4} max={26} onChange={e => resize(cols, +e.target.value)} className="w-20 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">Remix a built-in map
            <select onChange={e => { if (e.target.value) loadMap(e.target.value); e.target.value = ''; }} defaultValue="" className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm">
              <option value="">Load…</option>
              {Object.values(MAPS).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button onClick={clearAll} className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs hover:border-neutral-500">Fill grass</button>
          <button onClick={saveDraft} className="rounded-md border border-emerald-700 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-950/40">Save draft</button>
          {savedNames.length > 0 && (
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">Drafts
              <select onChange={e => { if (e.target.value) loadDraft(e.target.value); e.target.value = ''; }} defaultValue="" className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm">
                <option value="">Load draft…</option>
                {savedNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Terrain</span>
          {(['G', 'R', 'S', 'W'] as TerrainCode[]).map(t => (
            <button key={t} onClick={() => setBrush({ kind: 'terrain', t })} className={btn(brush.kind === 'terrain' && brush.t === t)}
              style={{ borderColor: brush.kind === 'terrain' && brush.t === t ? undefined : TERRAIN_COLOR[t] }}>
              {t === 'G' ? 'Grass' : t === 'R' ? 'Rock' : t === 'S' ? 'Sand' : 'Water'}
            </button>
          ))}
          <span className="mx-1 text-[11px] uppercase tracking-wide text-neutral-500">Height</span>
          {HEIGHTS.map(h => (
            <button key={h} onClick={() => setBrush({ kind: 'height', h })} className={btn(brush.kind === 'height' && brush.h === h)}>{h}</button>
          ))}
          <span className="mx-1 text-[11px] uppercase tracking-wide text-neutral-500">Mark</span>
          <button onClick={() => setBrush({ kind: 'tree' })} className={btn(brush.kind === 'tree')}>Tree</button>
          <button onClick={() => setBrush({ kind: 'glyph' })} className={btn(brush.kind === 'glyph')}>Glyph</button>
          <select value={glyphId} onChange={e => setGlyphId(e.target.value as HSGlyphId)} className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs">
            {GLYPH_IDS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <button onClick={() => setBrush({ kind: 'erase' })} className={btn(brush.kind === 'erase')}>Erase</button>
          <span className="mx-1 text-[11px] uppercase tracking-wide text-neutral-500">Zone</span>
          {SEAT_COLORS.map((c, i) => (
            <button key={i} onClick={() => setBrush({ kind: 'zone', seat: i + 1 })} className={btn(brush.kind === 'zone' && brush.seat === i + 1)}
              style={{ color: c }}>P{i + 1}</button>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <div className="overflow-auto rounded-lg border border-neutral-800 bg-neutral-900/30 p-2" style={{ maxHeight: '62vh', touchAction: 'none' }}>
            <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: Math.max(Number(vbW), 300), height: 'auto', display: 'block', userSelect: 'none' }}>
              {cells.map((cell, i) => <Hex key={i} cell={cell} col={i % cols} row={Math.floor(i / cols)} onDown={onDown} onEnter={onEnter} />)}
            </svg>
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-300">
              <div className="mb-1 font-semibold text-neutral-200">{stats.hexes} hexes</div>
              <div className="text-neutral-400">grass {stats.byT.G || 0} · rock {stats.byT.R || 0} · sand {stats.byT.S || 0} · water {stats.byT.W || 0}</div>
              <div className="text-neutral-400">zones {stats.zones} · trees {stats.trees} · glyphs {stats.glyphs}</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-200">maps.ts code</span>
                <div className="flex gap-1.5">
                  <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="rounded border border-sky-700 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-950/40">{copied ? 'Copied!' : 'Copy'}</button>
                </div>
              </div>
              <textarea readOnly value={code} className="h-64 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-[10px] leading-tight text-neutral-300" />
              <p className="mt-2 text-[11px] text-neutral-500">Paste into <code className="text-neutral-400">src/lib/games/heroscape/maps.ts</code> and add it to the <code className="text-neutral-400">MAPS</code> record — or send the code to Claude to wire it in + deploy. Blank hexes = height 1; water shows 0. Trees are cosmetic until a forest mechanic lands.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
