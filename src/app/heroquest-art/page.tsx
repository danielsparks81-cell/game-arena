// HeroQuest furniture art gallery — compare style directions and pick one.
// Visit /heroquest-art. Three styles per piece:
//   A — Current (what's live: small token on a wood slab)
//   B — Filled top-down (art fills the whole footprint)
//   C — Table angle (oblique; furniture "stands up" toward the viewer at the
//       bottom of the board, so each piece has 4 orientations)

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Furniture Art Gallery — HeroQuest' };

const CELL = 46;
const FLOOR = '#6a4658';   // plum room floor (matches the screenshot)
const FLOOR_BR = '#432c38';

// ── A faint stone-floor backdrop sized to a w×h footprint ───────────────────
function Floor({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', width: w * CELL, height: h * CELL, background: `linear-gradient(135deg, ${FLOOR}, ${FLOOR_BR})`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35)' }}>
      {/* per-square grid */}
      <svg width={w * CELL} height={h * CELL} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        {Array.from({ length: w + 1 }, (_, i) => <line key={`v${i}`} x1={i * CELL} y1={0} x2={i * CELL} y2={h * CELL} stroke="#000" strokeOpacity="0.22" />)}
        {Array.from({ length: h + 1 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * CELL} x2={w * CELL} y2={i * CELL} stroke="#000" strokeOpacity="0.22" />)}
      </svg>
      {children}
    </div>
  );
}

const WOOD = { lite: '#8a5a32', mid: '#6e4424', dark: '#46301a', edge: '#2a1c10' };
const BOOKS = ['#a02828', '#2f5d86', '#2f7d44', '#a07a22', '#6c2f7a', '#3a8f8a'];

// ── BOOKSHELF — three styles ────────────────────────────────────────────────
function ShelfCurrent() {
  // slab + small centred icon (the "bookcase on a plank" look that's live now)
  return (
    <Floor w={1} h={3}>
      <div style={{ position: 'absolute', inset: 2, background: `linear-gradient(135deg, ${WOOD.lite}, ${WOOD.dark})`, border: '2px solid #100b05', borderRadius: 3 }} />
      <svg width={CELL} height={CELL} viewBox="0 0 40 40" style={{ position: 'absolute', left: 0, top: CELL }} aria-hidden>
        <rect x="6" y="6" width="28" height="28" fill={WOOD.dark} stroke="#0a0408" strokeWidth="0.8" />
        <line x1="6" y1="15" x2="34" y2="15" stroke={WOOD.lite} /><line x1="6" y1="24" x2="34" y2="24" stroke={WOOD.lite} />
        {[6, 10, 14, 18, 22, 26, 30].map((x, i) => <rect key={i} x={x} y={8} width={2.5} height={6} fill={BOOKS[i % BOOKS.length]} />)}
      </svg>
    </Floor>
  );
}

function ShelfFilled() {
  // one tall bookcase that fills the whole 1×3 footprint (top-down)
  const W = CELL, H = CELL * 3;
  const shelves = [0.06, 0.30, 0.54, 0.78];
  return (
    <Floor w={1} h={3}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <rect x="2" y="2" width={W - 4} height={H - 4} rx="2" fill={WOOD.dark} stroke={WOOD.edge} strokeWidth="2" />
        <rect x="5" y="5" width={W - 10} height={H - 10} fill={WOOD.mid} />
        {shelves.map((f, s) => (
          <g key={s}>
            <rect x="5" y={H * f + 14} width={W - 10} height="3" fill={WOOD.dark} />
            {Array.from({ length: 6 }, (_, i) => (
              <rect key={i} x={7 + i * ((W - 16) / 6)} y={H * f} width={(W - 16) / 6 - 1.5} height="14" fill={BOOKS[(s + i) % BOOKS.length]} stroke="#0006" strokeWidth="0.4" />
            ))}
          </g>
        ))}
      </svg>
    </Floor>
  );
}

