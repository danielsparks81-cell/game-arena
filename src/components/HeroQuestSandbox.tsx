'use client';

// HeroQuest map editor. Paint the dungeon on a grid — rock, double-wide halls,
// rooms, doors, secret doors, the entry staircase — then drop furniture, monsters
// (incl. named bosses/NPCs), traps and treasure, and copy out ready-to-paste
// quest data for src/lib/games/heroquest/content.ts.
//
// Glyphs (also the export format):
//   #  rock — full-board area NOT used by this quest (the board never shrinks;
//             players just never explore here). The default fill.
//   W  wall — a solid barrier WITHIN the dungeon (block off a hallway).
//   .  hall   S  stairs (one space)   +  door   *  secret door
//   a..p  room floor — each connected same-letter block becomes a distinct room
//         (so a colour can be reused for several rooms; export flood-fills them)
// Furniture / monsters / traps / starts are overlays placed by cell.
//
// State auto-saves to localStorage; nothing touches the server.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { TEMPLATE_BOARD } from '@/lib/games/heroquest/quests/templateBoard';
import { buildQuest1Grid, QUEST1_MONSTERS, QUEST1_FURNITURE, QUEST1_STAIRS, QUEST1_DOORS } from '@/lib/games/heroquest/quests/quest1';
import { FloorCell, StairsTile, FurnitureToken } from './heroquest/Art';
import { ROOM_FLOORS, CORRIDOR_FLOOR, assignRoomFloors, type RoomFloor } from './heroquest/floors';

type Glyph = string; // '#', '.', 'S', '+', '*'(secret door), or a room letter 'a'..'p'
type Pt = { x: number; y: number };
type FurnKind =
  | 'chest' | 'table' | 'cupboard' | 'rack' | 'weapon_rack' | 'bookshelf'
  | 'throne' | 'tomb' | 'altar' | 'bench' | 'fireplace'
  | 'sorcerer_table' | 'alchemist_bench';
type MonKind =
  | 'goblin' | 'orc' | 'abomination' | 'skeleton' | 'zombie' | 'mummy'
  | 'dread_warrior' | 'gargoyle' | 'dread_sorcerer';
type TrapKind = 'pit' | 'spear' | 'falling_block';
// (x,y) is the top-left of the footprint; rot=1 swaps width/height.
type Furn = { kind: FurnKind; x: number; y: number; gold?: number; rot?: number };
type Mon = { kind: MonKind; x: number; y: number; named?: boolean; name?: string };
type Trap = { kind: TrapKind; x: number; y: number };
// A door lives ON a wall edge (never a square): the TOP edge of (x,y) when v=false,
// or the LEFT edge of (x,y) when v=true. secret = hidden door.
type Door = { x: number; y: number; v: boolean; secret?: boolean };

type Tool =
  | { t: 'rock' } | { t: 'wall' } | { t: 'hall' } | { t: 'stairs' } | { t: 'door' } | { t: 'secret' } | { t: 'erase' }
  | { t: 'room'; letter: string }
  | { t: 'furniture'; kind: FurnKind }
  | { t: 'monster'; kind: MonKind; named: boolean }
  | { t: 'trap'; kind: TrapKind };

// Footprint (in squares) + whether the piece blocks line of sight.
const FURN_SIZE: Record<FurnKind, { w: number; h: number; los: boolean }> = {
  table:           { w: 2, h: 3, los: false },
  chest:           { w: 1, h: 1, los: false },
  bookshelf:       { w: 1, h: 3, los: true },
  sorcerer_table:  { w: 2, h: 3, los: false },
  alchemist_bench: { w: 2, h: 3, los: false },
  throne:          { w: 1, h: 1, los: false },
  fireplace:       { w: 1, h: 3, los: true },
  cupboard:        { w: 1, h: 3, los: true },
  tomb:            { w: 2, h: 3, los: false },
  rack:            { w: 2, h: 3, los: false },
  weapon_rack:     { w: 1, h: 3, los: true },
  altar:           { w: 1, h: 1, los: false },
  bench:           { w: 1, h: 1, los: false },
};
/** Footprint of a placed piece, accounting for rotation. */
function footprint(kind: FurnKind, rot = 0) {
  const s = FURN_SIZE[kind];
  return rot ? { w: s.h, h: s.w, los: s.los } : { w: s.w, h: s.h, los: s.los };
}

const ROOM_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'];
const FURN_KINDS: FurnKind[] = ['table', 'chest', 'bookshelf', 'sorcerer_table', 'alchemist_bench', 'throne', 'fireplace', 'cupboard', 'tomb', 'rack', 'weapon_rack', 'altar', 'bench'];
const MON_KINDS: MonKind[] = ['goblin', 'orc', 'abomination', 'skeleton', 'zombie', 'mummy', 'dread_warrior', 'gargoyle', 'dread_sorcerer'];
const TRAP_KINDS: TrapKind[] = ['pit', 'spear', 'falling_block'];

