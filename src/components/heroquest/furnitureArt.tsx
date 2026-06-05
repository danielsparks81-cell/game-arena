// Shared HeroQuest furniture art, used by the editor, the review gallery, and the
// in-game board so all three match. Two looks:
//   • FLAT pieces (table, chest, tomb, throne, altar, bench, …) — top-down art
//     that fills the whole footprint.
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

export type FurnKindStr = string;

export const FURN_BASE: Record<string, { w: number; h: number }> = {
  table: { w: 2, h: 3 }, chest: { w: 1, h: 1 }, bookshelf: { w: 1, h: 3 },
  sorcerer_table: { w: 2, h: 3 }, alchemist_bench: { w: 2, h: 3 }, throne: { w: 1, h: 1 },
  fireplace: { w: 1, h: 3 }, cupboard: { w: 1, h: 3 }, tomb: { w: 2, h: 3 }, rack: { w: 2, h: 3 },
  weapon_rack: { w: 1, h: 3 }, altar: { w: 1, h: 1 }, bench: { w: 1, h: 1 },
};

export const TALL_KINDS = new Set(['bookshelf', 'cupboard', 'fireplace', 'weapon_rack', 'rack']);
export const isTall = (kind: string) => TALL_KINDS.has(kind);

/** Footprint after rotation (odd rot swaps w/h). */
export function furnFootprint(kind: string, rot = 0) {
  const b = FURN_BASE[kind] ?? { w: 1, h: 1 };
  return rot % 2 ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
}

const WOOD = { lite: '#8a5a32', mid: '#6e4424', dark: '#46301a', edge: '#241308' };
const STONE = { lite: '#7b7b80', mid: '#5d5d62', dark: '#3a3a3e', edge: '#1a1a1c' };
const GOLD = '#e8c75a';
const BOOKS = ['#a02828', '#2f5d86', '#2f7d44', '#a07a22', '#6c2f7a', '#3a8f8a'];

// ── FLAT (top-down) renderers — fill the whole W×H footprint ─────────────────
function flatWoodSurface(W: number, H: number, pad = 4): ReactNode[] {
  return [
    <rect key="f" x={pad} y={pad} width={W - pad * 2} height={H - pad * 2} rx="3" fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="2.5" />,
    <rect key="i" x={pad + 3} y={pad + 3} width={W - pad * 2 - 6} height={H - pad * 2 - 6} fill="none" stroke={WOOD.dark} strokeWidth="1" opacity="0.5" />,
  ];
}
function plankLines(W: number, H: number, n: number): ReactNode {
  return (
    <g key="planks" stroke={WOOD.dark} strokeOpacity="0.5" strokeWidth="0.8">
      {Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={8} y1={(H * (i + 1)) / n} x2={W - 8} y2={(H * (i + 1)) / n} />)}
    </g>
  );
}