// Oblique bookcase that "stands up" toward the viewer. `facing` = which way the
// open (book) side points, from the always-bottom viewpoint.
function ShelfOblique({ facing }: { facing: 'down' | 'up' | 'left' | 'right' }) {
  const W = CELL, H = CELL * 3, D = 20; // D = how far it rises toward the viewer
  // Books drawn on a flat panel, used as the visible face.
  const Spines = ({ x, y, w, h, n }: { x: number; y: number; w: number; h: number; n: number }) => (
    <g>{Array.from({ length: n }, (_, i) => <rect key={i} x={x + i * (w / n)} y={y} width={w / n - 1} height={h} fill={BOOKS[i % BOOKS.length]} stroke="#0006" strokeWidth="0.4" />)}</g>
  );
  return (
    <Floor w={1} h={3}>
      <svg width={W} height={H + D} viewBox={`0 0 ${W} ${H + D}`} style={{ position: 'absolute', left: 0, top: -D }} aria-hidden>
        <ellipse cx={W / 2} cy={H + D - 4} rx={W * 0.4} ry="4" fill="#0007" />
        {/* carcass: footprint on the floor + a front wall risen by D */}
        <rect x="3" y={D + 3} width={W - 6} height={H - 6} fill={WOOD.dark} />
        <polygon points={`3,${D + 3} ${W - 3},${D + 3} ${W - 3},${3} 3,3`} fill={WOOD.mid} opacity="0.9" />
        {/* visible detailed face depends on `facing` */}
        {facing === 'up' && (   // open side points away → we see the plain back + top
          <>
            <rect x="5" y="6" width={W - 10} height={D} fill={WOOD.lite} />
            {[0.18, 0.5, 0.82].map((f, i) => <line key={i} x1={5} y1={6 + D * f} x2={W - 5} y2={6 + D * f} stroke={WOOD.dark} strokeWidth="1" />)}
            <text x={W / 2} y={D + H / 2} textAnchor="middle" fontSize="9" fill="#0008">back</text>
          </>
        )}
        {facing === 'down' && (  // open side toward viewer → full shelves of books
          <g>
            {[0.10, 0.40, 0.70].map((f, s) => <Spines key={s} x={6} y={D + 4 + (H - 16) * f} w={W - 12} h={(H - 16) * 0.26} n={5} />)}
          </g>
        )}
        {(facing === 'left' || facing === 'right') && (  // side-on: books edge-on on one side
          <g transform={facing === 'right' ? `translate(${W},0) scale(-1,1)` : undefined}>
            <rect x="5" y={D + 4} width={(W - 10) * 0.5} height={H - 12} fill={WOOD.lite} />
            <Spines x={(W) * 0.52} y={D + 6} w={(W - 10) * 0.42} h={H - 16} n={1} />
          </g>
        )}
        <rect x="3" y={D + 3} width={W - 6} height={H - 6} fill="none" stroke={WOOD.edge} strokeWidth="2" />
      </svg>
    </Floor>
  );
}

