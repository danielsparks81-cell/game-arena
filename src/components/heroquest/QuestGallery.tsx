'use client';

// HeroQuest quest review — renders the finalized Quest 1 "The Trial" layout on
// the locked 30×23 board (rooms + monsters + furniture + stairs + doors + rock),
// read-only, so it can be checked against the Quest Book. Source: quests/quest1.ts.

import {
  buildQuest1Grid, QUEST1_MONSTERS, QUEST1_FURNITURE, QUEST1_STAIRS, QUEST1_DOORS,
} from '@/lib/games/heroquest/quests/quest1';
import { stairsFanEls } from './Art';
import { furnEls } from './furnitureArt';

const CELL = 23;
const GRID = buildQuest1Grid();
const W = (GRID[0]?.length ?? 30) * CELL;
const H = GRID.length * CELL;
const DOOR_SET = new Set(QUEST1_DOORS.map(d => `${d.x},${d.y},${d.v ? 'v' : 'h'}`));

// green = goblinoids, yellow = undead, grey = dread/stone; label = first letter.
const MON: Record<string, { c: string; t: string; label: string }> = {
  goblin:         { c: '#22c55e', t: '#052e16', label: 'G' },
  orc:            { c: '#22c55e', t: '#052e16', label: 'O' },
  abomination:    { c: '#22c55e', t: '#052e16', label: 'A' },
  skeleton:       { c: '#eab308', t: '#422006', label: 'S' },
  zombie:         { c: '#eab308', t: '#422006', label: 'Z' },
  mummy:          { c: '#eab308', t: '#422006', label: 'M' },
  dread_warrior:  { c: '#9ca3af', t: '#111827', label: 'D' },
  dread_sorcerer: { c: '#9ca3af', t: '#111827', label: 'S' },
  gargoyle:       { c: '#9ca3af', t: '#111827', label: 'G' },
};
const isRoom = (c?: string) => !!c && /[a-z]/.test(c);
const isFloor = (c?: string) => !!c && (c === '.' || c === 'S' || isRoom(c));

// Flood-fill connected blocks of the same room letter into regions (room_1…),
// so two rooms that reuse a letter are still distinct. Mirrors the editor.
function floodRegions(grid: string[][]) {
  const h = grid.length, w = grid[0]?.length ?? 0;
  const region: string[][] = grid.map(r => r.map(() => ''));
  const order: string[] = [];
  let rn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const letter = grid[y][x];
      if (!isRoom(letter) || region[y][x]) continue;
      const id = `room_${++rn}`;
      order.push(id);
      const stack: [number, number][] = [[x, y]];
      region[y][x] = id;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!region[ny][nx] && grid[ny][nx] === letter) { region[ny][nx] = id; stack.push([nx, ny]); }
        }
      }
    }
  }
  // Stairs join the room they border most (matches the engine + editor).
  const stairCells: [number, number][] = [];
  const borders = new Map<string, number>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grid[y][x] !== 'S') continue;
    stairCells.push([x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const r = region[y + dy]?.[x + dx];
      if (r && r.startsWith('room_')) borders.set(r, (borders.get(r) ?? 0) + 1);
    }
  }
  let sr = '', best = 0;
  for (const [r, n] of borders) if (n > best) { best = n; sr = r; }
  if (sr) for (const [x, y] of stairCells) region[y][x] = sr;
  return { region, order };
}
const { region: REGION, order: ROOM_ORDER } = floodRegions(GRID);

