'use client';

// HeroQuest map editor. Paint the dungeon on a grid — rock, double-wide halls,
// rooms, doors, the entry staircase — then drop furniture and monsters and copy
// out ready-to-paste quest data for src/lib/games/heroquest/content.ts.
//
// Glyphs (also the export format):
//   #  rock     .  corridor/hall     S  stairs     +  door
//   a..h  room floor (region room_<letter>)
//
// State auto-saves to localStorage; nothing touches the server.

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { QUEST1 } from '@/lib/games/heroquest';

type Glyph = string; // '#', '.', 'S', '+', or a room letter 'a'..'h'
type Pt = { x: number; y: number };
type FurnKind =
  | 'chest' | 'table' | 'cupboard' | 'rack' | 'bookshelf'
  | 'throne' | 'tomb' | 'altar' | 'bench' | 'fireplace';
type MonKind =
  | 'goblin' | 'orc' | 'fimir' | 'skeleton' | 'zombie' | 'mummy'
  | 'chaos_warrior' | 'gargoyle';
type Furn = { kind: FurnKind; x: number; y: number; gold?: number };
type Mon = { kind: MonKind; x: number; y: number; named?: boolean };

type Tool =
  | { t: 'rock' } | { t: 'hall' } | { t: 'stairs' } | { t: 'door' } | { t: 'erase' }
  | { t: 'room'; letter: string }
  | { t: 'furniture'; kind: FurnKind }
  | { t: 'monster'; kind: MonKind; named: boolean }
  | { t: 'start' };

const ROOM_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const FURN_KINDS: FurnKind[] = ['chest', 'table', 'cupboard', 'rack', 'bookshelf', 'throne', 'tomb', 'altar', 'bench', 'fireplace'];
const MON_KINDS: MonKind[] = ['goblin', 'orc', 'fimir', 'skeleton', 'zombie', 'mummy', 'chaos_warrior', 'gargoyle'];

/** Furniture default [blocksMove, blocksLos] for export. */
const FURN_BLOCK: Record<FurnKind, [boolean, boolean]> = {
  fireplace: [true, true], throne: [true, true], tomb: [true, true],
  bookshelf: [false, true], rack: [false, true], cupboard: [false, true],
  table: [false, false], chest: [false, false], altar: [false, false], bench: [false, false],
};

const ROOM_TINT: Record<string, string> = {
  a: '#7dd3fc', b: '#86efac', c: '#fca5a5', d: '#fcd34d',
  e: '#c4b5fd', f: '#fdba74', g: '#67e8f9', h: '#f9a8d4',
};
const FURN_ICON: Record<FurnKind, string> = {
  chest: '🧰', table: '🪵', cupboard: '🗄️', rack: '⚔️', bookshelf: '📚',
  throne: '🪑', tomb: '⚰️', altar: '🔯', bench: '🛋️', fireplace: '🔥',
};
const MON_ICON: Record<MonKind, string> = {
  goblin: '👺', orc: '👹', fimir: '🦎', skeleton: '💀', zombie: '🧟',
  mummy: '🧻', chaos_warrior: '🛡️', gargoyle: '😈',
};

const CELL = 24;
const LS_KEY = 'hq-sandbox-v1';

function makeGrid(w: number, h: number, fill: Glyph = '#'): Glyph[][] {
  return Array.from({ length: h }, () => new Array<Glyph>(w).fill(fill));
}

type SaveState = {
  w: number; h: number; grid: Glyph[][];
  furniture: Furn[]; monsters: Mon[]; starts: Pt[];
};

/** Convert the live QUEST1 quest into editor state (so you can start from it). */
function loadTrial(): SaveState {
  const w = QUEST1.width, h = QUEST1.height;
  const grid = makeGrid(w, h, '#');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = QUEST1.tiles[y][x];
      const r = QUEST1.regions[y][x];
      if (k === 'wall' || k === 'blocked') grid[y][x] = '#';
      else if (k === 'door') grid[y][x] = '+';
      else if (k === 'stairs') grid[y][x] = 'S';
      else grid[y][x] = r.startsWith('room_') ? r.slice(5) : '.';
    }
  }
  const furniture: Furn[] = QUEST1.furniture.map(f => ({
    kind: f.kind as FurnKind, x: f.cells[0].x, y: f.cells[0].y,
    gold: f.fixedContent && f.fixedContent.kind === 'gold' ? f.fixedContent.amount : undefined,
  }));
  const monsters: Mon[] = QUEST1.monsters.map(m => ({
    kind: m.kind as MonKind, x: m.at.x, y: m.at.y, named: !!m.displayName,
  }));
  const starts: Pt[] = QUEST1.startCells.map(c => ({ x: c.x, y: c.y }));
  return { w, h, grid, furniture, monsters, starts };
}