function flatEls(kind: string, W: number, H: number): ReactNode[] {
  switch (kind) {
    case 'chest':
      return [
        <rect key="b" x={W * 0.12} y={H * 0.4} width={W * 0.76} height={H * 0.48} fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="2" />,
        <path key="lid" d={`M ${W * 0.12} ${H * 0.4} Q ${W / 2} ${H * 0.14} ${W * 0.88} ${H * 0.4} L ${W * 0.88} ${H * 0.5} L ${W * 0.12} ${H * 0.5} Z`} fill={WOOD.lite} stroke={WOOD.edge} strokeWidth="2" />,
        <rect key="b1" x={W * 0.12} y={H * 0.4} width={W * 0.76} height={H * 0.05} fill={GOLD} />,
        <rect key="b2" x={W * 0.12} y={H * 0.82} width={W * 0.76} height={H * 0.05} fill={GOLD} />,
        <rect key="lock" x={W * 0.43} y={H * 0.5} width={W * 0.14} height={H * 0.16} fill={GOLD} stroke="#000" strokeWidth="0.6" />,
      ];
    case 'tomb':
      return [
        <rect key="s" x={5} y={5} width={W - 10} height={H - 10} rx="3" fill={STONE.mid} stroke={STONE.edge} strokeWidth="2.5" />,
        <rect key="i" x={11} y={11} width={W - 22} height={H - 22} fill={STONE.dark} />,
        <ellipse key="head" cx={W / 2} cy={H * 0.28} rx={W * 0.16} ry={H * 0.09} fill={STONE.lite} />,
        <rect key="body" x={W / 2 - W * 0.11} y={H * 0.34} width={W * 0.22} height={H * 0.42} rx={W * 0.08} fill={STONE.lite} />,
        <line key="c1" x1={W / 2} y1={H * 0.46} x2={W / 2} y2={H * 0.7} stroke={STONE.dark} strokeWidth="2.5" />,
        <line key="c2" x1={W / 2 - W * 0.1} y1={H * 0.55} x2={W / 2 + W * 0.1} y2={H * 0.55} stroke={STONE.dark} strokeWidth="2.5" />,
      ];
    case 'throne':
      return [
        <rect key="back" x={W * 0.18} y={H * 0.1} width={W * 0.64} height={H * 0.22} fill={WOOD.lite} stroke={WOOD.edge} strokeWidth="1.5" />,
        <rect key="seat" x={W * 0.2} y={H * 0.32} width={W * 0.6} height={H * 0.55} fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="1.5" />,
        <circle key="gem" cx={W / 2} cy={H * 0.6} r={Math.min(W, H) * 0.13} fill="#a02828" stroke="#000" strokeWidth="0.6" />,
        <line key="g" x1={W * 0.2} y1={H * 0.4} x2={W * 0.8} y2={H * 0.4} stroke={GOLD} strokeWidth="1.5" />,
      ];
    case 'altar':
      return [
        <rect key="b" x={W * 0.15} y={H * 0.2} width={W * 0.7} height={H * 0.6} fill={STONE.mid} stroke={STONE.edge} strokeWidth="2" />,
        <rect key="t" x={W * 0.1} y={H * 0.12} width={W * 0.8} height={H * 0.12} fill={STONE.lite} stroke={STONE.edge} strokeWidth="1.5" />,
        <circle key="c" cx={W / 2} cy={H * 0.5} r={Math.min(W, H) * 0.12} fill="#caa84a" />,
      ];
    case 'bench':
      return [
        <rect key="b" x={6} y={H * 0.3} width={W - 12} height={H * 0.4} rx="3" fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="2" />,
        <line key="l" x1={8} y1={H * 0.5} x2={W - 8} y2={H * 0.5} stroke={WOOD.dark} strokeWidth="0.8" />,
      ];
    case 'sorcerer_table':
      return [...flatWoodSurface(W, H), plankLines(W, H, 4),
        <circle key="orb" cx={W * 0.5} cy={H * 0.45} r={Math.min(W, H) * 0.14} fill="#5aa0c8" stroke="#1a3a4a" strokeWidth="1" opacity="0.9" />,
        <circle key="g" cx={W * 0.5} cy={H * 0.45} r={Math.min(W, H) * 0.07} fill="#bfe6f5" opacity="0.8" />,
      ];
    case 'alchemist_bench':
      return [...flatWoodSurface(W, H), plankLines(W, H, 4),
        <rect key="v1" x={W * 0.3} y={H * 0.35} width={W * 0.08} height={H * 0.18} fill="#5ad07a" opacity="0.85" stroke="#123" strokeWidth="0.5" />,
        <rect key="v2" x={W * 0.5} y={H * 0.4} width={W * 0.08} height={H * 0.14} fill="#d05a9a" opacity="0.85" stroke="#123" strokeWidth="0.5" />,
        <circle key="v3" cx={W * 0.66} cy={H * 0.5} r={W * 0.06} fill="#d0c05a" opacity="0.85" stroke="#123" strokeWidth="0.5" />,
      ];
    case 'table':
    default:
      return [...flatWoodSurface(W, H), plankLines(W, H, Math.max(3, Math.round(H / U))),
        <circle key="cup" cx={W * 0.34} cy={H * 0.4} r={Math.min(W, H) * 0.09} fill="#9a7a5a" stroke="#000" strokeWidth="0.5" />,
        <ellipse key="bread" cx={W * 0.62} cy={H * 0.6} rx={Math.min(W, H) * 0.13} ry={Math.min(W, H) * 0.09} fill="#c8a060" stroke="#5a3a1a" strokeWidth="0.5" />,
      ];
  }
}

// ── TALL (oblique table-angle) renderers ────────────────────────────────────
// The footprint is the floor; a front face rises from the bottom edge toward the
// viewer. `face` decides what the risen surface shows.
type Face = 'down' | 'up' | 'left' | 'right';
const FACES: Face[] = ['right', 'down', 'left', 'up']; // rot 0..3

function spines(x: number, y: number, w: number, h: number, n: number, key: string): ReactNode {
  return <g key={key}>{Array.from({ length: n }, (_, i) => (
    <rect key={i} x={x + (i * w) / n} y={y} width={w / n - Math.max(0.5, w / n * 0.12)} height={h} fill={BOOKS[i % BOOKS.length]} stroke="#0006" strokeWidth="0.5" />
  ))}</g>;
}

