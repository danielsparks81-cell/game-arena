// Shared HeroQuest furniture art, used by the editor, the review gallery, and the
// in-game board so all three match. Two looks:
//   • FLAT pieces (table, chest, tomb, throne, torture rack, alchemy/sorcerer
//     tables, …) — top-down art that fills the whole footprint.
//   • TALL pieces (bookcase, cupboard, fireplace, weapon rack) — an oblique
//     "table angle" view: you always look from the bottom of the board, so a
//     piece shows its front (detail), back (plain), or side depending on which
//     way it faces. `rot` 0..3 = facing right / down / left / up (90° each).
//
// Art is drawn in a (w·U)×(h·U) viewBox so it can fill any footprint; callers
// scale it to the cell size. furnEls() returns raw SVG children (so it works
// inside an existing <svg>, e.g. the gallery); FurnitureSvg wraps them in an
// <svg> for absolute-positioned overlays (editor / board).

import type { ReactNode } from 'react';

const U = 40; // art units per cell

export const FURN_BASE: Record<string, { w: number; h: number }> = {
  table: { w: 2, h: 3 }, chest: { w: 1, h: 1 }, bookshelf: { w: 1, h: 3 },
  sorcerer_table: { w: 2, h: 3 }, alchemist_bench: { w: 2, h: 3 }, throne: { w: 1, h: 1 },
  fireplace: { w: 1, h: 3 }, cupboard: { w: 1, h: 3 }, tomb: { w: 2, h: 3 }, rack: { w: 2, h: 3 },
  weapon_rack: { w: 1, h: 3 }, altar: { w: 1, h: 1 }, bench: { w: 1, h: 1 },
};

export const TALL_KINDS = new Set(['bookshelf', 'cupboard', 'fireplace', 'weapon_rack']);
export const isTall = (kind: string) => TALL_KINDS.has(kind);

/** Footprint after rotation (odd rot swaps w/h). */
export function furnFootprint(kind: string, rot = 0) {
  const b = FURN_BASE[kind] ?? { w: 1, h: 1 };
  return rot % 2 ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
}

const WOOD = { lite: '#9a6438', mid: '#6e4424', dark: '#46301a', edge: '#241308' };
const STONE = { lite: '#83838a', mid: '#62626a', dark: '#3c3c42', edge: '#1a1a1c' };
const IRON = '#3a3a40', IRON_LT = '#8b8b93';
const GOLD = '#e8c75a';
const BOOKS = ['#a02828', '#2f5d86', '#2f7d44', '#a07a22', '#6c2f7a', '#3a8f8a'];

// ── FLAT (top-down) renderers — fill the whole W×H footprint ─────────────────
function woodPanel(x: number, y: number, w: number, h: number, key = 'p'): ReactNode[] {
  return [
    <rect key={key} x={x} y={y} width={w} height={h} rx="3" fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="2.5" />,
    <rect key={key + 'i'} x={x + 3} y={y + 3} width={w - 6} height={h - 6} fill="none" stroke={WOOD.dark} strokeWidth="1" opacity="0.5" />,
    <g key={key + 'g'} stroke={WOOD.dark} strokeOpacity="0.45" strokeWidth="0.7">
      {Array.from({ length: Math.max(2, Math.round(h / 26)) }, (_, i) => (
        <line key={i} x1={x + 6} y1={y + (h * (i + 1)) / (Math.round(h / 26) + 1)} x2={x + w - 6} y2={y + (h * (i + 1)) / (Math.round(h / 26) + 1)} />
      ))}
    </g>,
  ];
}

