'use client';

// HeroQuest quest review — renders Quest 1 "The Trial" on the locked 30×23 board
// (rooms + monsters + furniture + stairs + doors + this quest's rock), read-only,
// so the layout can be checked against the Quest Book. Source: quests/quest1.ts.

import {
  buildQuest1Grid, QUEST1_MONSTERS, QUEST1_FURNITURE, QUEST1_STAIRS,
} from '@/lib/games/heroquest/quests/quest1';

const CELL = 23;
const GRID = buildQuest1Grid();
const W = (GRID[0]?.length ?? 30) * CELL;
const H = GRID.length * CELL;

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
const FURN_GLYPH: Record<string, string> = { tomb: '⚰', chest: '▣', weapon_rack: '⚔', rack: '☰', table: '▬' };

const isRoom = (c?: string) => !!c && /[a-z]/.test(c);
const isFloor = (c?: string) => !!c && (c === '.' || c === 'S' || c === '+' || isRoom(c));
const regionKey = (c?: string) => (isRoom(c) ? c! : c === '.' || c === 'S' ? '.' : c === '+' ? 'door' : 'x');
function wallBetween(x: number, y: number, nx: number, ny: number) {
  const a = GRID[y]?.[x], b = GRID[ny]?.[nx];
  if (!isFloor(a)) return false;
  if (!isFloor(b)) return true;
  if (a === '+' || b === '+') return false;
  const ra = regionKey(a), rb = regionKey(b);
  if (ra === '.' && rb === '.') return false;
  return ra !== rb;
}

function StairFan({ cells }: { cells: { x: number; y: number }[] }) {
  const minX = Math.min(...cells.map(c => c.x)), minY = Math.min(...cells.map(c => c.y));
  const maxX = Math.max(...cells.map(c => c.x)), maxY = Math.max(...cells.map(c => c.y));
  const x0 = minX * CELL, y0 = minY * CELL, w = (maxX - minX + 1) * CELL, h = (maxY - minY + 1) * CELL;
  const R = Math.max(w, h), arcs = [];
  for (let i = 1; i <= 6; i++) {
    const r = (R * i) / 6;
    arcs.push(<path key={i} d={`M ${x0 + r} ${y0} A ${r} ${r} 0 0 1 ${x0} ${y0 + r}`} fill="none" stroke="#475569" strokeWidth="1.2" />);
  }
  return (
    <g>
      <rect x={x0} y={y0} width={w} height={h} fill="#94a3b8" stroke="#1e3a5f" strokeWidth="2" />
      {arcs}
      <text x={x0 + w - 2} y={y0 + h - 3} textAnchor="end" fontSize="7" fontWeight="800" fill="#1e293b">STAIRS</text>
    </g>
  );
}

function Board() {
  return (
    <svg viewBox={`-2 -2 ${W + 4} ${H + 4}`} className="w-full h-auto rounded-lg border border-stone-700 bg-black">
      {GRID.map((row, y) => row.map((c, x) => {
        const fill = c === '#' || c === 'W' ? '#161311' : c === '+' ? '#b45309' : isRoom(c) ? '#e7e2d6' : c === 'S' ? '#e7e2d6' : '#cfc9ba';
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
      <StairFan cells={QUEST1_STAIRS} />
      {QUEST1_FURNITURE.map((f, i) => (
        <g key={`f${i}`} transform={`translate(${f.x * CELL},${f.y * CELL})`}>
          <rect x="2.5" y="2.5" width={CELL - 5} height={CELL - 5} rx="2" fill="#6b4423" stroke="#3f2a14" strokeWidth="1" />
          <text x={CELL / 2} y={CELL / 2 + 4} textAnchor="middle" fontSize="12" fill="#fde68a">{FURN_GLYPH[f.kind] ?? '▦'}</text>
          {f.gold != null && <text x={CELL / 2} y={CELL - 3} textAnchor="middle" fontSize="7" fontWeight="800" fill="#fde68a">{f.gold}</text>}
        </g>
      ))}
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

const ROOMS: [string, string][] = [
  ['9', 'staircase + 4 hero starts'], ['A', '2 skeletons'], ['B', 'Guardian mummy + 2 zombies'],
  ['C', "Fellmarg's tomb + 84-gold chest + mummy + 2 skeletons"], ['3', 'goblin + orc'], ['4', '2 goblins'],
  ['5', 'Verag + 2 orcs + dread warrior + 120-gold chest'], ['6', 'goblin + orc'], ['10', '2 orcs'],
  ['G', 'weapon rack + goblin + abomination'], ['H', '2 dread warriors + empty chest'],
];

export default function QuestGallery() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-amber-200">Quest 1 — The Trial</h2>
        <p className="text-sm text-stone-400">
          On the locked 30×23 board. The shaded right side is <strong className="text-stone-200">rock</strong> (unused this
          quest); doors are auto-placed and can be nudged in Map Authoring.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <div>
          <Board />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-400">
            <span><span className="inline-block w-3 h-3 align-middle bg-[#e7e2d6] border border-stone-500" /> room</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#cfc9ba] border border-stone-500" /> hall</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#161311] border border-stone-500" /> rock</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#b45309] border border-stone-500" /> door</span>
            <span>gold ring = named (Verag / Guardian)</span>
          </div>
        </div>
        <div className="text-sm">
          <h3 className="font-semibold text-amber-300 mb-1">Room contents</h3>
          <table className="w-full text-stone-300">
            <tbody>
              {ROOMS.map(([r, t]) => (
                <tr key={r} className="border-b border-stone-800">
                  <td className="py-1 pr-2 font-bold text-amber-200 align-top">{r}</td>
                  <td className="py-1">{t}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-500">
            To tweak exact squares or doors: Map Authoring tab → ★ Load Quest 1, then nudge with the brushes.
          </p>
        </div>
      </div>
    </div>
  );
}