const ROOM_TINT: Record<string, string> = {
  a: '#7dd3fc', b: '#86efac', c: '#fca5a5', d: '#fcd34d',
  e: '#c4b5fd', f: '#fdba74', g: '#67e8f9', h: '#f9a8d4',
  i: '#a5b4fc', j: '#5eead4', k: '#fda4af', l: '#bef264',
  m: '#d8b4fe', n: '#fde047', o: '#94d2bd', p: '#f0abfc',
};
const FURN_ICON: Record<FurnKind, string> = {
  chest: '🧰', table: '🪵', cupboard: '🗄️', rack: '⚔️', weapon_rack: '🗡️', bookshelf: '📚',
  throne: '🪑', tomb: '⚰️', altar: '🔯', bench: '🛋️', fireplace: '🔥',
  sorcerer_table: '🔮', alchemist_bench: '⚗️',
};
// Map the editor's furniture kinds onto the game's FurnitureToken art kinds (the
// token kit doesn't have weapon_rack / sorcerer_table / alchemist_bench, so they
// borrow the closest piece).
type TokenFurnKind = 'chest' | 'table' | 'cupboard' | 'rack' | 'bookshelf' | 'throne' | 'tomb' | 'altar' | 'bench' | 'fireplace';
const FURN_TOKEN_KIND: Record<FurnKind, TokenFurnKind> = {
  chest: 'chest', table: 'table', cupboard: 'cupboard', rack: 'rack', weapon_rack: 'rack',
  bookshelf: 'bookshelf', throne: 'throne', tomb: 'tomb', altar: 'altar', bench: 'bench',
  fireplace: 'fireplace', sorcerer_table: 'table', alchemist_bench: 'bench',
};
const MON_ICON: Record<MonKind, string> = {
  goblin: '👺', orc: '👹', abomination: '🦎', skeleton: '💀', zombie: '🧟',
  mummy: '🧻', dread_warrior: '🛡️', gargoyle: '😈', dread_sorcerer: '🧙',
};
// Monster tokens: a coloured circle + the kind's first letter.
//   green  = goblinoids (goblin, orc, abomination)
//   yellow = undead     (skeleton, zombie, mummy)
//   grey   = dread/stone (dread warrior, sorcerer, gargoyle)
const MON_DOT: Record<MonKind, { bg: string; fg: string; letter: string }> = {
  goblin:         { bg: '#22c55e', fg: '#052e16', letter: 'G' },
  orc:            { bg: '#22c55e', fg: '#052e16', letter: 'O' },
  abomination:    { bg: '#22c55e', fg: '#052e16', letter: 'A' },
  skeleton:       { bg: '#eab308', fg: '#422006', letter: 'S' },
  zombie:         { bg: '#eab308', fg: '#422006', letter: 'Z' },
  mummy:          { bg: '#eab308', fg: '#422006', letter: 'M' },
  dread_warrior:  { bg: '#9ca3af', fg: '#111827', letter: 'D' },
  dread_sorcerer: { bg: '#9ca3af', fg: '#111827', letter: 'S' },
  gargoyle:       { bg: '#9ca3af', fg: '#111827', letter: 'G' },
};
const TRAP_ICON: Record<TrapKind, string> = { pit: '⬛', spear: '🔻', falling_block: '🧱' };

const CELL = 40;
const LS_KEY = 'hq-sandbox-v1';
// The board is LOCKED at this size — it never changes, and the editor offers no
// resize. (Quests vary by what's painted on it, never by its dimensions.)
const BOARD_W = 30;
const BOARD_H = 23;

function makeGrid(w: number, h: number, fill: Glyph = '#'): Glyph[][] {
  return Array.from({ length: h }, () => new Array<Glyph>(w).fill(fill));
}

/** The locked default board — the editor opens on this and Reset returns to it. */
function makeTemplateGrid(): Glyph[][] {
  return TEMPLATE_BOARD.map(row => row.split(''));
}

/** Flood-fill connected blocks of the SAME room letter into distinct regions
 *  (room_1, room_2, …) in scan order — mirrors the engine's board parser and the
 *  export. Returns the per-cell region id grid plus the ordered region ids (used
 *  to give every room its own floor look). */
function floodRegions(grid: Glyph[][], w: number, h: number): { region: string[][]; order: string[] } {
  const region: string[][] = grid.map(row => row.map(() => ''));
  const order: string[] = [];
  let rn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const letter = grid[y]?.[x];
      if (!letter || !ROOM_LETTERS.includes(letter) || region[y][x]) continue;
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
  return { region, order };
}

type SaveState = {
  w: number; h: number; grid: Glyph[][];
  furniture: Furn[]; monsters: Mon[]; starts: Pt[]; traps?: Trap[]; doors?: Door[];
};

/** Force any saved state to the locked 30×23 — crop extra columns from the LEFT
 *  (where stray rock columns live) and extra rows from the bottom, padding with
 *  rock if short, and shift the overlays to match. */