function flatEls(kind: string, W: number, H: number): ReactNode[] {
  switch (kind) {
    case 'chest': {
      // centred on the tile with padding top & bottom
      const bx = W * 0.14, bw = W * 0.72, by = H * 0.46, bh = H * 0.34;
      return [
        <rect key="b" x={bx} y={by} width={bw} height={bh} fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="2" />,
        <path key="lid" d={`M ${bx} ${by} Q ${W / 2} ${H * 0.2} ${bx + bw} ${by} L ${bx + bw} ${by + H * 0.06} L ${bx} ${by + H * 0.06} Z`} fill={WOOD.lite} stroke={WOOD.edge} strokeWidth="2" />,
        <rect key="i1" x={bx} y={by} width={bw} height={H * 0.04} fill={GOLD} />,
        <rect key="i2" x={bx} y={by + bh - H * 0.04} width={bw} height={H * 0.04} fill={GOLD} />,
        <rect key="lk" x={W / 2 - W * 0.06} y={by + bh * 0.32} width={W * 0.12} height={bh * 0.4} rx="1" fill={GOLD} stroke="#000" strokeWidth="0.6" />,
        <circle key="kh" cx={W / 2} cy={by + bh * 0.6} r={W * 0.018} fill="#1a1408" />,
      ];
    }
    case 'tomb': {
      // stone sarcophagus with a carved effigy of a person on the lid
      const cx = W / 2;
      return [
        <rect key="s" x={5} y={5} width={W - 10} height={H - 10} rx="3" fill={STONE.mid} stroke={STONE.edge} strokeWidth="2.5" />,
        <rect key="lid" x={10} y={10} width={W - 20} height={H - 20} rx="2" fill={STONE.lite} stroke={STONE.edge} strokeWidth="1.5" />,
        // head
        <circle key="head" cx={cx} cy={H * 0.24} r={W * 0.11} fill={STONE.dark} />,
        <circle key="face" cx={cx} cy={H * 0.24} r={W * 0.085} fill={STONE.mid} />,
        <circle key="e1" cx={cx - W * 0.035} cy={H * 0.225} r={W * 0.012} fill={STONE.edge} />,
        <circle key="e2" cx={cx + W * 0.035} cy={H * 0.225} r={W * 0.012} fill={STONE.edge} />,
        <path key="mouth" d={`M ${cx - W * 0.03} ${H * 0.27} Q ${cx} ${H * 0.285} ${cx + W * 0.03} ${H * 0.27}`} fill="none" stroke={STONE.edge} strokeWidth="1" />,
        // robed body
        <path key="body" d={`M ${cx - W * 0.16} ${H * 0.36} Q ${cx} ${H * 0.33} ${cx + W * 0.16} ${H * 0.36} L ${cx + W * 0.13} ${H * 0.82} Q ${cx} ${H * 0.86} ${cx - W * 0.13} ${H * 0.82} Z`} fill={STONE.dark} stroke={STONE.edge} strokeWidth="1" />,
        // crossed arms
        <path key="arm1" d={`M ${cx - W * 0.13} ${H * 0.44} L ${cx + W * 0.06} ${H * 0.56}`} stroke={STONE.lite} strokeWidth={W * 0.05} strokeLinecap="round" />,
        <path key="arm2" d={`M ${cx + W * 0.13} ${H * 0.44} L ${cx - W * 0.06} ${H * 0.56}`} stroke={STONE.lite} strokeWidth={W * 0.05} strokeLinecap="round" />,
        // robe folds
        <g key="folds" stroke={STONE.edge} strokeOpacity="0.5" strokeWidth="0.8">
          <line x1={cx} y1={H * 0.6} x2={cx} y2={H * 0.8} /><line x1={cx - W * 0.06} y1={H * 0.62} x2={cx - W * 0.05} y2={H * 0.8} /><line x1={cx + W * 0.06} y1={H * 0.62} x2={cx + W * 0.05} y2={H * 0.8} />
        </g>,
      ];
    }
    case 'throne': {
      const cx = W / 2;
      return [
        // high ornate back
        <rect key="back" x={W * 0.16} y={H * 0.08} width={W * 0.68} height={H * 0.26} rx="2" fill={WOOD.lite} stroke={WOOD.edge} strokeWidth="1.6" />,
        <path key="crest" d={`M ${cx} ${H * 0.04} L ${W * 0.62} ${H * 0.12} L ${W * 0.38} ${H * 0.12} Z`} fill={GOLD} stroke="#7a5a10" strokeWidth="0.6" />,
        <circle key="f1" cx={W * 0.2} cy={H * 0.1} r={W * 0.035} fill={GOLD} />,
        <circle key="f2" cx={W * 0.8} cy={H * 0.1} r={W * 0.035} fill={GOLD} />,
        // arm rests
        <rect key="al" x={W * 0.12} y={H * 0.34} width={W * 0.1} height={H * 0.5} rx="2" fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="1.4" />,
        <rect key="ar" x={W * 0.78} y={H * 0.34} width={W * 0.1} height={H * 0.5} rx="2" fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="1.4" />,
        // seat + cushion
        <rect key="seat" x={W * 0.22} y={H * 0.34} width={W * 0.56} height={H * 0.52} rx="2" fill={WOOD.dark} stroke={WOOD.edge} strokeWidth="1.4" />,
        <rect key="cush" x={W * 0.28} y={H * 0.42} width={W * 0.44} height={H * 0.4} rx="4" fill="#9c2330" stroke="#5a1018" strokeWidth="1" />,
        <line key="gt" x1={W * 0.16} y1={H * 0.3} x2={W * 0.84} y2={H * 0.3} stroke={GOLD} strokeWidth="1.6" />,
      ];
    }
    case 'rack': {
      // torture rack — a low frame with a roller + crank at each end and ropes
      const fy = H * 0.18, fh = H * 0.64;
      return [
        <rect key="f" x={W * 0.1} y={fy} width={W * 0.8} height={fh} rx="2" fill={WOOD.dark} stroke={WOOD.edge} strokeWidth="2" />,
        // side rails
        <rect key="r1" x={W * 0.1} y={fy} width={W * 0.8} height={H * 0.06} fill={WOOD.mid} />,
        <rect key="r2" x={W * 0.1} y={fy + fh - H * 0.06} width={W * 0.8} height={H * 0.06} fill={WOOD.mid} />,
        // rollers (top & bottom)
        <rect key="rollT" x={W * 0.06} y={fy - H * 0.05} width={W * 0.88} height={H * 0.08} rx={H * 0.04} fill={WOOD.lite} stroke={WOOD.edge} strokeWidth="1.2" />,
        <rect key="rollB" x={W * 0.06} y={fy + fh - H * 0.03} width={W * 0.88} height={H * 0.08} rx={H * 0.04} fill={WOOD.lite} stroke={WOOD.edge} strokeWidth="1.2" />,
        // ropes
        <g key="ropes" stroke="#cdbb8a" strokeWidth="1.4">
          <line x1={W * 0.28} y1={fy} x2={W * 0.28} y2={fy + fh} /><line x1={W * 0.5} y1={fy} x2={W * 0.5} y2={fy + fh} /><line x1={W * 0.72} y1={fy} x2={W * 0.72} y2={fy + fh} />
        </g>,
        // crank handles
        <circle key="c1" cx={W * 0.92} cy={fy - H * 0.01} r={W * 0.05} fill={IRON} stroke="#000" strokeWidth="0.6" />,
        <circle key="c2" cx={W * 0.08} cy={fy + fh + H * 0.01} r={W * 0.05} fill={IRON} stroke="#000" strokeWidth="0.6" />,
      ];
    }
    case 'sorcerer_table': {
      const cx = W / 2;
      return [
        ...woodPanel(4, 4, W - 8, H - 8),
        // open book in the centre
        <g key="book">
          <path d={`M ${cx} ${H * 0.34} C ${cx - W * 0.04} ${H * 0.3} ${cx - W * 0.22} ${H * 0.3} ${cx - W * 0.26} ${H * 0.34} L ${cx - W * 0.26} ${H * 0.62} C ${cx - W * 0.22} ${H * 0.58} ${cx - W * 0.04} ${H * 0.58} ${cx} ${H * 0.62} Z`} fill="#efe6cf" stroke="#7a6a48" strokeWidth="1" />
          <path d={`M ${cx} ${H * 0.34} C ${cx + W * 0.04} ${H * 0.3} ${cx + W * 0.22} ${H * 0.3} ${cx + W * 0.26} ${H * 0.34} L ${cx + W * 0.26} ${H * 0.62} C ${cx + W * 0.22} ${H * 0.58} ${cx + W * 0.04} ${H * 0.58} ${cx} ${H * 0.62} Z`} fill="#e3d8bd" stroke="#7a6a48" strokeWidth="1" />
          <line x1={cx} y1={H * 0.335} x2={cx} y2={H * 0.61} stroke="#7a6a48" strokeWidth="1.4" />
          <g stroke="#9a8a64" strokeWidth="0.7">
            {[0.40, 0.46, 0.52].map((f, i) => <line key={`l${i}`} x1={cx - W * 0.21} y1={H * f} x2={cx - W * 0.06} y2={H * f} />)}
            {[0.40, 0.46, 0.52].map((f, i) => <line key={`r${i}`} x1={cx + W * 0.06} y1={H * f} x2={cx + W * 0.21} y2={H * f} />)}
          </g>
        </g>,
        <circle key="orb" cx={W * 0.74} cy={H * 0.78} r={W * 0.07} fill="#5aa0c8" stroke="#1a3a4a" strokeWidth="1" opacity="0.9" />,
        <circle key="orbh" cx={W * 0.72} cy={H * 0.76} r={W * 0.025} fill="#dff2fb" opacity="0.8" />,
      ];
    }
    case 'alchemist_bench':
      return [...woodPanel(4, 4, W - 8, H - 8),
        <rect key="v1" x={W * 0.26} y={H * 0.34} width={W * 0.09} height={H * 0.2} rx="1.5" fill="#5ad07a" opacity="0.85" stroke="#123" strokeWidth="0.6" />,
        <rect key="v2" x={W * 0.46} y={H * 0.4} width={W * 0.09} height={H * 0.16} rx="1.5" fill="#d05a9a" opacity="0.85" stroke="#123" strokeWidth="0.6" />,
        <circle key="v3" cx={W * 0.68} cy={H * 0.52} r={W * 0.07} fill="#d0c05a" opacity="0.85" stroke="#123" strokeWidth="0.6" />,
        <rect key="st" x={W * 0.3} y={H * 0.62} width={W * 0.4} height={H * 0.04} fill={WOOD.dark} />,
      ];
    case 'altar':
      return [
        <rect key="b" x={W * 0.16} y={H * 0.22} width={W * 0.68} height={H * 0.58} fill={STONE.mid} stroke={STONE.edge} strokeWidth="2" />,
        <rect key="t" x={W * 0.1} y={H * 0.14} width={W * 0.8} height={H * 0.12} fill={STONE.lite} stroke={STONE.edge} strokeWidth="1.5" />,
        <circle key="c" cx={W / 2} cy={H * 0.52} r={Math.min(W, H) * 0.12} fill={GOLD} />,
      ];
    case 'bench':
      return [
        <rect key="b" x={6} y={H * 0.32} width={W - 12} height={H * 0.36} rx="3" fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="2" />,
        <line key="l" x1={8} y1={H * 0.5} x2={W - 8} y2={H * 0.5} stroke={WOOD.dark} strokeWidth="0.8" />,
      ];
    case 'table':
    default: {
      const cx = W / 2;
      return [...woodPanel(4, 4, W - 8, H - 8),
        // plate
        <circle key="plate" cx={W * 0.36} cy={H * 0.4} r={Math.min(W, H) * 0.12} fill="#cdbfa6" stroke="#7a6a48" strokeWidth="1" />,
        <circle key="plate2" cx={W * 0.36} cy={H * 0.4} r={Math.min(W, H) * 0.07} fill="#b6a486" />,
        // goblet
        <g key="goblet">
          <ellipse cx={W * 0.66} cy={H * 0.34} rx={Math.min(W, H) * 0.07} ry={Math.min(W, H) * 0.05} fill="#caa84a" stroke="#7a5a10" strokeWidth="0.8" />
          <rect x={cx + W * 0.14} y={H * 0.34} width={W * 0.02} height={H * 0.06} fill="#caa84a" />
        </g>,
        // bread
        <ellipse key="bread" cx={W * 0.6} cy={H * 0.62} rx={Math.min(W, H) * 0.13} ry={Math.min(W, H) * 0.08} fill="#c8a060" stroke="#5a3a1a" strokeWidth="0.8" />,
        <g key="slash" stroke="#5a3a1a" strokeWidth="0.7">
          <line x1={W * 0.54} y1={H * 0.6} x2={W * 0.57} y2={H * 0.64} /><line x1={W * 0.6} y1={H * 0.59} x2={W * 0.63} y2={H * 0.63} />
        </g>,
        // candle
        <g key="candle">
          <rect x={W * 0.3} y={H * 0.66} width={W * 0.04} height={H * 0.12} fill="#e8e0c8" stroke="#9a8a64" strokeWidth="0.5" />
          <ellipse cx={W * 0.32} cy={H * 0.64} rx={W * 0.018} ry={H * 0.02} fill="#ffb13a" />
        </g>,
      ];
    }
  }
}

