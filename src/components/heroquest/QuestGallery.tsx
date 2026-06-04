'use client';

// HeroQuest quest-map review gallery. Renders quests on the LOCKED 32×23 board
// (wider halls + larger rooms — the live game board). Read-only comparison tool.
// Quest 1 placement is final; quests 2–14 are rough drafts until we lock the
// placement ruleset on Quest 1 and apply it across the board.

import { useState } from 'react';
import { BOARD32, ROOMS32, type RoomLabel, type Cell } from '@/lib/games/heroquest/quests/board32';
import { generateConnectingDoors } from '@/lib/games/heroquest/board';
import {
  QUEST_MAPS, type QuestMap, type MapMonster, type MapFurniture, type MapTrap,
} from '@/lib/games/heroquest/quests/maps';

const CELL = 24;
const W = BOARD32.width * CELL;
const H = BOARD32.height * CELL;
const DOORS = generateConnectingDoors();

const MON: Record<MapMonster['kind'], { c: string; t: string; label: string }> = {
  goblin:        { c: '#4d7c2f', t: '#fff', label: 'Gob' },
  orc:           { c: '#3f6212', t: '#fff', label: 'Orc' },
  skeleton:      { c: '#e7e5e4', t: '#1c1917', label: 'Skl' },
  zombie:        { c: '#65a30d', t: '#fff', label: 'Zom' },
  abomination:   { c: '#7e22ce', t: '#fff', label: 'Abm' },
  mummy:         { c: '#ca8a04', t: '#fff', label: 'Mum' },
  dread_warrior: { c: '#991b1b', t: '#fff', label: 'DW' },
  gargoyle:      { c: '#57534e', t: '#fff', label: 'Gar' },
  dread_sorcerer:{ c: '#1e1b4b', t: '#fff', label: 'DS' },
};

const FURN_GLYPH: Record<MapFurniture['kind'], string> = {
  table: '▬', chest: '▣', cupboard: '▦', bookcase: '▤', rack: '☰', weapon_rack: '⚔',
  throne: '♛', tomb: '⚰', fireplace: '✶', sorcerer_table: '✦', alchemist_bench: '⚗',
};

const TRAP_GLYPH: Record<MapTrap['kind'], { g: string; c: string }> = {
  pit: { g: '▢', c: '#a16207' }, spear: { g: '╱', c: '#ea580c' },
  falling_block: { g: '▨', c: '#b91c1c' }, chest: { g: '▣', c: '#a16207' },
};

