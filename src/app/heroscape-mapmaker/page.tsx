'use client';

// HeroScape LEVEL CREATOR — an author-time tool to paint a battlefield: terrain
// (grass / rock / sand / water), per-hex height, trees (cosmetic for now), start
// zones (up to 6 seats) and power-glyph spots. It speaks the same odd-r offset token
// grid as maps.ts, so "Export" produces a ready-to-paste `parseMap(...)` block. Work
// autosaves to localStorage; you can also save named drafts and load any built-in map
// to remix it. Reached from the top bar (⬡ HS maps).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAPS, HS_GLYPHS, offsetToAxial, hexKey, axialToOffset, neighborKeys, SEAT_COLORS } from '@/lib/games/heroscape';
import type { HSGlyphId } from '@/lib/games/heroscape';

type TerrainCode = 'G' | 'R' | 'S' | 'W';
// `glyph` = a SPECIFIC glyph id (exported in the glyph layout); `gRand` = a RANDOM glyph spot (a `*`
// token — the engine rolls a random glyph there each game). A hex holds at most one of the two.
type Cell = { t: TerrainCode | null; h: number; tree: boolean; glyph: HSGlyphId | null; gRand?: boolean; zone: number };
type Brush =
  | { kind: 'sculpt'; water?: boolean } // left raises / right lowers a hex one rung; `water` picks the water ladder
  | { kind: 'terrain'; t: TerrainCode }
  | { kind: 'height'; h: number }
  | { kind: 'tree' }
  | { kind: 'glyph' }
  | { kind: 'glyphRandom' } // marks a hex as a RANDOM-glyph spot
  | { kind: 'wall' } // click the dot between two hexes to toggle a wall on that EDGE
  | { kind: 'zone'; seat: number }
  | { kind: 'erase' };

// A wall lives on the EDGE between two hexes. Canonical id (order-independent) keyed by offset coords.
function edgeId(a: [number, number], b: [number, number]): string {
  const ka = a[1] * 10000 + a[0], kb = b[1] * 10000 + b[0];
  return ka <= kb ? `${a[0]},${a[1]}|${b[0]},${b[1]}` : `${b[0]},${b[1]}|${a[0]},${a[1]}`;
}

// SCULPT ladders (owner 2026-06-28): one rung per left/right click; terrain auto-follows the rung. LAND
// and WATER are SEPARATE tools. The LAND ladder steps blank → grass 1/2 → sand 3/4 → rock 5/6/7 (no water);
// the WATER ladder steps blank → water .5 → 1.5 → 2.5 … (a water tile reads half a level below its height).
const LAND_RUNGS: { t: TerrainCode | null; h: number }[] = [
  { t: null, h: 1 }, // 0 blank
  { t: 'G', h: 1 },  // 1 grass
  { t: 'G', h: 2 },  // 2 grass
  { t: 'S', h: 3 },  // 3 sand
  { t: 'S', h: 4 },  // 4 sand
  { t: 'R', h: 5 },  // 5 rock
  { t: 'R', h: 6 },  // 6 rock
  { t: 'R', h: 7 },  // 7 rock
];
const WATER_RUNGS: { t: TerrainCode | null; h: number }[] = [
  { t: null, h: 1 }, // 0 blank
  { t: 'W', h: 1 },  // 1 → surface .5
  { t: 'W', h: 2 },  // 2 → surface 1.5
  { t: 'W', h: 3 },  // 3 → 2.5
  { t: 'W', h: 4 },  // 4 → 3.5
  { t: 'W', h: 5 },  // 5
  { t: 'W', h: 6 },  // 6
  { t: 'W', h: 7 },  // 7
];
// Current rung on each ladder. LAND: blank or water → 0, a land tile → its height (grass h1 → rung 1 … rock
// h7 → 7). WATER: a water tile → its height (.5 → rung 1 …); blank/land → 0 (so the first click floods to .5).
function landRung(cell: Cell): number {
  if (!cell.t || cell.t === 'W') return 0;
  return Math.min(LAND_RUNGS.length - 1, cell.h);
}
function waterRung(cell: Cell): number {
  if (cell.t !== 'W') return 0;
  return Math.min(WATER_RUNGS.length - 1, cell.h);
}