// ── Low pieces (table / chest / tomb) — filled top-down + a quick oblique ────
function TableFilled() {
  const W = CELL * 2, H = CELL * 3;
  return (
    <Floor w={2} h={3}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <rect x="6" y="6" width={W - 12} height={H - 12} rx="3" fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="2" />
        {Array.from({ length: 6 }, (_, i) => <line key={i} x1={10} y1={6 + (H - 12) * (i / 6) + 8} x2={W - 10} y2={6 + (H - 12) * (i / 6) + 8} stroke={WOOD.dark} strokeWidth="0.6" opacity="0.6" />)}
        <circle cx={W * 0.32} cy={H * 0.4} r="6" fill="#9a7a5a" stroke="#000" strokeWidth="0.5" />
        <ellipse cx={W * 0.62} cy={H * 0.6} rx="9" ry="6" fill="#c8a060" stroke="#5a3a1a" strokeWidth="0.5" />
      </svg>
    </Floor>
  );
}
function ChestFilled() {
  return (
    <Floor w={1} h={1}>
      <svg width={CELL} height={CELL} viewBox="0 0 46 46" style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <rect x="6" y="20" width="34" height="20" fill={WOOD.mid} stroke={WOOD.edge} strokeWidth="1.5" />
        <path d="M6,20 Q23,8 40,20 L40,24 L6,24 Z" fill={WOOD.lite} stroke={WOOD.edge} strokeWidth="1.5" />
        <rect x="6" y="20" width="34" height="2.5" fill="#caa84a" /><rect x="6" y="37" width="34" height="2.5" fill="#caa84a" />
        <rect x="20" y="24" width="6" height="8" fill="#e8c75a" stroke="#000" strokeWidth="0.5" />
      </svg>
    </Floor>
  );
}
function TombFilled() {
  const W = CELL * 2, H = CELL * 3;
  return (
    <Floor w={2} h={3}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <rect x="6" y="6" width={W - 12} height={H - 12} rx="3" fill="#6a6a6a" stroke="#1a1a1a" strokeWidth="2" />
        <rect x="12" y="12" width={W - 24} height={H - 24} fill="#565656" />
        <ellipse cx={W / 2} cy={H * 0.3} rx="14" ry="9" fill="#454545" />
        <rect x={W / 2 - 9} y={H * 0.36} width="18" height={H * 0.4} fill="#454545" />
        <line x1={W / 2} y1={H * 0.5} x2={W / 2} y2={H * 0.72} stroke="#2a2a2a" strokeWidth="2" />
        <line x1={W / 2 - 8} y1={H * 0.58} x2={W / 2 + 8} y2={H * 0.58} stroke="#2a2a2a" strokeWidth="2" />
      </svg>
    </Floor>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex min-h-[150px] items-end">{children}</div>
      <div className="text-center">
        <div className="text-sm font-semibold text-stone-200">{title}</div>
        {sub && <div className="text-[11px] text-stone-400">{sub}</div>}
      </div>
    </div>
  );
}

export default function HeroQuestArtGallery() {
  return (
    <div className="min-h-screen bg-neutral-950 p-6 text-stone-200">
      <div className="mx-auto max-w-5xl space-y-10">
        <header>
          <h1 className="text-2xl font-bold text-amber-200">HeroQuest — Furniture Art Directions</h1>
          <p className="mt-1 text-sm text-stone-400">
            Three ways to draw furniture. Pick the one you like and I&apos;ll roll it out across every piece on the
            board (and in the editor / review gallery).
          </p>
        </header>

        {/* The bookshelf the user flagged */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-amber-300">Bookcase (the piece you flagged)</h2>
          <div className="flex flex-wrap gap-8">
            <Card title="A · Current" sub="small icon on a wood slab">
              <ShelfCurrent />
            </Card>
            <Card title="B · Filled top-down" sub="art fills the whole footprint">
              <ShelfFilled />
            </Card>
            <Card title="C · Table angle" sub="stands up toward you (facing down)">
              <ShelfOblique facing="down" />
            </Card>
          </div>
        </section>

        {/* The 4 orientations for the table-angle idea */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-amber-300">Table angle — the 4 orientations</h2>
          <p className="text-sm text-stone-400">
            You always view from the bottom of the board. A piece against the <strong>top</strong> wall faces you (you
            see the books); against the <strong>bottom</strong> wall you see its back; against a side wall you see its
            side. The author picks which way each piece faces.
          </p>
          <div className="flex flex-wrap gap-8">
            <Card title="Faces down" sub="against the TOP wall → books"><ShelfOblique facing="down" /></Card>
            <Card title="Faces up" sub="against the BOTTOM wall → back"><ShelfOblique facing="up" /></Card>
            <Card title="Faces left" sub="against the RIGHT wall → side"><ShelfOblique facing="left" /></Card>
            <Card title="Faces right" sub="against the LEFT wall → side"><ShelfOblique facing="right" /></Card>
          </div>
        </section>

        {/* Other pieces in the filled top-down style */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-amber-300">Other pieces · Filled top-down (style B)</h2>
          <div className="flex flex-wrap gap-8">
            <Card title="Table"><TableFilled /></Card>
            <Card title="Chest"><ChestFilled /></Card>
            <Card title="Tomb"><TombFilled /></Card>
          </div>
        </section>

        <footer className="border-t border-stone-800 pt-4 text-sm text-stone-400">
          Tell me <strong>A</strong>, <strong>B</strong>, or <strong>C</strong> (or a mix — e.g. &ldquo;B for flat
          pieces, C for tall ones&rdquo;) and I&apos;ll build the full set.
        </footer>
      </div>
    </div>
  );
}