// ── TALL (oblique table-angle) renderers ────────────────────────────────────
type Face = 'down' | 'up' | 'left' | 'right';
const FACES: Face[] = ['right', 'down', 'left', 'up']; // rot 0..3

function spines(x: number, y: number, w: number, h: number, n: number, key: string): ReactNode {
  return <g key={key}>{Array.from({ length: n }, (_, i) => (
    <rect key={i} x={x + (i * w) / n} y={y} width={w / n - Math.max(0.6, (w / n) * 0.14)} height={h} fill={BOOKS[i % BOOKS.length]} stroke="#0006" strokeWidth="0.5" />
  ))}</g>;
}

function tallDetail(kind: string, x: number, y: number, w: number, h: number): ReactNode {
  switch (kind) {
    case 'fireplace':
      return (
        <g key="d">
          {/* hearth opening */}
          <path d={`M ${x} ${y + h} L ${x} ${y + h * 0.35} Q ${x + w / 2} ${y - h * 0.05} ${x + w} ${y + h * 0.35} L ${x + w} ${y + h} Z`} fill="#140d08" />
          {/* logs */}
          <rect x={x + w * 0.18} y={y + h * 0.78} width={w * 0.64} height={h * 0.1} rx={h * 0.05} fill="#5a3a1e" />
          <rect x={x + w * 0.26} y={y + h * 0.68} width={w * 0.5} height={h * 0.09} rx={h * 0.045} fill="#6e4a26" transform={`rotate(-8 ${x + w / 2} ${y + h * 0.7})`} />
          {/* flames */}
          <path d={`M ${x + w * 0.5} ${y + h * 0.74} C ${x + w * 0.28} ${y + h * 0.5} ${x + w * 0.42} ${y + h * 0.34} ${x + w * 0.46} ${y + h * 0.2} C ${x + w * 0.56} ${y + h * 0.42} ${x + w * 0.72} ${y + h * 0.46} ${x + w * 0.6} ${y + h * 0.74} Z`} fill="#f08a1e" />
          <path d={`M ${x + w * 0.5} ${y + h * 0.74} C ${x + w * 0.4} ${y + h * 0.56} ${x + w * 0.48} ${y + h * 0.46} ${x + w * 0.5} ${y + h * 0.34} C ${x + w * 0.56} ${y + h * 0.5} ${x + w * 0.58} ${y + h * 0.6} ${x + w * 0.55} ${y + h * 0.74} Z`} fill="#ffd24a" />
        </g>
      );
    case 'cupboard':
      return (
        <g key="d">
          <rect x={x} y={y} width={w} height={h} fill={WOOD.mid} />
          <rect x={x + 1.5} y={y + 1.5} width={w / 2 - 2.5} height={h - 3} fill={WOOD.dark} stroke={WOOD.edge} strokeWidth="0.8" />
          <rect x={x + w / 2 + 1} y={y + 1.5} width={w / 2 - 2.5} height={h - 3} fill={WOOD.dark} stroke={WOOD.edge} strokeWidth="0.8" />
          <circle cx={x + w * 0.42} cy={y + h * 0.5} r="1.8" fill={GOLD} />
          <circle cx={x + w * 0.58} cy={y + h * 0.5} r="1.8" fill={GOLD} />
        </g>
      );
    case 'weapon_rack':
      return (
        <g key="d">
          <rect x={x} y={y} width={w} height={h} fill={WOOD.dark} />
          <rect x={x} y={y + h * 0.08} width={w} height={h * 0.06} fill={WOOD.mid} />
          <rect x={x} y={y + h * 0.86} width={w} height={h * 0.06} fill={WOOD.mid} />
          {/* sword */}
          <g transform={`translate(${x + w * 0.26} 0)`}>
            <rect x={-1} y={y + h * 0.12} width="2" height={h * 0.66} fill={IRON_LT} stroke="#000" strokeWidth="0.4" />
            <rect x={-4} y={y + h * 0.74} width="8" height="2.2" fill="#5a3a1e" />
            <rect x={-1.2} y={y + h * 0.76} width="2.4" height={h * 0.1} fill="#5a3a1e" />
          </g>
          {/* axe */}
          <g transform={`translate(${x + w * 0.52} 0)`}>
            <rect x={-1} y={y + h * 0.16} width="2" height={h * 0.66} fill="#6e4a26" />
            <path d={`M 0 ${y + h * 0.2} q 8 2 6 9 q -4 2 -6 0 Z`} fill={IRON_LT} stroke="#000" strokeWidth="0.4" />
          </g>
          {/* spear */}
          <g transform={`translate(${x + w * 0.76} 0)`}>
            <rect x={-1} y={y + h * 0.12} width="2" height={h * 0.74} fill="#6e4a26" />
            <polygon points={`-3,${y + h * 0.14} 3,${y + h * 0.14} 0,${y + h * 0.03}`} fill={IRON_LT} stroke="#000" strokeWidth="0.4" />
          </g>
        </g>
      );
    case 'bookshelf':
    default: {
      const rows = 3;
      return (
        <g key="d">
          <rect x={x} y={y} width={w} height={h} fill={WOOD.dark} />
          {Array.from({ length: rows }, (_, r) => (
            <g key={r}>
              {spines(x + 2, y + 3 + (h - 6) * (r / rows), w - 4, (h - 6) / rows - 3, Math.max(3, Math.round(w / 9)), `r${r}`)}
              <rect x={x} y={y + (h - 6) * ((r + 1) / rows)} width={w} height="2" fill={WOOD.mid} />
            </g>
          ))}
        </g>
      );
    }
  }
}