const TERRAIN_COLOR: Record<TerrainCode, string> = { G: '#5f9e3a', R: '#9a9b97', S: '#caa468', W: '#3f9fd6' };
const GROUT = '#6b4a24';
// SEAT_COLORS imported from heroscape/colors (shared with both boards).
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
  onDown: (col: number, row: number, button: number) => void; onEnter: (col: number, row: number) => void;
}) {
    const { cx, cy } = centre(col, row);
    const pts = hexCorners(cx, cy);
    const fill = cell.t ? TERRAIN_COLOR[cell.t] : 'rgba(120,120,120,0.10)';
    // Water's SURFACE sits half a level below its tile height (so a height-1 pond reads .5, a height-2
    // raised pool reads 1.5, etc.). Show that effective surface; non-water shows the plain height.
    const label = cell.t ? (cell.t === 'W' ? String(cell.h - 0.5).replace(/^0\./, '.') : String(cell.h)) : '';
    return (
      <g
        onPointerDown={e => { e.preventDefault(); onDown(col, row, e.button); }}
        onPointerEnter={() => onEnter(col, row)}
        onContextMenu={e => e.preventDefault()}
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
        {cell.gRand && (
          <g pointerEvents="none">
            <circle cx={cx} cy={cy + 11} r={5.5} fill="#a855f7" stroke="#fff" strokeWidth={0.6} />
            <text x={cx} y={cy + 14.5} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff">?</text>
          </g>
        )}
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
  const [walls, setWalls] = useState<Set<string>>(() => new Set());
  const painting = useRef(false);
  const sculptDir = useRef(1); // +1 raise (left button) / -1 lower (right button), set on pointer-down
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
          if (Array.isArray(d.walls)) setWalls(new Set(d.walls));
        }
      }
      const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
      setSavedNames(Object.keys(drafts));
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Autosave the working draft.
  useEffect(() => {
    try { localStorage.setItem(CURRENT_KEY, JSON.stringify({ name, cols, rows, cells, walls: [...walls] })); } catch { /* quota */ }
  }, [name, cols, rows, cells, walls]);

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
      if (b.kind === 'erase') { next.t = null; next.h = 1; next.tree = false; next.glyph = null; next.gRand = false; next.zone = 0; }
      else if (b.kind === 'terrain') { next.t = b.t; if (next.h < 1) next.h = 1; }
      else if (b.kind === 'height') { if (next.t) next.h = b.h; }
      else if (b.kind === 'tree') { if (!next.t) { next.t = 'G'; next.h = 1; } next.tree = true; }
      else if (b.kind === 'glyph') { if (!next.t) { next.t = 'G'; next.h = 1; } next.glyph = glyphRef.current; next.gRand = false; }
      else if (b.kind === 'glyphRandom') { if (!next.t) { next.t = 'G'; next.h = 1; } next.gRand = true; next.glyph = null; }
      else if (b.kind === 'zone') { if (!next.t) { next.t = 'G'; next.h = 1; } next.zone = b.seat; }
      else if (b.kind === 'sculpt') {
        const rungs = b.water ? WATER_RUNGS : LAND_RUNGS;
        const cur = b.water ? waterRung(cell) : landRung(cell);
        const nr = Math.max(0, Math.min(rungs.length - 1, cur + sculptDir.current));
        const rung = rungs[nr];
        next.t = rung.t; next.h = rung.h;
        if (!rung.t) { next.tree = false; next.glyph = null; next.gRand = false; next.zone = 0; } // a blank hex can't hold a mark
      }
      if (next.t === cell.t && next.h === cell.h && next.tree === cell.tree && next.glyph === cell.glyph && next.gRand === cell.gRand && next.zone === cell.zone) return prev;
      const out = prev.slice();
      out[i] = next;
      return out;
    });
  }, [cols]);

  const onDown = useCallback((c: number, r: number, button: number) => {
    if (brushRef.current.kind === 'wall') return; // wall mode paints EDGES (the dots), not hexes
    painting.current = true;
    sculptDir.current = button === 2 ? -1 : 1; // right button lowers, anything else raises
    applyAt(c, r);
  }, [applyAt]);
  const onEnter = useCallback((c: number, r: number) => { if (painting.current) applyAt(c, r); }, [applyAt]);

  const toggleWall = useCallback((id: string) => {
    setWalls(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  }, []);

  // Every interior edge between two EXISTING hexes (deduped), with its midpoint + the perpendicular
  // wall segment in pixel space. Drives both the click-to-toggle dots (wall mode) and the wall render.
  const edgeList = useMemo(() => {
    const has = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows && !!cells[r * cols + c]?.t;
    const out: { id: string; a: [number, number]; b: [number, number]; mx: number; my: number; e1: [number, number]; e2: [number, number] }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!has(c, r)) continue;
      const { q, r: rr } = offsetToAxial(c, r);
      for (const nk of neighborKeys(hexKey(q, rr))) {
        const { col: nc, row: nrow } = axialToOffset(nk);
        if (!has(nc, nrow)) continue;
        if (nrow * 10000 + nc <= r * 10000 + c) continue; // canonical order → each edge once
        const A = centre(c, r), B = centre(nc, nrow);
        const mx = (A.cx + B.cx) / 2, my = (A.cy + B.cy) / 2;
        let dx = B.cx - A.cx, dy = B.cy - A.cy; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        const hx = -dy * (S / 2), hy = dx * (S / 2); // perpendicular half-edge
        out.push({ id: edgeId([c, r], [nc, nrow]), a: [c, r], b: [nc, nrow], mx, my, e1: [mx + hx, my + hy], e2: [mx - hx, my - hy] });
      }
    }
    return out;
  }, [cells, cols, rows]);

  // Only walls whose two hexes still exist (after edits/resize) are real — prune the rest from view + export.
  const liveWalls = useMemo(() => edgeList.filter(e => walls.has(e.id)), [edgeList, walls]);

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
    setWalls(new Set());
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
    for (const key of m.glyphSpots ?? []) { const { col, row } = axialToOffset(key); const g = grid[row * nc + col]; if (g) g.gRand = true; }
    const w = new Set<string>();
    for (const [ka, kb] of m.walls ?? []) {
      const A = axialToOffset(ka), B = axialToOffset(kb);
      w.add(edgeId([A.col, A.row], [B.col, B.row]));
    }
    setCols(nc); setRows(nr); setCells(grid); setWalls(w); setName(m.name);
  }

  function saveDraft() {
    try {
      const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
      drafts[name] = { name, cols, rows, cells, walls: [...walls] };
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      setSavedNames(Object.keys(drafts));
    } catch { /* quota */ }
  }
  function loadDraft(n: string) {
    try {
      const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
      const d = drafts[n];
      if (d) { setCols(d.cols); setRows(d.rows); setCells(d.cells); setWalls(new Set(d.walls ?? [])); setName(d.name); }
    } catch { /* ignore */ }
  }

  const slug = useMemo(() => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'custom_map', [name]);

  const stats = useMemo(() => {
    let hexes = 0, zones = 0, trees = 0, glyphs = 0; const byT: Record<string, number> = {};
    for (const c of cells) { if (!c.t) continue; hexes++; byT[c.t] = (byT[c.t] || 0) + 1; if (c.zone) zones++; if (c.tree) trees++; if (c.glyph || c.gRand) glyphs++; }
    return { hexes, zones, trees, glyphs, byT };
  }, [cells]);

  const code = useMemo(() => {
    const rowsTxt: string[] = [];
    for (let r = 0; r < rows; r++) {
      const tk: string[] = [];
      for (let c = 0; c < cols; c++) { const cell = cells[r * cols + c]; tk.push(cell.t ? `${cell.t}${cell.h}${cell.gRand ? '*' : ''}` : '.'); }
      rowsTxt.push(`    row${r + 1}: ${tk.join(' ')}`);
    }
    const wallsTxt = liveWalls.map(e => `    [[${e.a[0]}, ${e.a[1]}], [${e.b[0]}, ${e.b[1]}]],`);
    const wallsArg = wallsTxt.length ? `\n    [\n${wallsTxt.join('\n')}\n    ],` : '';
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
    ],${wallsArg}
  );