// Region key per cell: a room's id (stairs carry their room's id), or 'corridor'
// / 'wall' / '' (rock).
function regionKeyAt(x: number, y: number) {
  const c = GRID[y]?.[x];
  if (isRoom(c) || c === 'S') return REGION[y][x] || 'corridor';
  if (c === '.') return 'corridor';
  if (c === 'W') return 'wall';
  return '';
}
// A door carved into the wall between two cells opens it (top edge of (x,y) when
// v=false, left edge when v=true).
function doorOpen(x: number, y: number, nx: number, ny: number) {
  if (ny === y - 1) return DOOR_SET.has(`${x},${y},h`);
  if (ny === y + 1) return DOOR_SET.has(`${nx},${ny},h`);
  if (nx === x - 1) return DOOR_SET.has(`${x},${y},v`);
  if (nx === x + 1) return DOOR_SET.has(`${nx},${ny},v`);
  return false;
}
function wallBetween(x: number, y: number, nx: number, ny: number) {
  const a = regionKeyAt(x, y), b = regionKeyAt(nx, ny);
  if (a === b) return false;
  if (doorOpen(x, y, nx, ny)) return false;
  return a.startsWith('room') || b.startsWith('room');
}

function StairFan({ cells }: { cells: { x: number; y: number }[] }) {
  const minX = Math.min(...cells.map(c => c.x)), minY = Math.min(...cells.map(c => c.y));
  const maxX = Math.max(...cells.map(c => c.x)), maxY = Math.max(...cells.map(c => c.y));
  const x0 = minX * CELL, y0 = minY * CELL, w = (maxX - minX + 1) * CELL, h = (maxY - minY + 1) * CELL;
  return <g transform={`translate(${x0},${y0})`}>{stairsFanEls(w, h)}</g>;
}