function normalizeToBoard(s: SaveState): SaveState {
  let grid = (s.grid ?? []).map(r => r.slice());
  const w0 = grid[0]?.length ?? BOARD_W;
  let dx = 0;
  if (w0 > BOARD_W) { dx = -(w0 - BOARD_W); grid = grid.map(r => r.slice(w0 - BOARD_W)); }
  else if (w0 < BOARD_W) grid = grid.map(r => [...r, ...new Array<Glyph>(BOARD_W - w0).fill('#')]);
  if (grid.length > BOARD_H) grid = grid.slice(0, BOARD_H);
  else while (grid.length < BOARD_H) grid.push(new Array<Glyph>(BOARD_W).fill('#'));
  const fix = <T extends Pt>(list: T[] = []): T[] =>
    list.map(p => ({ ...p, x: p.x + dx })).filter(p => p.x >= 0 && p.x < BOARD_W && p.y >= 0 && p.y < BOARD_H);
  const doors = (s.doors ?? []).map(d => ({ ...d, x: d.x + dx })).filter(d => d.x >= 0 && d.x <= BOARD_W && d.y >= 0 && d.y <= BOARD_H);
  return { w: BOARD_W, h: BOARD_H, grid, furniture: fix(s.furniture), monsters: fix(s.monsters), starts: fix(s.starts), traps: fix(s.traps), doors };
}

/** Quest 1 "The Trial" laid out on the locked template board (rooms per the
 *  user's Quest Book read; exact cells are a first pass to nudge). */
function quest1State(): SaveState {
  const grid = buildQuest1Grid();
  const furniture: Furn[] = QUEST1_FURNITURE.map(f => ({ kind: f.kind as FurnKind, x: f.x, y: f.y, gold: f.gold }));
  const monsters: Mon[] = QUEST1_MONSTERS.map(m => ({ kind: m.kind as MonKind, x: m.x, y: m.y, named: !!m.name, name: m.name }));
  const starts: Pt[] = QUEST1_STAIRS.map(s => ({ x: s.x, y: s.y }));
  const doors: Door[] = QUEST1_DOORS.map(d => ({ x: d.x, y: d.y, v: d.v, secret: d.secret }));
  return { w: BOARD_W, h: BOARD_H, grid, furniture, monsters, starts, traps: [], doors };
}