/** Resolve overlaps: items sharing a cell get fanned out around the centre. */
function spread<T extends { at: Cell }>(items: T[]): (T & { px: number; py: number })[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = `${it.at.x},${it.at.y}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  const out: (T & { px: number; py: number })[] = [];
  for (const [k, list] of groups) {
    const [cx, cy] = k.split(',').map(Number);
    const bx = cx * CELL + CELL / 2, by = cy * CELL + CELL / 2;
    if (list.length === 1) { out.push({ ...list[0], px: bx, py: by }); continue; }
    const rad = CELL * 0.32;
    list.forEach((it, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      out.push({ ...it, px: bx + Math.cos(a) * rad, py: by + Math.sin(a) * rad });
    });
  }
  return out;
}

function StairFan({ cells }: { cells: Cell[] }) {
  const minX = Math.min(...cells.map(c => c.x)), minY = Math.min(...cells.map(c => c.y));
  const maxX = Math.max(...cells.map(c => c.x)), maxY = Math.max(...cells.map(c => c.y));
  // Fan of steps radiating from the room-facing corner.
  const x0 = minX * CELL, y0 = minY * CELL;
  const w = (maxX - minX + 1) * CELL, h = (maxY - minY + 1) * CELL;
  const ox = x0, oy = y0;                  // origin corner (top-left of the staircase)
  const R = Math.max(w, h);
  const arcs = [], rads = [];
  for (let i = 1; i <= 6; i++) {
    const r = (R * i) / 6;
    arcs.push(<path key={`a${i}`} d={`M ${ox + r} ${oy} A ${r} ${r} 0 0 1 ${ox} ${oy + r}`} fill="none" stroke="#475569" strokeWidth="1.3" />);
  }
  for (const deg of [15, 38, 62, 85]) {
    const a = (deg * Math.PI) / 180;
    rads.push(<line key={`r${deg}`} x1={ox} y1={oy} x2={ox + Math.cos(a) * R} y2={oy + Math.sin(a) * R} stroke="#475569" strokeWidth="1.1" />);
  }
  return (
    <g>
      <rect x={x0} y={y0} width={w} height={h} fill="#94a3b8" stroke="#1e3a5f" strokeWidth="2" />
      {arcs}{rads}
      <text x={x0 + w - 3} y={y0 + h - 4} textAnchor="end" fontSize="8" fontWeight="800" fill="#1e293b">STAIRS · 1 space</text>
    </g>
  );
}

function Board({ q }: { q: QuestMap }) {
  const monsters = spread(q.monsters);
  const furniture = spread(q.furniture);
  return (
    <svg viewBox={`-2 -2 ${W + 4} ${H + 4}`} className="w-full h-auto rounded-lg border border-stone-700 bg-black">
      {/* tiles (the board's built-in stair cells render as ordinary room floor;
          each quest's staircase is drawn as one fan wherever the quest puts it) */}
      {BOARD32.tiles.map((row, y) =>
        row.map((tile, x) => {
          const reg = BOARD32.regions[y][x];
          const fill = tile === 'wall' ? '#161311' : reg.startsWith('room_') ? '#e7e2d6' : '#a8a29e';
          return <rect key={`${x},${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL} fill={fill} stroke="#3f3a36" strokeWidth="0.4" />;
        }),
      )}
      {/* room outlines */}
      {BOARD32.regions.map((row, y) =>
        row.map((reg, x) => {
          if (!reg.startsWith('room_')) return null;
          const diff = (nx: number, ny: number) => (BOARD32.regions[ny]?.[nx] ?? '') !== reg;
          const E: React.ReactNode[] = [];
          const mk = (x1: number, y1: number, x2: number, y2: number, k: string) =>
            E.push(<line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#44403c" strokeWidth="1.6" />);
          if (diff(x - 1, y)) mk(x * CELL, y * CELL, x * CELL, (y + 1) * CELL, `l${x},${y}`);
          if (diff(x + 1, y)) mk((x + 1) * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL, `r${x},${y}`);
          if (diff(x, y - 1)) mk(x * CELL, y * CELL, (x + 1) * CELL, y * CELL, `t${x},${y}`);
          if (diff(x, y + 1)) mk(x * CELL, (y + 1) * CELL, (x + 1) * CELL, (y + 1) * CELL, `b${x},${y}`);
          return E.length ? <g key={`o${x},${y}`}>{E}</g> : null;
        }),
      )}
      {/* doors (auto-connecting, orange) */}
      {DOORS.map((d, i) => d.crossings.map((cr, j) => {
        const mx = (cr.a.x + cr.b.x + 1) / 2 * CELL, my = (cr.a.y + cr.b.y + 1) / 2 * CELL;
        const horiz = cr.a.y === cr.b.y;
        return <rect key={`d${i}-${j}`} x={mx - (horiz ? 2 : CELL * 0.34)} y={my - (horiz ? CELL * 0.34 : 2)}
          width={horiz ? 4 : CELL * 0.68} height={horiz ? CELL * 0.68 : 4} fill="#ea7c2f" stroke="#7c2d12" strokeWidth="0.5" />;
      }))}

      {/* room labels */}
      {(Object.keys(ROOMS32) as RoomLabel[]).map(l => {
        const r = ROOMS32[l];
        return <text key={l} x={r.minX * CELL + 2} y={r.minY * CELL + 9} fontSize="8" fontWeight="700" fill="#9a8f7a">{l}</text>;
      })}

      <StairFan cells={q.stairs ?? BOARD32.stairway.cells} />
      {q.startMarker && (
        <g transform={`translate(${q.startMarker.x * CELL + CELL / 2},${q.startMarker.y * CELL + CELL / 2})`}>
          <rect x={-CELL / 2} y={-CELL / 2} width={CELL} height={CELL} fill="none" stroke="#22d3ee" strokeWidth="2" strokeDasharray="3 2" />
          <text y="4" textAnchor="middle" fontSize="8" fill="#22d3ee" fontWeight="700">START</text>
        </g>
      )}

      {/* traps */}
      {q.traps.map((t, i) => (
        <text key={`t${i}`} x={t.at.x * CELL + CELL / 2} y={t.at.y * CELL + CELL / 2 + 5}
          textAnchor="middle" fontSize="15" fontWeight="800" fill={TRAP_GLYPH[t.kind].c}>{TRAP_GLYPH[t.kind].g}</text>
      ))}
      {/* furniture */}
      {furniture.map((f, i) => (
        <g key={`f${i}`} transform={`translate(${f.px},${f.py})`}>
          <rect x={-CELL / 2 + 3} y={-CELL / 2 + 3} width={CELL - 6} height={CELL - 6} rx="2" fill="#6b4423" stroke="#3f2a14" strokeWidth="1" />
          <text y="5" textAnchor="middle" fontSize="13" fill="#fde68a">{FURN_GLYPH[f.kind]}</text>
          {f.label && <text x={CELL / 2 - 4} y={-CELL / 2 + 9} textAnchor="end" fontSize="8" fontWeight="800" fill="#fff">{f.label}</text>}
        </g>
      ))}
      {/* monsters */}
      {monsters.map((m, i) => {
        const s = MON[m.kind];
        return (
          <g key={`m${i}`} transform={`translate(${m.px},${m.py})`}>
            <circle r={CELL / 2 - 2} fill={s.c} stroke={m.name ? '#fbbf24' : '#0c0a09'} strokeWidth={m.name ? 2 : 1} />
            <text y="3" textAnchor="middle" fontSize="8" fontWeight="800" fill={s.t}>{s.label}</text>
            {m.name && <text y={CELL / 2 + 6} textAnchor="middle" fontSize="8" fill="#fbbf24">★</text>}
          </g>
        );
      })}
    </svg>
  );
}