function tallDetail(kind: string, x: number, y: number, w: number, h: number): ReactNode {
  switch (kind) {
    case 'fireplace':
      return (
        <g key="d">
          <rect x={x} y={y} width={w} height={h} fill="#1a120c" />
          <path d={`M ${x + w * 0.5} ${y + h} C ${x + w * 0.2} ${y + h * 0.5} ${x + w * 0.4} ${y + h * 0.3} ${x + w * 0.45} ${y + h * 0.1} C ${x + w * 0.55} ${y + h * 0.45} ${x + w * 0.7} ${y + h * 0.45} ${x + w * 0.6} ${y + h} Z`} fill="#f08a1e" />
          <path d={`M ${x + w * 0.5} ${y + h} C ${x + w * 0.38} ${y + h * 0.65} ${x + w * 0.48} ${y + h * 0.5} ${x + w * 0.5} ${y + h * 0.38} C ${x + w * 0.56} ${y + h * 0.6} ${x + w * 0.6} ${y + h * 0.7} ${x + w * 0.55} ${y + h} Z`} fill="#ffd24a" />
        </g>
      );
    case 'cupboard':
      return (
        <g key="d">
          <rect x={x} y={y} width={w} height={h} fill={WOOD.mid} />
          <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke={WOOD.dark} strokeWidth="1.5" />
          <circle cx={x + w * 0.42} cy={y + h * 0.5} r="1.6" fill={GOLD} />
          <circle cx={x + w * 0.58} cy={y + h * 0.5} r="1.6" fill={GOLD} />
        </g>
      );
    case 'weapon_rack':
    case 'rack':
      return (
        <g key="d">
          <rect x={x} y={y} width={w} height={h} fill={WOOD.dark} />
          {Array.from({ length: 3 }, (_, i) => {
            const cx = x + w * (0.25 + i * 0.25);
            return <g key={i}>
              <line x1={cx} y1={y + h * 0.1} x2={cx} y2={y + h * 0.92} stroke="#9a9a9a" strokeWidth="1.4" />
              <polygon points={`${cx - 2},${y + h * 0.1} ${cx + 2},${y + h * 0.1} ${cx},${y + h * 0.02}`} fill="#c4c4c4" stroke="#000" strokeWidth="0.4" />
            </g>;
          })}
        </g>
      );
    case 'bookshelf':
    default: {
      const rows = 3;
      return (
        <g key="d">
          <rect x={x} y={y} width={w} height={h} fill={WOOD.dark} />
          {Array.from({ length: rows }, (_, r) => spines(x + 2, y + 3 + (h - 6) * (r / rows), w - 4, (h - 6) / rows - 2, Math.max(3, Math.round(w / 9)), `r${r}`))}
        </g>
      );
    }
  }
}

function tallEls(kind: string, W: number, H: number, rot: number): ReactNode[] {
  const face = FACES[((rot % 4) + 4) % 4];
  const topH = Math.min(H * 0.42, U * 0.7);   // the top surface (depth toward the back)
  const frontY = topH;
  const frontH = H - topH;
  const els: ReactNode[] = [
    // top of the cabinet (lighter, slightly inset corners → reads as the top)
    <polygon key="top" points={`3,${frontY} ${W - 3},${frontY} ${W - 7},5 7,5`} fill={WOOD.lite} stroke={WOOD.edge} strokeWidth="1.5" />,
    // the front carcass
    <rect key="car" x={3} y={frontY} width={W - 6} height={frontH - 3} fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="2" />,
  ];
  const fx = 6, fw = W - 12, fy = frontY + 3, fh = frontH - 9;
  if (face === 'down') {
    els.push(tallDetail(kind, fx, fy, fw, fh));
  } else if (face === 'up') {
    // facing away — plain back panel + visible top
    els.push(<rect key="back" x={fx} y={fy} width={fw} height={fh} fill={WOOD.mid} />);
    els.push(<g key="planks" stroke={WOOD.dark} strokeWidth="1" opacity="0.6">
      {[0.3, 0.6].map((f, i) => <line key={i} x1={fx} y1={fy + fh * f} x2={fx + fw} y2={fy + fh * f} />)}
    </g>);
  } else {
    // facing left/right — detail edge-on on that side, plain on the other
    const half = fw * 0.5;
    const dx = face === 'left' ? fx : fx + half;
    const px = face === 'left' ? fx + half : fx;
    els.push(<rect key="side" x={px} y={fy} width={half} height={fh} fill={WOOD.mid} />);
    els.push(tallDetail(kind, dx, fy, half, fh));
  }
  els.push(<rect key="frame" x={3} y={frontY} width={W - 6} height={frontH - 3} fill="none" stroke={WOOD.edge} strokeWidth="2" />);
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