export default function HeroQuestSandbox() {
  const [w, setW] = useState(32);
  const [h, setH] = useState(23);
  const [grid, setGrid] = useState<Glyph[][]>(() => makeGrid(32, 23));
  const [furniture, setFurniture] = useState<Furn[]>([]);
  const [monsters, setMonsters] = useState<Mon[]>([]);
  const [starts, setStarts] = useState<Pt[]>([]);
  const [tool, setTool] = useState<Tool>({ t: 'hall' });
  const [painting, setPainting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);

  // Load saved state once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as SaveState;
        if (s.grid?.length) {
          setW(s.w); setH(s.h); setGrid(s.grid);
          setFurniture(s.furniture ?? []); setMonsters(s.monsters ?? []); setStarts(s.starts ?? []);
        }
      }
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  // Auto-save.
  useEffect(() => {
    if (!loaded) return;
    const s: SaveState = { w, h, grid, furniture, monsters, starts };
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, [loaded, w, h, grid, furniture, monsters, starts]);

  const resize = useCallback((nw: number, nh: number) => {
    setW(nw); setH(nh);
    setGrid(prev => {
      const next = makeGrid(nw, nh, '#');
      for (let y = 0; y < Math.min(nh, prev.length); y++)
        for (let x = 0; x < Math.min(nw, prev[0].length); x++) next[y][x] = prev[y][x];
      return next;
    });
    setFurniture(f => f.filter(p => p.x < nw && p.y < nh));
    setMonsters(m => m.filter(p => p.x < nw && p.y < nh));
    setStarts(s => s.filter(p => p.x < nw && p.y < nh));
  }, []);

  const setCellGlyph = useCallback((x: number, y: number, g: Glyph) => {
    setGrid(prev => {
      if (prev[y][x] === g) return prev;
      const next = prev.map(row => row.slice());
      next[y][x] = g;
      return next;
    });
  }, []);

  const toggleList = <T extends Pt>(list: T[], setList: (f: (l: T[]) => T[]) => void, item: T, max?: number) => {
    setList(l => {
      const idx = l.findIndex(p => p.x === item.x && p.y === item.y);
      if (idx >= 0) { const c = l.slice(); c.splice(idx, 1); return c; }
      const c = [...l, item];
      return max && c.length > max ? c.slice(c.length - max) : c;
    });
  };

  const applyTool = useCallback((x: number, y: number) => {
    switch (tool.t) {
      case 'rock':   setCellGlyph(x, y, '#'); break;
      case 'hall':   setCellGlyph(x, y, '.'); break;
      case 'stairs': setCellGlyph(x, y, 'S'); break;
      case 'door':   setCellGlyph(x, y, '+'); break;
      case 'room':   setCellGlyph(x, y, tool.letter); break;
      case 'erase':  setCellGlyph(x, y, '#'); break;
      case 'furniture':
        toggleList(furniture, setFurniture, { kind: tool.kind, x, y });
        break;
      case 'monster':
        toggleList(monsters, setMonsters, { kind: tool.kind, x, y, named: tool.named });
        break;
      case 'start':
        toggleList(starts, setStarts, { x, y }, 4);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, furniture, monsters, starts, setCellGlyph]);

  const furnAt = useMemo(() => {
    const m = new Map<string, Furn>();
    for (const f of furniture) m.set(`${f.x},${f.y}`, f);
    return m;
  }, [furniture]);
  const monAt = useMemo(() => {
    const m = new Map<string, Mon>();
    for (const mo of monsters) m.set(`${mo.x},${mo.y}`, mo);
    return m;
  }, [monsters]);
  const startSet = useMemo(() => new Set(starts.map(s => `${s.x},${s.y}`)), [starts]);

  // ---- Validation hints ----
  const warnings = useMemo(() => {
    const out: string[] = [];
    const regionAt = (x: number, y: number) => {
      const g = grid[y]?.[x];
      if (!g) return '';
      if (ROOM_LETTERS.includes(g)) return `room_${g}`;
      if (g === '.') return 'corridor';
      if (g === 'S') return 'stairway';
      if (g === '+') return 'door';
      return '';
    };
    for (const m of monsters) {
      const r = regionAt(m.x, m.y);
      if (!r.startsWith('room_')) out.push(`Monster (${m.kind}) at ${m.x},${m.y} is not inside a room.`);
    }
    for (const f of furniture) {
      const g = grid[f.y]?.[f.x];
      if (g === '#') out.push(`Furniture (${f.kind}) at ${f.x},${f.y} is on rock.`);
    }
    for (const s of starts) {
      if (grid[s.y]?.[s.x] !== 'S') out.push(`Start cell ${s.x},${s.y} is not on a staircase tile.`);
    }
    if (!monsters.some(m => m.named)) out.push('No named boss (mark one monster "named" — it becomes Verag).');
    if (starts.length === 0) out.push('No start cells marked (place up to 4 on staircase tiles).');
    return out;
  }, [grid, monsters, furniture, starts]);

  // ---- Export ----
  const buildExport = useCallback(() => {
    const rows = grid.map(r => `  '${r.join('')}', `).join('\n');
    const regionOf = (x: number, y: number) => {
      const g = grid[y]?.[x];
      return ROOM_LETTERS.includes(g) ? `room_${g}` : 'corridor';
    };
    const furnLines = furniture.map(f => {
      const [bm, bl] = FURN_BLOCK[f.kind];
      const fc = f.gold != null ? `, { kind: 'gold', amount: ${f.gold} }` : '';
      return `  furn('${f.kind}', ${f.x}, ${f.y}, ${bm}, ${bl}${fc});`;
    }).join('\n');
    const monLines = monsters.map(m => {
      const opts = m.named ? `, { displayName: 'Verag' }` : '';
      return `  mob('${m.kind}', ${m.x}, ${m.y}, '${regionOf(m.x, m.y)}'${opts});`;
    }).join('\n');
    const startLine = `const startCells = [${starts.map(s => `{ x: ${s.x}, y: ${s.y} }`).join(', ')}];`;
    const text =
`const QUEST1_W = ${w};
const QUEST1_H = ${h};

const QUEST1_MAP: string[] = [
${rows}
];

// --- furniture ---
${furnLines}

// --- monsters ---
${monLines}

// --- start cells ---
${startLine}`;
    setExportText(text);
  }, [grid, furniture, monsters, starts, w, h]);

  const cellStyle = (x: number, y: number): CSSProperties => {
    const g = grid[y][x];
    let bg = '#1a1410';
    if (g === '.') bg = '#d8c8a8';
    else if (g === 'S') bg = '#5eead4';
    else if (g === '+') bg = '#b45309';
    else if (ROOM_LETTERS.includes(g)) bg = ROOM_TINT[g] ?? '#e5e5e5';
    else bg = '#241a12'; // rock
    return {
      width: CELL, height: CELL, background: bg,
      boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.25)',
      fontSize: 13, lineHeight: `${CELL}px`, textAlign: 'center',
      cursor: 'pointer', userSelect: 'none', position: 'relative',
    };
  };

  return (
    <div
      className="min-h-screen bg-neutral-950 p-4 text-neutral-200"
      onMouseUp={() => setPainting(false)}
      onMouseLeave={() => setPainting(false)}
    >
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">HeroQuest — Map Sandbox</h1>
          <Link href="/lobby" className="text-sm text-emerald-400 hover:underline">← Back to lobby</Link>
        </div>

        <div className="flex flex-wrap gap-4">
          {/* Toolbar */}
          <div className="w-64 shrink-0 space-y-3">
            <Section title="Brush">
              <div className="grid grid-cols-2 gap-1">
                <ToolBtn active={tool.t === 'hall'} onClick={() => setTool({ t: 'hall' })}>Hall</ToolBtn>
                <ToolBtn active={tool.t === 'rock'} onClick={() => setTool({ t: 'rock' })}>Rock</ToolBtn>
                <ToolBtn active={tool.t === 'door'} onClick={() => setTool({ t: 'door' })}>Door</ToolBtn>
                <ToolBtn active={tool.t === 'stairs'} onClick={() => setTool({ t: 'stairs' })}>Stairs</ToolBtn>
                <ToolBtn active={tool.t === 'start'} onClick={() => setTool({ t: 'start' })}>Start ×4</ToolBtn>
                <ToolBtn active={tool.t === 'erase'} onClick={() => setTool({ t: 'erase' })}>Erase</ToolBtn>
              </div>
            </Section>

            <Section title="Room floor">
              <div className="grid grid-cols-4 gap-1">
                {ROOM_LETTERS.map(l => (
                  <button
                    key={l}
                    onClick={() => setTool({ t: 'room', letter: l })}
                    className={`rounded px-2 py-1 text-xs font-bold uppercase ${tool.t === 'room' && tool.letter === l ? 'ring-2 ring-white' : ''}`}
                    style={{ background: ROOM_TINT[l], color: '#1a1410' }}
                  >{l}</button>
                ))}
              </div>
            </Section>

            <Section title="Furniture">
              <div className="grid grid-cols-2 gap-1">
                {FURN_KINDS.map(k => (
                  <ToolBtn key={k} active={tool.t === 'furniture' && tool.kind === k} onClick={() => setTool({ t: 'furniture', kind: k })}>
                    {FURN_ICON[k]} {k}
                  </ToolBtn>
                ))}
              </div>
            </Section>

            <Section title="Monsters">
              <label className="mb-1 flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={tool.t === 'monster' ? tool.named : false}
                  onChange={e => setTool(t => t.t === 'monster' ? { ...t, named: e.target.checked } : t)}
                /> place as named boss (Verag)
              </label>
              <div className="grid grid-cols-2 gap-1">
                {MON_KINDS.map(k => (
                  <ToolBtn key={k} active={tool.t === 'monster' && tool.kind === k} onClick={() => setTool(t => ({ t: 'monster', kind: k, named: t.t === 'monster' ? t.named : false }))}>
                    {MON_ICON[k]} {k.replace('_', ' ')}
                  </ToolBtn>
                ))}
              </div>
            </Section>

            <Section title="Board">
              <div className="flex items-center gap-2 text-xs">
                <label>W <input type="number" value={w} min={10} max={48} onChange={e => resize(Math.max(10, Math.min(48, +e.target.value || 10)), h)} className="w-14 rounded bg-neutral-800 px-1 py-0.5" /></label>
                <label>H <input type="number" value={h} min={10} max={36} onChange={e => resize(w, Math.max(10, Math.min(36, +e.target.value || 10)))} className="w-14 rounded bg-neutral-800 px-1 py-0.5" /></label>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <SmallBtn onClick={() => { const t = loadTrial(); setW(t.w); setH(t.h); setGrid(t.grid); setFurniture(t.furniture); setMonsters(t.monsters); setStarts(t.starts); }}>Load current Trial</SmallBtn>
                <SmallBtn onClick={() => { if (confirm('Clear the whole map?')) { setGrid(makeGrid(w, h)); setFurniture([]); setMonsters([]); setStarts([]); } }}>Clear</SmallBtn>
              </div>
            </Section>

            <Section title="Export">
              <SmallBtn onClick={buildExport}>Generate quest data →</SmallBtn>
            </Section>
          </div>

          {/* Grid */}
          <div className="min-w-0 flex-1 overflow-auto">
            <div
              className="inline-block select-none rounded border border-neutral-700"
              style={{ display: 'grid', gridTemplateColumns: `repeat(${w}, ${CELL}px)` }}
              onMouseDown={() => setPainting(true)}
            >
              {grid.map((row, y) => row.map((_, x) => {
                const f = furnAt.get(`${x},${y}`);
                const mo = monAt.get(`${x},${y}`);
                const isStart = startSet.has(`${x},${y}`);
                return (
                  <div
                    key={`${x},${y}`}
                    style={cellStyle(x, y)}
                    title={`${x},${y}`}
                    onMouseDown={() => applyTool(x, y)}
                    onMouseEnter={() => { if (painting && (tool.t === 'rock' || tool.t === 'hall' || tool.t === 'door' || tool.t === 'stairs' || tool.t === 'room' || tool.t === 'erase')) applyTool(x, y); }}
                  >
                    {mo ? <span style={{ filter: mo.named ? 'drop-shadow(0 0 2px #f59e0b)' : undefined }}>{MON_ICON[mo.kind]}</span>
                      : f ? <span>{FURN_ICON[f.kind]}</span>
                      : isStart ? <span style={{ color: '#0f766e', fontWeight: 700 }}>◊</span>
                      : null}
                  </div>
                );
              }))}
            </div>
          </div>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="mt-3 rounded border border-amber-600/40 bg-amber-500/10 p-2 text-xs text-amber-200">
            <div className="mb-1 font-semibold">Checks</div>
            <ul className="list-disc pl-4">{warnings.slice(0, 8).map((wn, i) => <li key={i}>{wn}</li>)}</ul>
          </div>
        )}

        {/* Export output */}
        {exportText && (
          <div className="mt-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-semibold">Quest data</span>
              <SmallBtn onClick={() => navigator.clipboard?.writeText(exportText)}>Copy</SmallBtn>
              <SmallBtn onClick={() => setExportText(null)}>Close</SmallBtn>
            </div>
            <textarea readOnly value={exportText} className="h-72 w-full rounded border border-neutral-700 bg-neutral-900 p-2 font-mono text-[11px] leading-snug" />
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{title}</div>
      {children}
    </div>
  );
}

function ToolBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-left text-xs transition ${active ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}
    >{children}</button>
  );
}

function SmallBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 transition hover:bg-neutral-700">{children}</button>
  );
}