function Board() {
  return (
    <svg viewBox={`-2 -2 ${W + 4} ${H + 4}`} className="w-full h-auto rounded-lg border border-stone-700 bg-black">
      {GRID.map((row, y) => row.map((c, x) => {
        const fill = c === '#' ? '#161311' : c === 'W' ? '#46413a' : isRoom(c) || c === 'S' ? '#e7e2d6' : '#cfc9ba';
        return <rect key={`${x},${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL} fill={fill} stroke="rgba(40,30,20,0.12)" strokeWidth="0.5" />;
      }))}
      {/* solid walls */}
      {GRID.map((row, y) => row.map((c, x) => {
        if (!isFloor(c)) return null;
        const E: React.ReactNode[] = [];
        const mk = (x1: number, y1: number, x2: number, y2: number, k: string) =>
          E.push(<line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0c0a09" strokeWidth="2" />);
        if (wallBetween(x, y, x, y - 1)) mk(x * CELL, y * CELL, (x + 1) * CELL, y * CELL, `t${x},${y}`);
        if (wallBetween(x, y, x, y + 1)) mk(x * CELL, (y + 1) * CELL, (x + 1) * CELL, (y + 1) * CELL, `b${x},${y}`);
        if (wallBetween(x, y, x - 1, y)) mk(x * CELL, y * CELL, x * CELL, (y + 1) * CELL, `l${x},${y}`);
        if (wallBetween(x, y, x + 1, y)) mk((x + 1) * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL, `r${x},${y}`);
        return E.length ? <g key={`w${x},${y}`}>{E}</g> : null;
      }))}
      {/* doors — sit on the wall edge, not on a square (orange bar) */}
      {QUEST1_DOORS.map((d, i) => {
        const x0 = d.x * CELL, y0 = d.y * CELL;
        return d.v
          ? <rect key={`d${i}`} x={x0 - 2.5} y={y0 + 4} width={5} height={CELL - 8} rx="1.5" fill="#d97706" stroke="#7c3a06" strokeWidth="0.8" />
          : <rect key={`d${i}`} x={x0 + 4} y={y0 - 2.5} width={CELL - 8} height={5} rx="1.5" fill="#d97706" stroke="#7c3a06" strokeWidth="0.8" />;
      })}
      <StairFan cells={QUEST1_STAIRS} />
      {QUEST1_FURNITURE.map((f, i) => {
        const uw = f.w * 40, uh = f.h * 40;
        return (
          <svg key={`f${i}`} x={f.x * CELL} y={f.y * CELL} width={f.w * CELL} height={f.h * CELL} viewBox={`0 0 ${uw} ${uh}`}>
            {furnEls(f.kind, f.w, f.h, f.rot ?? 0)}
            <rect x="1" y="1" width={uw - 2} height={uh - 2} rx="2" fill="none"
              stroke={f.los ? '#100b05' : '#e0b97f'} strokeWidth={f.los ? 2.5 : 1.5} strokeDasharray={f.los ? undefined : '5 3'} />
            {f.gold != null && <text x={uw - 4} y={uh - 5} textAnchor="end" fontSize="11" fontWeight="800" fill="#fde68a" stroke="#000" strokeWidth="0.4">{f.gold}</text>}
          </svg>
        );
      })}
      {QUEST1_MONSTERS.map((m, i) => {
        const s = MON[m.kind] ?? { c: '#777', t: '#fff', label: '?' };
        return (
          <g key={`m${i}`} transform={`translate(${m.x * CELL + CELL / 2},${m.y * CELL + CELL / 2})`}>
            <circle r={CELL / 2 - 2} fill={s.c} stroke={m.name ? '#fbbf24' : '#0c0a09'} strokeWidth={m.name ? 2.5 : 1} />
            <text y="3.5" textAnchor="middle" fontSize="11" fontWeight="800" fill={s.t}>{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---- Derived "room contents" (so the table never goes stale) ----
const nice = (k: string) => k.replace(/_/g, ' ');
function summarize(kinds: string[]): string {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${n}× ${nice(k)}` : nice(k))).join(', ');
}
function furnRegion(f: { x: number; y: number; w: number; h: number }) {
  for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) {
    const r = REGION[f.y + dy]?.[f.x + dx];
    if (r) return r;
  }
  return '';
}
const ROOM_ROWS = ROOM_ORDER.map((rid, i) => {
  const mons = QUEST1_MONSTERS.filter(m => REGION[m.y]?.[m.x] === rid).map(m => m.kind);
  const furns = QUEST1_FURNITURE.filter(f => furnRegion(f) === rid).map(f => f.kind);
  return { label: `Room ${i + 1}`, mons, furns };
}).filter(r => r.mons.length || r.furns.length);

export default function QuestGallery() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-amber-200">Quest 1 — The Trial</h2>
        <p className="text-sm text-stone-400">
          The finalized layout on the locked 30×23 board. Unused areas are{' '}
          <strong className="text-stone-200">rock</strong>; doors sit on the walls. Tweak it in Map Authoring → ★ Load Quest 1.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <div>
          <Board />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-400">
            <span><span className="inline-block w-3 h-3 align-middle bg-[#e7e2d6] border border-stone-500" /> room</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#cfc9ba] border border-stone-500" /> hall</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#161311] border border-stone-500" /> rock</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#46413a] border border-stone-500" /> wall</span>
            <span><span className="inline-block w-3 h-1.5 align-middle bg-[#d97706]" /> door (on wall)</span>
            <span>solid furniture outline = blocks line of sight</span>
          </div>
        </div>
        <div className="text-sm">
          <h3 className="font-semibold text-amber-300 mb-1">Room contents</h3>
          <table className="w-full text-stone-300">
            <tbody>
              <tr className="border-b border-stone-800">
                <td className="py-1 pr-2 font-bold text-amber-200 align-top whitespace-nowrap">Stairs</td>
                <td className="py-1">4 hero start squares</td>
              </tr>
              {ROOM_ROWS.map(r => (
                <tr key={r.label} className="border-b border-stone-800">
                  <td className="py-1 pr-2 font-bold text-amber-200 align-top whitespace-nowrap">{r.label}</td>
                  <td className="py-1">
                    {[r.mons.length ? summarize(r.mons) : '', r.furns.length ? summarize(r.furns) : '']
                      .filter(Boolean).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-500">
            Rooms are numbered in reading order (top-left → bottom-right). {QUEST1_MONSTERS.length} monsters,
            {' '}{QUEST1_FURNITURE.length} furniture pieces placed.
          </p>
        </div>
      </div>
    </div>
  );
}
