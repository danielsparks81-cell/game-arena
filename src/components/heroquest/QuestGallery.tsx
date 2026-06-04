'use client';

// HeroQuest quest-map review gallery. Renders all 14 Quest Book quests on the
// shared 26×19 board so the layouts can be flipped through and checked against a
// physical copy. Read-only — this is a comparison tool, not the playable board.

import { useState } from 'react';
import { BOARD26 } from '@/lib/games/heroquest/quests/board26';
import {
  QUEST_MAPS, type QuestMap, type MapMonster, type MapFurniture, type MapTrap,
} from '@/lib/games/heroquest/quests/maps';

const CELL = 26;
const W = BOARD26.width * CELL;
const H = BOARD26.height * CELL;

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
  pit: { g: '▢', c: '#a16207' },
  spear: { g: '╱', c: '#ea580c' },
  falling_block: { g: '▨', c: '#b91c1c' },
  chest: { g: '▣', c: '#a16207' },
};

function Board({ q }: { q: QuestMap }) {
  const rock = new Set(q.rockRooms);
  const stairSet = new Set(q.stairs.map(s => `${s.x},${s.y}`));

  return (
    <svg viewBox={`-2 -2 ${W + 4} ${H + 4}`} className="w-full h-auto rounded-lg border border-stone-700 bg-stone-900">
      <defs>
        <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#1c1917" strokeWidth="3" />
        </pattern>
        <pattern id="stairs" width={CELL} height={CELL / 4} patternUnits="userSpaceOnUse">
          <rect width={CELL} height={CELL / 4} fill="#1e3a5f" />
          <line x1="0" y1="0" x2={CELL} y2="0" stroke="#7dd3fc" strokeWidth="1.5" />
        </pattern>
      </defs>

      {/* cells */}
      {BOARD26.regionAt.map((row, y) =>
        row.map((reg, x) => {
          const isRoom = reg.startsWith('room_');
          const isRock = isRoom && rock.has(reg);
          const isStair = stairSet.has(`${x},${y}`);
          const fill = isStair ? 'url(#stairs)' : isRock ? '#292524' : isRoom ? '#e7e2d6' : '#cfc9ba';
          return (
            <rect key={`${x},${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL}
              fill={fill} stroke="#a8a29e" strokeWidth="0.5" />
          );
        }),
      )}
      {/* rock hatch overlay */}
      {BOARD26.regionAt.map((row, y) =>
        row.map((reg, x) =>
          reg.startsWith('room_') && rock.has(reg)
            ? <rect key={`r${x},${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL} fill="url(#hatch)" opacity="0.5" />
            : null,
        ),
      )}
      {/* room outlines (thicker borders where region changes) */}
      {BOARD26.regionAt.map((row, y) =>
        row.map((reg, x) => {
          if (!reg.startsWith('room_')) return null;
          const edges: React.ReactNode[] = [];
          const mk = (x1: number, y1: number, x2: number, y2: number, k: string) =>
            edges.push(<line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#44403c" strokeWidth="1.6" />);
          const diff = (nx: number, ny: number) => (BOARD26.regionAt[ny]?.[nx] ?? '') !== reg;
          if (diff(x - 1, y)) mk(x * CELL, y * CELL, x * CELL, (y + 1) * CELL, `l${x},${y}`);
          if (diff(x + 1, y)) mk((x + 1) * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL, `r${x},${y}`);
          if (diff(x, y - 1)) mk(x * CELL, y * CELL, (x + 1) * CELL, y * CELL, `t${x},${y}`);
          if (diff(x, y + 1)) mk(x * CELL, (y + 1) * CELL, (x + 1) * CELL, (y + 1) * CELL, `b${x},${y}`);
          return <g key={`o${x},${y}`}>{edges}</g>;
        }),
      )}

      {/* start marker */}
      {q.startMarker && (
        <g transform={`translate(${q.startMarker.x * CELL + CELL / 2},${q.startMarker.y * CELL + CELL / 2})`}>
          <rect x={-CELL / 2} y={-CELL / 2} width={CELL} height={CELL} fill="none" stroke="#22d3ee" strokeWidth="2" strokeDasharray="3 2" />
          <text y="4" textAnchor="middle" fontSize="9" fill="#22d3ee" fontWeight="700">START</text>
        </g>
      )}

      {/* traps */}
      {q.traps.map((t, i) => (
        <text key={`t${i}`} x={t.at.x * CELL + CELL / 2} y={t.at.y * CELL + CELL / 2 + 5}
          textAnchor="middle" fontSize="15" fontWeight="800" fill={TRAP_GLYPH[t.kind].c}>{TRAP_GLYPH[t.kind].g}</text>
      ))}

      {/* furniture */}
      {q.furniture.map((f, i) => (
        <g key={`f${i}`} transform={`translate(${f.at.x * CELL},${f.at.y * CELL})`}>
          <rect x="3" y="3" width={CELL - 6} height={CELL - 6} rx="2" fill="#6b4423" stroke="#3f2a14" strokeWidth="1" />
          <text x={CELL / 2} y={CELL / 2 + 5} textAnchor="middle" fontSize="13" fill="#fde68a">{FURN_GLYPH[f.kind]}</text>
          {f.label && <text x={CELL - 3} y="9" textAnchor="end" fontSize="8" fontWeight="800" fill="#fff">{f.label}</text>}
        </g>
      ))}

      {/* monsters */}
      {q.monsters.map((m, i) => {
        const s = MON[m.kind];
        return (
          <g key={`m${i}`} transform={`translate(${m.at.x * CELL + CELL / 2},${m.at.y * CELL + CELL / 2})`}>
            <circle r={CELL / 2 - 2} fill={s.c} stroke={m.name ? '#fbbf24' : '#0c0a09'} strokeWidth={m.name ? 2 : 1} />
            <text y="3" textAnchor="middle" fontSize="8" fontWeight="800" fill={s.t}>{s.label}</text>
            {m.name && <text y={CELL / 2 + 6} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fbbf24">★</text>}
          </g>
        );
      })}

      {/* note / objective markers */}
      {q.markers.map((mk, i) => (
        <g key={`k${i}`} transform={`translate(${mk.at.x * CELL + CELL / 2},${mk.at.y * CELL + 6})`}>
          <rect x={-9} y={-6} width="18" height="12" rx="2" fill="#fefce8" stroke="#a16207" strokeWidth="1" />
          <text y="3" textAnchor="middle" fontSize="8" fontWeight="800" fill="#92400e">{mk.label}</text>
        </g>
      ))}
    </svg>
  );
}

export default function QuestGallery() {
  const [idx, setIdx] = useState(0);
  const q = QUEST_MAPS[idx];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-amber-200">HeroQuest — Quest Map Gallery</h2>
        <p className="text-sm text-stone-400">
          All 14 quests on the shared 26×19 board (true book proportions). A first-pass
          reconstruction — flip through and compare to your physical Quest Book.
        </p>
      </div>

      {/* quest selector */}
      <div className="flex flex-wrap gap-1.5">
        {QUEST_MAPS.map((m, i) => (
          <button key={m.id} onClick={() => setIdx(i)}
            className={`px-2.5 py-1 rounded text-xs font-semibold border transition ${
              i === idx ? 'bg-amber-500 text-stone-900 border-amber-400'
                        : 'bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700'}`}>
            {m.n}. {m.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        {/* board */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-amber-100">Quest {q.n}: {q.name}</h3>
            <span className="text-xs text-stone-500">{q.page}</span>
          </div>
          <Board q={q} />
          {/* legend */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-400">
            <span><span className="inline-block w-3 h-3 align-middle bg-[#e7e2d6] border border-stone-500" /> room</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#cfc9ba] border border-stone-500" /> corridor</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#292524] border border-stone-500" /> solid rock</span>
            <span><span className="inline-block w-3 h-3 align-middle bg-[#1e3a5f] border border-stone-500" /> stairway</span>
            <span>★ = named / boss</span>
            <span>letters = note anchors</span>
          </div>
        </div>

        {/* details */}
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
          <div className="text-xs text-stone-500">
            {q.monsters.length} monsters · {q.furniture.length} furniture · {q.traps.length} traps
          </div>
        </div>
      </div>
    </div>
  );
}