export default function HeroQuestSandbox() {
  const [w, setW] = useState(BOARD_W);
  const [h, setH] = useState(BOARD_H);
  const [grid, setGrid] = useState<Glyph[][]>(() => makeTemplateGrid());
  const [furniture, setFurniture] = useState<Furn[]>([]);
  const [monsters, setMonsters] = useState<Mon[]>([]);
  const [starts, setStarts] = useState<Pt[]>([]);
  const [traps, setTraps] = useState<Trap[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [tool, setTool] = useState<Tool>({ t: 'hall' });
  const [painting, setPainting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [monName, setMonName] = useState('');     // name for the next "named" monster
  const [chestGold, setChestGold] = useState(0);  // gold stocked into the next chest (0 = none)

  const [furnRot, setFurnRot] = useState(0);          // 0 / 1 — rotate footprint tiles
  const gridRef = useRef<HTMLDivElement>(null);       // for drag-drop cell math
  const [dragKind, setDragKind] = useState<FurnKind | null>(null);

  // Cell size is computed to make the whole board fit its container (no scroll).
  const boardRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(CELL);
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const c = Math.floor(Math.min((r.width - 6) / BOARD_W, (r.height - 6) / BOARD_H));
      setCell(Math.max(14, Math.min(72, c)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load saved state once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SaveState;
        if (parsed.grid?.length) {
          const s = normalizeToBoard(parsed); // force to the locked 30×23
          setW(s.w); setH(s.h); setGrid(s.grid);
          setFurniture(s.furniture); setMonsters(s.monsters); setStarts(s.starts);
          setTraps(s.traps ?? []); setDoors(s.doors ?? []);
        }
      }
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  // Auto-save.
  useEffect(() => {
    if (!loaded) return;
    const s: SaveState = { w, h, grid, furniture, monsters, starts, traps, doors };
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, [loaded, w, h, grid, furniture, monsters, starts, traps, doors]);

  const setCellGlyph = useCallback((x: number, y: number, g: Glyph) => {
    setGrid(prev => {
      if (prev[y][x] === g) return prev;
      const next = prev.map(row => row.slice());
      next[y][x] = g;
      return next;
    });
  }, []);

  // Cells already covered by a placed item (furniture footprint, monster, or
  // trap). Items must never overlap — stacking corrupts the exported quest — so
  // every placement checks here first.
  const occupied = useMemo(() => {
    const s = new Set<string>();
    for (const f of furniture) {
      const fp = footprint(f.kind, f.rot);
      for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) s.add(`${f.x + dx},${f.y + dy}`);
    }
    for (const m of monsters) s.add(`${m.x},${m.y}`);
    for (const t of traps) s.add(`${t.x},${t.y}`);
    return s;
  }, [furniture, monsters, traps]);

  // Brief on-screen note when a placement is refused (auto-clears after ~2s).
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2000);
  }, []);

  // Place a furniture footprint anchored at (x,y) (drag-drop or click). Refuses if
  // the footprint would run off the board or cover an existing item / the
  // staircase — overlapping pieces break the map. Remove with right-click.
  const placeFurniture = useCallback((kind: FurnKind, x: number, y: number, rot: number) => {
    const fp = footprint(kind, rot);
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        const cx = x + dx, cy = y + dy;
        if (cx >= BOARD_W || cy >= BOARD_H) { flash('Doesn’t fit — runs off the board.'); return; }
        if (occupied.has(`${cx},${cy}`) || grid[cy]?.[cx] === 'S') { flash('Space is taken — items can’t overlap.'); return; }
      }
    }
    setFurniture(prev => [...prev, { kind, x, y, rot, gold: kind === 'chest' && chestGold > 0 ? chestGold : undefined }]);
  }, [occupied, grid, chestGold, flash]);

  /** Right-click delete: removes the top thing at (x,y) — furniture (whole
   *  footprint), then monster, then trap. (Doors are removed by re-clicking the
   *  same edge with the Door tool.) */
  const removeAt = useCallback((x: number, y: number) => {
    const fi = furniture.findIndex(f => { const fp = footprint(f.kind, f.rot); return x >= f.x && x < f.x + fp.w && y >= f.y && y < f.y + fp.h; });
    if (fi >= 0) { setFurniture(furniture.filter((_, i) => i !== fi)); return; }
    if (monsters.some(m => m.x === x && m.y === y)) { setMonsters(monsters.filter(m => !(m.x === x && m.y === y))); return; }
    if (traps.some(t => t.x === x && t.y === y)) { setTraps(traps.filter(t => !(t.x === x && t.y === y))); return; }
  }, [furniture, monsters, traps]);

  // Fast lookup of which edges have a door (used to leave wall edges open).
  const doorSet = useMemo(() => new Set(doors.map(d => `${d.x},${d.y},${d.v ? 'v' : 'h'}`)), [doors]);

  /** Toggle a door on the wall edge of cell (x,y) nearest the click point. */
  const placeDoor = useCallback((e: React.MouseEvent, x: number, y: number, secret: boolean) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ox = (e.clientX - r.left) / r.width, oy = (e.clientY - r.top) / r.height;
    const m = Math.min(oy, 1 - oy, ox, 1 - ox);
    let dx = x, dy = y, v = false;
    if (m === oy) { v = false; }                       // top edge of (x,y)
    else if (m === 1 - oy) { dy = y + 1; v = false; }  // bottom = top of (x,y+1)
    else if (m === ox) { v = true; }                   // left edge of (x,y)
    else { dx = x + 1; v = true; }                     // right = left of (x+1,y)
    setDoors(prev => {
      const i = prev.findIndex(d => d.x === dx && d.y === dy && d.v === v);
      if (i >= 0) { const c = prev.slice(); c.splice(i, 1); return c; }
      return [...prev, { x: dx, y: dy, v, secret: secret || undefined }];
    });
  }, []);

  const applyTool = useCallback((x: number, y: number) => {
    switch (tool.t) {
      case 'rock':   setCellGlyph(x, y, '#'); break;
      case 'wall':   setCellGlyph(x, y, 'W'); break;
      case 'hall':   setCellGlyph(x, y, '.'); break;
      case 'room':   setCellGlyph(x, y, tool.letter); break;
      case 'erase':  setCellGlyph(x, y, '#'); break;
      case 'stairs': {
        // The staircase is one 2×2 space; stamp 'S' on it and make those the starts.
        const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].filter(([cx, cy]) => cx < w && cy < h);
        if (cells.some(([cx, cy]) => occupied.has(`${cx},${cy}`))) { flash('Clear the 2×2 first — something is in the way.'); break; }
        setGrid(prev => { const n = prev.map(r => r.slice()); for (const [cx, cy] of cells) n[cy][cx] = 'S'; return n; });
        setStarts(cells.map(([cx, cy]) => ({ x: cx, y: cy })));
        break;
      }
      case 'furniture': placeFurniture(tool.kind, x, y, furnRot); break;
      case 'monster': {
        // Click a monster to remove it; otherwise place, but never onto another item.
        if (monsters.some(m => m.x === x && m.y === y)) { setMonsters(monsters.filter(m => !(m.x === x && m.y === y))); break; }
        if (occupied.has(`${x},${y}`) || grid[y]?.[x] === 'S') { flash('Space is taken — items can’t overlap.'); break; }
        setMonsters([...monsters, { kind: tool.kind, x, y, named: tool.named, name: tool.named ? (monName.trim() || 'Boss') : undefined }]);
        break;
      }
      case 'trap': {
        if (traps.some(t => t.x === x && t.y === y)) { setTraps(traps.filter(t => !(t.x === x && t.y === y))); break; }
        if (occupied.has(`${x},${y}`) || grid[y]?.[x] === 'S') { flash('Space is taken — items can’t overlap.'); break; }
        setTraps([...traps, { kind: tool.kind, x, y }]);
        break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, monsters, traps, monName, chestGold, furnRot, setCellGlyph, placeFurniture, occupied, grid, flash, w, h]);

  // Per-cell room regions (room_1…) + a unique floor look for each, so the
  // authoring board renders with the SAME tiles as the in-game board.
  const { region: regionGrid, order: regionOrder } = useMemo(() => floodRegions(grid, w, h), [grid, w, h]);
  const roomFloor = useMemo(() => assignRoomFloors(regionOrder), [regionOrder]);

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
      if (g === '#' || g === 'W') out.push(`Furniture (${f.kind}) at ${f.x},${f.y} is on ${g === 'W' ? 'a wall' : 'rock'}.`);
    }
    for (const s of starts) {
      if (grid[s.y]?.[s.x] !== 'S') out.push(`Start cell ${s.x},${s.y} is not on a staircase tile.`);
    }
    for (const t of traps) {
      const g = grid[t.y]?.[t.x];
      if (g === '#' || g === 'W') out.push(`Trap (${t.kind}) at ${t.x},${t.y} is on ${g === 'W' ? 'a wall' : 'rock'}.`);
    }
    if (!monsters.some(m => m.named)) out.push('No named boss/NPC marked (tick "named" and give it a name).');
    if (starts.length === 0) out.push('No start cells marked (place up to 4 on staircase tiles).');
    return out;
  }, [grid, monsters, furniture, traps, starts]);

  // ---- Export ----
  const buildExport = useCallback(() => {
    const rows = grid.map(r => `  '${r.join('')}',`).join('\n');
    // Flood-fill connected blocks of the SAME room letter into distinct regions
    // (room_1, room_2, …), so reusing a colour for several rooms still exports as
    // separate rooms. Mirrors the engine's board parser.
    const region: string[][] = grid.map(row => row.map(() => ''));
    let rn = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const letter = grid[y]?.[x];
        if (!ROOM_LETTERS.includes(letter) || region[y][x]) continue;
        const id = `room_${++rn}`;
        const stack = [[x, y]]; region[y][x] = id;
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
    const regionOf = (x: number, y: number) => region[y]?.[x] || 'corridor';
    const furnLines = furniture.map(f => {
      const fp = footprint(f.kind, f.rot);
      const fc = f.gold != null ? `, { kind: 'gold', amount: ${f.gold} }` : '';
      // furn(kind, x, y, w, h, blocksLos, content?) — (x,y) = top-left of the footprint
      return `  furn('${f.kind}', ${f.x}, ${f.y}, ${fp.w}, ${fp.h}, ${fp.los}${fc});`;
    }).join('\n');
    const monLines = monsters.map(m => {
      const opts = m.named ? `, { displayName: ${JSON.stringify(m.name || 'Boss')} }` : '';
      return `  mob('${m.kind}', ${m.x}, ${m.y}, '${regionOf(m.x, m.y)}'${opts});`;
    }).join('\n');
    const trapLines = traps.map(t => `  trap('${t.kind}', ${t.x}, ${t.y});`).join('\n');
    // Doors sit on a wall EDGE: top edge of (x,y), or left edge of (x,y).
    const doorLines = doors.map(d => `  door(${d.x}, ${d.y}, '${d.v ? 'left' : 'top'}'${d.secret ? ', { secret: true }' : ''});`).join('\n');
    const startLine = `const startCells = [${starts.map(s => `{ x: ${s.x}, y: ${s.y} }`).join(', ')}];`;
    const text =
`const QUEST_W = ${w};
const QUEST_H = ${h};

// ${rn} rooms (flood-filled). Glyphs: # rock · . hall · S stairs(1 space) · W wall · a–p room
const QUEST_MAP: string[] = [
${rows}
];

// --- furniture: furn(kind, x, y, w, h, blocksLos, content?) ---
${furnLines || '  // (none)'}

// --- doors (on wall edges): door(x, y, 'top'|'left', { secret? }) ---
${doorLines || '  // (none)'}

// --- monsters ---
${monLines || '  // (none)'}

// --- traps ---
${trapLines || '  // (none)'}

// --- start cells (heroes begin on the staircase) ---
${startLine}`;
    setExportText(text);
  }, [grid, furniture, monsters, traps, doors, starts, w, h]);

  return (
    <div
      className="h-full flex flex-col bg-neutral-950 text-neutral-200 overflow-hidden"
      onMouseUp={() => setPainting(false)}
      onMouseLeave={() => setPainting(false)}
    >
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <h1 className="text-base font-semibold">HeroQuest — Map Sandbox</h1>
        <Link href="/lobby" className="text-sm text-emerald-400 hover:underline">← Back to lobby</Link>
      </div>

      <div className="flex gap-3 flex-1 min-h-0 px-3 pb-2">
        {/* Toolbar — two columns so it fits without scrolling */}
        <div className="w-[500px] shrink-0 overflow-y-auto pr-1 columns-2 gap-2 [column-fill:balance]">
            <Section title="Brush">
              <div className="grid grid-cols-2 gap-1">
                <ToolBtn active={tool.t === 'hall'} onClick={() => setTool({ t: 'hall' })}>Hall</ToolBtn>
                <ToolBtn active={tool.t === 'wall'} onClick={() => setTool({ t: 'wall' })}>Wall</ToolBtn>
                <ToolBtn active={tool.t === 'rock'} onClick={() => setTool({ t: 'rock' })}>Rock (unused)</ToolBtn>
                <ToolBtn active={tool.t === 'door'} onClick={() => setTool({ t: 'door' })}>Door</ToolBtn>
                <ToolBtn active={tool.t === 'secret'} onClick={() => setTool({ t: 'secret' })}>Secret door</ToolBtn>
                <ToolBtn active={tool.t === 'stairs'} onClick={() => setTool({ t: 'stairs' })}>Stairs 2×2</ToolBtn>
                <ToolBtn active={tool.t === 'erase'} onClick={() => setTool({ t: 'erase' })}>Erase → rock</ToolBtn>
              </div>
            </Section>

            <Section title="Room floor">
              <div className="grid grid-cols-4 gap-1">
                {ROOM_LETTERS.map(l => (
                  <button
                    key={l}
                    onClick={() => setTool({ t: 'room', letter: l })}
                    className={`rounded px-2 py-2 text-sm font-bold uppercase ${tool.t === 'room' && tool.letter === l ? 'ring-2 ring-white' : ''}`}
                    style={{ background: ROOM_TINT[l], color: '#1a1410' }}
                  >{l}</button>
                ))}
              </div>
            </Section>

            <Section title="Objects — drag onto the map (or click then click a square)">
              <div className="mb-1.5 flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1">Chest gold:
                  <input type="number" min={0} value={chestGold} onChange={e => setChestGold(Math.max(0, +e.target.value || 0))} className="w-14 rounded bg-neutral-800 px-1 py-0.5" /></label>
                <button onClick={() => setFurnRot(r => (r ? 0 : 1))} className="rounded bg-neutral-700 px-2 py-1 font-medium hover:bg-neutral-600">⟳ Rotate{furnRot ? ' 90°' : ''}</button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {FURN_KINDS.map(k => {
                  const s = FURN_SIZE[k];
                  const active = tool.t === 'furniture' && tool.kind === k;
                  return (
                    <button key={k} draggable
                      onDragStart={() => setDragKind(k)}
                      onClick={() => setTool({ t: 'furniture', kind: k })}
                      className={`flex items-center gap-1 rounded px-2 py-1.5 text-left text-xs transition cursor-grab active:cursor-grabbing ${active ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}>
                      <span>{FURN_ICON[k]}</span>
                      <span className="flex-1 truncate">{k.replace('_', ' ')}</span>
                      <span className={active ? 'text-neutral-800' : 'text-neutral-400'}>{s.w}×{s.h}{s.los ? '◾' : ''}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 text-[10px] text-neutral-500">◾ = blocks line of sight · drag-rotate with ⟳</div>
            </Section>

            <Section title="Monsters">
              <label className="mb-1 flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={tool.t === 'monster' ? tool.named : false}
                  onChange={e => setTool(t => t.t === 'monster' ? { ...t, named: e.target.checked } : t)}
                /> named (boss / NPC)
              </label>
              <input
                type="text" placeholder="name (e.g. Verag, Ulag, Sir Ragnar)"
                value={monName} onChange={e => setMonName(e.target.value)}
                className="mb-1.5 w-full rounded bg-neutral-800 px-1.5 py-0.5 text-xs"
              />
              <div className="grid grid-cols-2 gap-1">
                {MON_KINDS.map(k => (
                  <ToolBtn key={k} active={tool.t === 'monster' && tool.kind === k} onClick={() => setTool(t => ({ t: 'monster', kind: k, named: t.t === 'monster' ? t.named : false }))}>
                    {MON_ICON[k]} {k.replace('_', ' ')}
                  </ToolBtn>
                ))}
              </div>
            </Section>

            <Section title="Traps">
              <div className="grid grid-cols-2 gap-1">
                {TRAP_KINDS.map(k => (
                  <ToolBtn key={k} active={tool.t === 'trap' && tool.kind === k} onClick={() => setTool({ t: 'trap', kind: k })}>
                    {TRAP_ICON[k]} {k.replace('_', ' ')}
                  </ToolBtn>
                ))}
              </div>
            </Section>

            <Section title="Board">
              <div className="text-xs text-neutral-400">Size: <span className="font-semibold text-neutral-200">{w}×{h}</span> — locked</div>
              <div className="mt-2 flex flex-wrap gap-1">
                <SmallBtn onClick={() => { const s = quest1State(); setW(s.w); setH(s.h); setGrid(s.grid); setFurniture(s.furniture); setMonsters(s.monsters); setStarts(s.starts); setTraps(s.traps ?? []); setDoors(s.doors ?? []); }}>★ Load Quest 1</SmallBtn>
                <SmallBtn onClick={() => { if (confirm('Reset to the locked 30×23 board template? This clears everything you have placed and restores the default board.')) { setW(BOARD_W); setH(BOARD_H); setGrid(makeTemplateGrid()); setFurniture([]); setMonsters([]); setStarts([]); setTraps([]); setDoors([]); } }}>↺ Reset to template</SmallBtn>
                <SmallBtn onClick={() => { if (confirm('Clear the whole map at the current size?')) { setGrid(makeGrid(w, h)); setFurniture([]); setMonsters([]); setStarts([]); setTraps([]); setDoors([]); } }}>Clear</SmallBtn>
              </div>
            </Section>

            <Section title="Export">
              <SmallBtn onClick={buildExport}>Generate quest data →</SmallBtn>
            </Section>

            {warnings.length > 0 && (
              <Section title="Checks">
                <ul className="list-disc pl-4 text-[11px] leading-snug text-amber-300/90 space-y-0.5">
                  {warnings.slice(0, 8).map((wn, i) => <li key={i}>{wn}</li>)}
                </ul>
              </Section>
            )}
          </div>

          {/* Grid — fills the remaining space, sized to fit (no scroll) */}
          <div ref={boardRef} className="flex-1 min-w-0 flex items-center justify-center overflow-hidden">
            <div
              ref={gridRef}
              className="relative select-none rounded border border-neutral-700"
              style={{ display: 'grid', gridTemplateColumns: `repeat(${w}, ${cell}px)`, background: '#0a0805' }}
              onMouseDown={e => { if (e.button === 0) setPainting(true); }}
              onContextMenu={e => e.preventDefault()}
              onDragOver={e => { if (dragKind) e.preventDefault(); }}
              onDrop={e => {
                e.preventDefault();
                const r = gridRef.current?.getBoundingClientRect();
                if (!dragKind || !r) return;
                const cx = Math.floor((e.clientX - r.left) / cell), cy = Math.floor((e.clientY - r.top) / cell);
                if (cx >= 0 && cy >= 0 && cx < w && cy < h) placeFurniture(dragKind, cx, cy, furnRot);
                setDragKind(null);
              }}
            >
              {/* Floor tiles — the SAME art kit the players see in-game. */}
              {grid.map((row, y) => row.map((g, x) => {
                const rid = regionGrid[y]?.[x];
                const fl = rid ? roomFloor.get(rid) ?? null : null;
                return (
                  <div
                    key={`${x},${y}`}
                    title={`${x},${y}`}
                    style={{ width: cell, height: cell, position: 'relative', overflow: 'hidden', cursor: 'pointer', userSelect: 'none' }}
                    onMouseDown={e => {
                      if (e.button === 2) { removeAt(x, y); return; }
                      if (tool.t === 'door' || tool.t === 'secret') { placeDoor(e, x, y, tool.t === 'secret'); return; }
                      applyTool(x, y);
                    }}
                    onMouseEnter={() => { if (painting && (tool.t === 'rock' || tool.t === 'wall' || tool.t === 'hall' || tool.t === 'room' || tool.t === 'erase')) applyTool(x, y); }}
                  >
                    <FloorArt g={g} x={x} y={y} cell={cell} floor={fl} />
                  </div>
                );
              }))}

              {/* Room / rock walls — bold dark edges (a door leaves its edge open). */}
              <WallLayer grid={grid} region={regionGrid} doorSet={doorSet} cell={cell} w={w} h={h} />

              {/* Furniture — game art sized to the footprint. Solid border = blocks
                  line of sight, dashed = doesn't. */}
              {furniture.map((fu, i) => {
                const fp = footprint(fu.kind, fu.rot);
                const ts = Math.min(fp.w, fp.h) * cell;
                return (
                  <div key={`fur${i}`} title={`${fu.kind} ${fp.w}×${fp.h}${fp.los ? ' (blocks LOS)' : ''}`} style={{
                    position: 'absolute', left: fu.x * cell, top: fu.y * cell, width: fp.w * cell, height: fp.h * cell,
                    border: fp.los ? '2px solid #120c06' : '2px dashed #c79a63', borderRadius: 3,
                    background: 'rgba(28,18,10,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none', boxShadow: '0 2px 5px rgba(0,0,0,0.6)', overflow: 'hidden', zIndex: 3,
                  }}>
                    <FurnitureToken kind={FURN_TOKEN_KIND[fu.kind]} size={ts} />
                    {fu.gold ? <span style={{ position: 'absolute', right: 3, bottom: 1, fontSize: Math.round(cell * 0.28), color: '#fde68a', fontWeight: 800, textShadow: '0 1px 2px #000' }}>{fu.gold}</span> : null}
                  </div>
                );
              })}

              {/* Doors — on the wall edge (never a square). Purple = secret. */}
              {doors.map((d, i) => {
                const dt = Math.max(4, Math.round(cell * 0.2));
                return (
                  <div key={`door${i}`} style={{
                    position: 'absolute', borderRadius: 2, pointerEvents: 'none', zIndex: 4,
                    background: d.secret ? '#7c3aed' : '#d97706', boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
                    ...(d.v
                      ? { left: d.x * cell - dt / 2, top: d.y * cell + cell * 0.16, width: dt, height: cell * 0.68 }
                      : { left: d.x * cell + cell * 0.16, top: d.y * cell - dt / 2, width: cell * 0.68, height: dt }),
                  }} />
                );
              })}

              {/* Traps */}
              {traps.map((t, i) => (
                <div key={`trap${i}`} style={{
                  position: 'absolute', left: t.x * cell, top: t.y * cell, width: cell, height: cell,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none', zIndex: 3, fontSize: Math.round(cell * 0.5),
                }}>{TRAP_ICON[t.kind]}</div>
              ))}

              {/* Monsters — coloured circle + first letter (gold ring = named). */}
              {monsters.map((mo, i) => (
                <div key={`mon${i}`} title={mo.name ? `${mo.name} (${mo.x},${mo.y})` : `${mo.kind} (${mo.x},${mo.y})`} style={{
                  position: 'absolute', left: mo.x * cell, top: mo.y * cell, width: cell, height: cell,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5,
                }}>
                  <span style={{
                    width: cell - 8, height: cell - 8, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: MON_DOT[mo.kind].bg, color: MON_DOT[mo.kind].fg,
                    fontWeight: 800, fontSize: Math.round(cell * 0.42),
                    boxShadow: mo.named ? '0 0 0 3px #f59e0b, 0 1px 3px rgba(0,0,0,0.6)' : 'inset 0 0 0 1px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.6)',
                  }}>{MON_DOT[mo.kind].letter}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Placement-refused toast (overlapping items would break the map) */}
        {notice && (
          <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md bg-rose-600/95 px-3 py-1.5 text-sm font-medium text-white shadow-lg">
            {notice}
          </div>
        )}

        {/* Export output — overlay so it doesn't disturb the fitted layout */}
        {exportText && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setExportText(null)}>
            <div className="w-full max-w-3xl rounded-lg border border-neutral-700 bg-neutral-900 p-3" onClick={e => e.stopPropagation()}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold">Quest data</span>
                <SmallBtn onClick={() => navigator.clipboard?.writeText(exportText)}>Copy</SmallBtn>
                <SmallBtn onClick={() => setExportText(null)}>Close</SmallBtn>
              </div>
              <textarea readOnly value={exportText} className="h-[60vh] w-full rounded border border-neutral-700 bg-neutral-950 p-2 font-mono text-[11px] leading-snug" />
            </div>
          </div>
        )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-2 break-inside-avoid rounded-lg border border-neutral-800 bg-neutral-900 p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{title}</div>
      {children}
    </div>
  );
}

function ToolBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-2 text-left text-sm font-medium transition ${active ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}
    >{children}</button>
  );
}

function SmallBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 transition hover:bg-neutral-700">{children}</button>
  );
}

/** The art for a single board cell — the SAME tiles the in-game board uses for
 *  rooms, corridors and stairs, plus authoring-only fills for rock (near-black,
 *  unused this quest) and a painted wall tile (hatched stone barrier). */
function FloorArt({ g, x, y, cell, floor }: { g: string; x: number; y: number; cell: number; floor: RoomFloor | null }) {
  if (g === 'S') return <StairsTile size={cell} />;
  if (g === '.') return <FloorCell size={cell} gx={x} gy={y} style={CORRIDOR_FLOOR.style} tl={CORRIDOR_FLOOR.tl} br={CORRIDOR_FLOOR.br} />;
  if (ROOM_LETTERS.includes(g)) {
    const fl = floor ?? ROOM_FLOORS[0];
    return <FloorCell size={cell} gx={x} gy={y} style={fl.style} tl={fl.tl} br={fl.br} />;
  }
  if (g === 'W') {
    const s = Math.max(6, Math.round(cell / 3));
    return <div style={{
      width: cell, height: cell, background: '#565b63',
      backgroundImage: 'repeating-linear-gradient(135deg, #6a7079 0, #6a7079 2px, transparent 2px, transparent 7px)',
      backgroundSize: `${s}px ${s}px`, boxShadow: 'inset 0 0 0 1px #2f343b',
    }} />;
  }
  // '#' rock — unused this quest; near-black so rooms/halls read as "the dungeon".
  return <div style={{ width: cell, height: cell, background: '#13100c' }} />;
}

/** Bold dark walls on the LINES between cells — drawn wherever a room borders a
 *  different region (another room, a corridor, rock or a wall tile), matching the
 *  in-game board. A door on an edge leaves it open (the door bar is drawn on top). */
function WallLayer({ grid, region, doorSet, cell, w, h }: {
  grid: string[][]; region: string[][]; doorSet: Set<string>; cell: number; w: number; h: number;
}) {
  const T = Math.max(2, Math.round(cell * 0.11));
  const wc = '#0c0a09';
  const keyOf = (x: number, y: number) => {
    const g = grid[y]?.[x];
    if (g && ROOM_LETTERS.includes(g)) return region[y]?.[x] || 'room';
    if (g === 'S') return 'stairs';   // the entry staircase (embedded in its room)
    if (g === '.') return 'corridor';
    if (g === 'W') return 'wall';
    return ''; // rock / off-board
  };
  const wallEdge = (ax: number, ay: number, bx: number, by: number) => {
    const a = keyOf(ax, ay), b = keyOf(bx, by);
    if (a === b) return false;
    // The staircase reads as part of its room: open to any room it touches, but
    // walled against corridors / rock / wall tiles so it stays a tidy alcove.
    const aS = a === 'stairs', bS = b === 'stairs';
    if (aS || bS) return !((aS && b.startsWith('room')) || (bS && a.startsWith('room')));
    return a.startsWith('room') || b.startsWith('room');
  };
  const segs: ReactNode[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w && wallEdge(x, y, x + 1, y) && !doorSet.has(`${x + 1},${y},v`))
        segs.push(<div key={`we${x},${y}`} style={{ position: 'absolute', left: (x + 1) * cell - T / 2, top: y * cell, width: T, height: cell, background: wc, borderRadius: 1, zIndex: 2, pointerEvents: 'none' }} />);
      if (y + 1 < h && wallEdge(x, y, x, y + 1) && !doorSet.has(`${x},${y + 1},h`))
        segs.push(<div key={`ws${x},${y}`} style={{ position: 'absolute', left: x * cell, top: (y + 1) * cell - T / 2, width: cell, height: T, background: wc, borderRadius: 1, zIndex: 2, pointerEvents: 'none' }} />);
    }
  }
  return <>{segs}</>;
}