function tallEls(kind: string, W: number, H: number, rot: number): ReactNode[] {
  const face = FACES[((rot % 4) + 4) % 4];
  const M = kind === 'fireplace' ? STONE : WOOD;
  const topH = Math.min(H * 0.42, U * 0.7);
  const frontY = topH, frontH = H - topH;
  const els: ReactNode[] = [
    <polygon key="top" points={`3,${frontY} ${W - 3},${frontY} ${W - 7},5 7,5`} fill={M.lite} stroke={M.edge} strokeWidth="1.5" />,
    <rect key="car" x={3} y={frontY} width={W - 6} height={frontH - 3} fill={M.mid} stroke={M.edge} strokeWidth="2" />,
  ];
  const fx = 6, fw = W - 12, fy = frontY + 3, fh = frontH - 9;
  if (face === 'down') {
    els.push(tallDetail(kind, fx, fy, fw, fh));
  } else if (face === 'up') {
    els.push(<rect key="back" x={fx} y={fy} width={fw} height={fh} fill={M.mid} />);
    els.push(<g key="planks" stroke={M.dark} strokeWidth="1" opacity="0.6">
      {[0.3, 0.6].map((f, i) => <line key={i} x1={fx} y1={fy + fh * f} x2={fx + fw} y2={fy + fh * f} />)}
    </g>);
  } else {
    const half = fw * 0.5;
    const dx = face === 'left' ? fx : fx + half;
    const px = face === 'left' ? fx + half : fx;
    els.push(<rect key="side" x={px} y={fy} width={half} height={fh} fill={M.mid} />);
    els.push(tallDetail(kind, dx, fy, half, fh));
  }
  els.push(<rect key="frame" x={3} y={frontY} width={W - 6} height={frontH - 3} fill="none" stroke={M.edge} strokeWidth="2" />);
  return els;
}

/** Furniture SVG children in a (w·U)×(h·U) viewBox. Use inside any <svg>. */
export function furnEls(kind: string, w: number, h: number, rot = 0): ReactNode[] {
  const W = w * U, H = h * U;
  return isTall(kind) ? tallEls(kind, W, H, rot) : flatEls(kind, W, H);
}

/** Convenience: the art as a standalone <svg> for an absolute overlay. */
export function FurnitureSvg({ kind, w, h, rot = 0, cell }: { kind: string; w: number; h: number; rot?: number; cell: number }) {
  return (
    <svg width={w * cell} height={h * cell} viewBox={`0 0 ${w * U} ${h * U}`} style={{ display: 'block' }} aria-hidden>
      {furnEls(kind, w, h, rot)}
    </svg>
  );
}