export default function QuestGallery() {
  const [idx, setIdx] = useState(0);
  const q = QUEST_MAPS[idx];
  const isFinal = q.status === 'final';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-amber-200">HeroQuest — Quest Map Gallery</h2>
        <p className="text-sm text-stone-400">
          All 14 quests on the <strong className="text-stone-200">locked 32×23 board</strong> (wider halls, larger
          rooms). Quest 1 is final; quests 2–14 have the placement ruleset applied (stairway relocated
          per the book, exact monster counts) — verify monster/furniture rooms against the book.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUEST_MAPS.map((m, i) => (
          <button key={m.id} onClick={() => setIdx(i)}
            className={`px-2.5 py-1 rounded text-xs font-semibold border transition ${
              i === idx ? 'bg-amber-500 text-stone-900 border-amber-400'
                        : 'bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700'}`}>
            {m.n}. {m.name}{m.status === 'final' ? '' : ' •'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-amber-100">Quest {q.n}: {q.name}</h3>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${isFinal ? 'bg-emerald-800 text-emerald-100' : 'bg-amber-900 text-amber-200'}`}>
              {isFinal ? 'PLACEMENT FINAL' : 'DRAFT — verify vs book'}
            </span>
          </div>
          <Board q={q} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-400">
            <span><span className="inline-block w-3 h-3 align-middle bg-[#e7e2d6] border border-stone-500" /> room</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#a8a29e] border border-stone-500" /> hall</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#161311] border border-stone-500" /> rock</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#ea7c2f] border border-stone-500" /> door</span>
            <span>★ named/boss · letters = room labels & note anchors</span>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
            <p className="italic text-amber-100/90 leading-snug">{q.briefing}</p>
          </div>
          <dl className="space-y-1.5">
            <div><dt className="inline font-semibold text-amber-300">Objective: </dt><dd className="inline text-stone-200">{q.objective}</dd></div>
            <div><dt className="inline font-semibold text-amber-300">Reward: </dt><dd className="inline text-stone-200">{q.reward}</dd></div>
            <div><dt className="inline font-semibold text-amber-300">Wandering monster: </dt><dd className="inline text-stone-200">{q.wandering}</dd></div>
            {q.special && <div><dt className="inline font-semibold text-amber-300">Special: </dt><dd className="inline text-stone-300">{q.special}</dd></div>}
          </dl>
          {q.notes.length > 0 && (
            <div>
              <h4 className="font-semibold text-amber-300 mb-1">Notes</h4>
              <ul className="space-y-1.5">
                {q.notes.map((n, i) => (
                  <li key={i} className="text-stone-300 leading-snug">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-100 text-amber-900 text-[11px] font-bold mr-1.5 align-middle">{n.label}</span>
                    {n.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-xs text-stone-500">{q.monsters.length} monsters · {q.furniture.length} furniture · {q.traps.length} traps</div>
        </div>
      </div>
    </div>
  );
}