${zoneTxt}${treeTxt}  return m;
})();
// then register it: add \`${slug}: ${slug.toUpperCase()}_MAP\` to the MAPS record.`);
  }, [cells, cols, rows, name, slug, liveWalls]);

  const vbW = (DX * cols + DX / 2 + 4).toFixed(0);
  const vbH = (DY * rows + S + 4).toFixed(0);

  const btn = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs font-medium transition ${active ? 'border-sky-400 bg-sky-950/50 text-sky-200 ring-1 ring-sky-400' : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500'}`;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-[110rem] px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><span className="text-sky-400">⬡</span> HeroScape Level Creator</h1>
          <div className="flex items-center gap-3 text-xs">
            <a href="/heroscape-mapeditor" className="text-neutral-400 transition hover:text-sky-300">✶ Star Field editor</a>
            <a href="/lobby" className="text-neutral-400 transition hover:text-emerald-400">← Back to lobby</a>
          </div>
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
          <button onClick={() => setBrush({ kind: 'sculpt' })} className={btn(brush.kind === 'sculpt' && !brush.water)}
            title="Land sculpt — left-click raises, right-click lowers: blank → grass 1/2 → sand 3/4 → rock 5+">⛰ Sculpt</button>
          <button onClick={() => setBrush({ kind: 'sculpt', water: true })} className={btn(brush.kind === 'sculpt' && !!brush.water)}
            title="Water sculpt — left-click raises the pool, right-click lowers it: blank → .5 → 1.5 → 2.5 …">🌊 Sculpt water</button>
          <span className="mr-2 text-[11px] text-neutral-500">left&nbsp;raise · right&nbsp;lower</span>
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
          <button onClick={() => setBrush({ kind: 'glyph' })} className={btn(brush.kind === 'glyph')} title="Place a SPECIFIC glyph">Glyph</button>
          <select value={glyphId} onChange={e => setGlyphId(e.target.value as HSGlyphId)} className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs">
            {GLYPH_IDS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <button onClick={() => setBrush({ kind: 'glyphRandom' })} className={btn(brush.kind === 'glyphRandom')}
            title="Mark a glyph spot — the game rolls a RANDOM glyph here each match">🎲 Random glyph</button>
          <span className="mx-1 text-[11px] uppercase tracking-wide text-neutral-500">Wall</span>
          <button onClick={() => setBrush({ kind: 'wall' })} className={btn(brush.kind === 'wall')}
            title="Click a dot BETWEEN two hexes to toggle a wall on that edge (blocks movement, sight + adjacency)">🧱 Wall</button>
          <button onClick={() => setBrush({ kind: 'erase' })} className={btn(brush.kind === 'erase')}>Erase</button>
          <span className="mx-1 text-[11px] uppercase tracking-wide text-neutral-500">Zone</span>
          {SEAT_COLORS.map((c, i) => (
            <button key={i} onClick={() => setBrush({ kind: 'zone', seat: i + 1 })} className={btn(brush.kind === 'zone' && brush.seat === i + 1)}
              style={{ color: c }}>P{i + 1}</button>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <div onContextMenu={e => e.preventDefault()} className="overflow-auto rounded-lg border border-neutral-800 bg-neutral-900/30 p-2" style={{ maxHeight: '82vh', touchAction: 'none' }}>
            <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: Math.max(Number(vbW), 300), height: 'auto', display: 'block', userSelect: 'none' }}>
              {cells.map((cell, i) => <Hex key={i} cell={cell} col={i % cols} row={Math.floor(i / cols)} onDown={onDown} onEnter={onEnter} />)}
              {/* WALLS — drawn on the hex edges, above the tiles */}
              {liveWalls.map(e => (
                <g key={e.id} pointerEvents="none">
                  <line x1={e.e1[0]} y1={e.e1[1]} x2={e.e2[0]} y2={e.e2[1]} stroke="#1c1917" strokeWidth={7} strokeLinecap="round" />
                  <line x1={e.e1[0]} y1={e.e1[1]} x2={e.e2[0]} y2={e.e2[1]} stroke="#d6d3d1" strokeWidth={3.5} strokeLinecap="round" />
                </g>
              ))}
              {/* Wall mode: a clickable dot on every interior edge — click toggles a wall there */}
              {brush.kind === 'wall' && edgeList.map(e => (
                <circle key={e.id} cx={e.mx} cy={e.my} r={5}
                  fill={walls.has(e.id) ? '#f59e0b' : 'rgba(168,162,158,0.5)'}
                  stroke="#1c1917" strokeWidth={0.6}
                  onClick={() => toggleWall(e.id)} style={{ cursor: 'pointer' }} />
              ))}
            </svg>
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-300">
              <div className="mb-1 font-semibold text-neutral-200">{stats.hexes} hexes</div>
              <div className="text-neutral-400">grass {stats.byT.G || 0} · rock {stats.byT.R || 0} · sand {stats.byT.S || 0} · water {stats.byT.W || 0}</div>
              <div className="text-neutral-400">zones {stats.zones} · trees {stats.trees} · glyphs {stats.glyphs} · walls {liveWalls.length}</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-200">maps.ts code</span>
                <div className="flex gap-1.5">
                  <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="rounded border border-sky-700 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-950/40">{copied ? 'Copied!' : 'Copy'}</button>
                </div>
              </div>
              <textarea readOnly value={code} className="h-64 w-full resize-y rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-[10px] leading-tight text-neutral-300" />
              <p className="mt-2 text-[11px] text-neutral-500">Paste into <code className="text-neutral-400">src/lib/games/heroscape/maps.ts</code> and add it to the <code className="text-neutral-400">MAPS</code> record — or send the code to Claude to wire it in + deploy. Tip: <strong className="text-neutral-300">⛰ Sculpt</strong> raises (left-click) / lowers (right-click) LAND through blank → grass 1/2 → sand 3/4 → rock 5+, and <strong className="text-neutral-300">🌊 Sculpt water</strong> raises / lowers a POOL through .5 → 1.5 → 2.5 … (water reads half a level below its tile height). <strong className="text-neutral-300">🎲 Random glyph</strong> marks a spot whose glyph type is rolled fresh each game. <strong className="text-neutral-300">🧱 Wall</strong> sits on the EDGE between two hexes (click the dot) — it blocks movement, line of sight, and adjacency across that edge. Trees are cosmetic.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
