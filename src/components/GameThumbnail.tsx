// Inline SVG thumbnails for each game — no external assets, scales perfectly.

export function GameThumbnail({ gameId, className }: { gameId: string; className?: string }) {
  if (gameId === 'tictactoe') return <TicTacToeThumb className={className} />;
  if (gameId === 'connect4')  return <ConnectFourThumb className={className} />;
  if (gameId === 'longshot')  return <LongShotThumb className={className} />;
  if (gameId === 'checkers')  return <CheckersThumb className={className} />;
  if (gameId === 'battleship') return <BattleshipThumb className={className} />;
  if (gameId === 'boggle')     return <BoggleThumb className={className} />;
  if (gameId === 'liarsdice')  return <LiarsDiceThumb className={className} />;
  if (gameId === 'yahtzee')    return <YahtzeeThumb className={className} />;
  if (gameId === 'rps')        return <RpsThumb className={className} />;
  if (gameId === 'spellduel')  return <SpellduelThumb className={className} />;
  if (gameId === 'legendary')  return <LegendaryThumb className={className} />;
  return <PlaceholderThumb className={className} />;
}

function LegendaryThumb({ className }: { className?: string }) {
  // Mastermind-on-comic-pop background with a city skyline and a card-fan
  // motif that mirrors the in-game HQ row.
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Legendary">
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7f1d1d" />
          <stop offset="1" stopColor="#0a0a0a" />
        </linearGradient>
        <radialGradient id="lg-rays" cx="0.5" cy="0.45" r="0.7">
          <stop offset="0" stopColor="#fde047" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fde047" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lg-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e1b4b" />
          <stop offset="1" stopColor="#0a0a0a" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" fill="url(#lg-bg)" />
      <circle cx="70" cy="44" r="50" fill="url(#lg-rays)" />

      {/* Faux skyline silhouette */}
      <g fill="#0a0a0a" opacity="0.7">
        <rect x="0"   y="70" width="14" height="30" />
        <rect x="18"  y="60" width="10" height="40" />
        <rect x="32"  y="76" width="14" height="24" />
        <rect x="100" y="68" width="12" height="32" />
        <rect x="116" y="58" width="10" height="42" />
        <rect x="130" y="72" width="10" height="28" />
      </g>

      {/* Three fanned cards centered */}
      <g transform="translate(38 26)">
        <g transform="rotate(-12) translate(-2 2)">
          <rect width="22" height="34" rx="3" fill="url(#lg-card)" stroke="#ef4444" strokeWidth="0.8" />
          <text x="11" y="14" textAnchor="middle" fontSize="11">🛡</text>
          <text x="11" y="28" textAnchor="middle" fontSize="5" fill="#cbd5e1" fontFamily="system-ui">HERO</text>
        </g>
        <g transform="translate(24 -4)">
          <rect width="22" height="40" rx="3" fill="url(#lg-card)" stroke="#fbbf24" strokeWidth="1" />
          <text x="11" y="16" textAnchor="middle" fontSize="13">⚡</text>
          <text x="11" y="32" textAnchor="middle" fontSize="5" fill="#cbd5e1" fontFamily="system-ui">VILLAIN</text>
        </g>
        <g transform="rotate(12) translate(46 2)">
          <rect width="22" height="34" rx="3" fill="url(#lg-card)" stroke="#10b981" strokeWidth="0.8" />
          <text x="11" y="14" textAnchor="middle" fontSize="11">⚔</text>
          <text x="11" y="28" textAnchor="middle" fontSize="5" fill="#cbd5e1" fontFamily="system-ui">FIGHT</text>
        </g>
      </g>
    </svg>
  );
}

function SpellduelThumb({ className }: { className?: string }) {
  // Three fanned-out spell cards over a dark arcane background, plus a stylized
  // fireball/spark on top suggesting a card just got "played" and triggered.
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Spellduel">
      <defs>
        <linearGradient id="sd-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e1b4b" />
          <stop offset="1" stopColor="#020617" />
        </linearGradient>
        <linearGradient id="sd-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#312e81" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <radialGradient id="sd-spark" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fde68a" stopOpacity="1" />
          <stop offset="0.6" stopColor="#f59e0b" stopOpacity="0.7" />
          <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="140" height="100" fill="url(#sd-bg)" />

      {/* Subtle rune sparkles */}
      <text x="14"  y="22" fontSize="9" fill="#a78bfa" opacity="0.5">✦</text>
      <text x="124" y="80" fontSize="9" fill="#a78bfa" opacity="0.5">✦</text>
      <text x="120" y="28" fontSize="7" fill="#a78bfa" opacity="0.4">✧</text>
      <text x="18"  y="78" fontSize="7" fill="#a78bfa" opacity="0.4">✧</text>

      {/* Three fanned cards */}
      <g transform="translate(40 30) rotate(-15)">
        <rect width="28" height="44" rx="3" fill="url(#sd-card)" stroke="#6366f1" strokeWidth="0.8" />
        <text x="14" y="17" textAnchor="middle" fontSize="14">🛡</text>
        <text x="14" y="34" textAnchor="middle" fontSize="6" fill="#cbd5e1" fontFamily="system-ui">COUNTER</text>
      </g>
      <g transform="translate(70 26)">
        <rect width="28" height="48" rx="3" fill="url(#sd-card)" stroke="#10b981" strokeWidth="1" />
        <text x="14" y="19" textAnchor="middle" fontSize="16">🔥</text>
        <text x="14" y="36" textAnchor="middle" fontSize="6" fill="#cbd5e1" fontFamily="system-ui">FIREBALL</text>
        <circle cx="23" cy="6" r="3.5" fill="#0ea5e9" />
        <text x="23" y="8.5" textAnchor="middle" fontSize="5" fill="white" fontWeight="bold" fontFamily="system-ui">3</text>
      </g>
      <g transform="translate(100 30) rotate(15)">
        <rect width="28" height="44" rx="3" fill="url(#sd-card)" stroke="#6366f1" strokeWidth="0.8" />
        <text x="14" y="17" textAnchor="middle" fontSize="14">⚡</text>
        <text x="14" y="34" textAnchor="middle" fontSize="6" fill="#cbd5e1" fontFamily="system-ui">COMBO</text>
      </g>

      {/* Spark/glow over the fireball card */}
      <circle cx="84" cy="42" r="22" fill="url(#sd-spark)" />
    </svg>
  );
}

function RpsThumb({ className }: { className?: string }) {
  // Two hands throwing rock vs scissors with a "VS" pill, plus three emoji
  // tokens to advertise the choices.
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Rock-Paper-Scissors">
      <defs>
        <linearGradient id="rps-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e1b4b" />
          <stop offset="1" stopColor="#0c0a09" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" fill="url(#rps-bg)" />
      {/* Three giant emoji choices in a row */}
      <text x="30" y="60" textAnchor="middle" fontSize="38">🪨</text>
      <text x="70" y="60" textAnchor="middle" fontSize="38">📄</text>
      <text x="110" y="60" textAnchor="middle" fontSize="38">✂️</text>
    </svg>
  );
}

function YahtzeeThumb({ className }: { className?: string }) {
  // Signature moment: a freshly-rolled YAHTZEE (5 of a kind). Big banner +
  // five matching dice + sparkles, with a small "+50" reminder of the score.
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Yahtzee">
      <defs>
        <linearGradient id="yz-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e1b4b" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="yz-banner" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" fill="url(#yz-bg)" />

      {/* YAHTZEE! banner */}
      <g transform="translate(20 8)">
        <rect width="100" height="20" rx="4" fill="url(#yz-banner)" stroke="#78350f" strokeWidth="0.5" />
        <text x="50" y="14" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#0a0a0a" fontFamily="system-ui">YAHTZEE!</text>
      </g>

      {/* Sparkles around the banner */}
      <text x="11"  y="20" fontSize="11">✨</text>
      <text x="123" y="20" fontSize="11">✨</text>

      {/* Five matching dice — a rolled Yahtzee. All showing 6. */}
      {[5, 32, 59, 86, 113].map((x, i) => (
        <g key={i} transform={`translate(${x} 40)`}>
          <rect width="22" height="22" rx="3" fill="#fafafa" stroke="#10b981" strokeWidth="1.4" />
          {/* Six pips in two columns */}
          {[[5.5, 5.5], [16.5, 5.5], [5.5, 11], [16.5, 11], [5.5, 16.5], [16.5, 16.5]].map(([cx, cy], j) => (
            <circle key={j} cx={cx} cy={cy} r="1.8" fill="#0a0a0a" />
          ))}
        </g>
      ))}

    </svg>
  );
}

function LiarsDiceThumb({ className }: { className?: string }) {
  // Felt table with two cups and a few rolled dice + a speech bubble: "Three 5s!"
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Liar's Dice">
      <defs>
        <radialGradient id="ld-felt" cx="0.5" cy="0.5" r="0.7">
          <stop offset="0" stopColor="#166534" />
          <stop offset="1" stopColor="#052e16" />
        </radialGradient>
        <linearGradient id="ld-cup" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#92400e" />
          <stop offset="1" stopColor="#451a03" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" fill="url(#ld-felt)" />
      {/* Left cup (tipped, dice spilling) */}
      <g transform="translate(8 50) rotate(-22)">
        <rect width="22" height="28" rx="2" fill="url(#ld-cup)" />
        <ellipse cx="11" cy="0" rx="11" ry="3" fill="#1c0a02" />
        <ellipse cx="11" cy="28" rx="11" ry="3" fill="#78350f" />
      </g>
      {/* Right cup (upright, hiding dice) */}
      <g transform="translate(112 38)">
        <rect width="20" height="36" rx="2" fill="url(#ld-cup)" />
        <ellipse cx="10" cy="0" rx="10" ry="2.6" fill="#1c0a02" />
      </g>
      {/* A handful of dice on the felt */}
      {[
        { x: 38, y: 38, pips: 5 },
        { x: 54, y: 52, pips: 2 },
        { x: 72, y: 38, pips: 5 },
        { x: 86, y: 56, pips: 1 },
        { x: 60, y: 70, pips: 5 },
      ].map((d, i) => (
        <g key={i} transform={`translate(${d.x} ${d.y})`}>
          <rect width="14" height="14" rx="2" fill="#fafafa" stroke="#a3a3a3" strokeWidth="0.4" />
          <Pips n={d.pips} />
        </g>
      ))}
      {/* Speech bubble "Three 5s!" */}
      <g>
        <rect x="40" y="6" width="50" height="18" rx="9" fill="#fafafa" />
        <polygon points="50,22 58,22 52,28" fill="#fafafa" />
        <text x="65" y="18" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#0a0a0a" fontFamily="system-ui">
          Three 5s!
        </text>
      </g>
    </svg>
  );
}

function Pips({ n }: { n: number }) {
  // 3×3 pip layout for a 14×14 die.
  const c = '#0a0a0a';
  const r = 1.2;
  const positions: Record<number, [number, number][]> = {
    1: [[7, 7]],
    2: [[4, 4], [10, 10]],
    3: [[4, 4], [7, 7], [10, 10]],
    4: [[4, 4], [10, 4], [4, 10], [10, 10]],
    5: [[4, 4], [10, 4], [7, 7], [4, 10], [10, 10]],
    6: [[4, 3.5], [10, 3.5], [4, 7], [10, 7], [4, 10.5], [10, 10.5]],
  };
  return (
    <>
      {(positions[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={c} />
      ))}
    </>
  );
}

function BoggleThumb({ className }: { className?: string }) {
  // 4×4 grid of letter dice. Highlight a word path "BIRD".
  const letters = ['B', 'A', 'C', 'D', 'I', 'R', 'L', 'M', 'S', 'T', 'E', 'O', 'N', 'F', 'G', 'H'];
  // BIRD path: indices 0 (B), 4 (I), 5 (R), 6 ... let me just pick valid neighbors:
  // B(0) → I(4) ↓, I(4) → R(5) →, R(5) → D... D is at index 3. R(5) → D(3)? not adjacent (5 and 3 same row, diff 2). Let me adjust.
  // Place B at 0, I at 5 (diag), R at 6 (right of I), D at 2 (above R). All adjacent.
  const grid = ['B', 'A', 'D', '_', '_', 'I', 'R', '_', '_', '_', '_', '_', '_', '_', '_', '_'];
  // Fill the gaps with the rest of the letters
  const fillLetters = ['A', 'C', 'L', 'M', 'S', 'T', 'E', 'O', 'N', 'F', 'G', 'H'];
  let li = 0;
  const finalGrid = grid.map(c => c === '_' ? fillLetters[li++] : c);
  const pathSet = new Set([0, 5, 6, 2]); // B, I, R, D
  void letters; // unused but kept for reference
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Boggle">
      <defs>
        <linearGradient id="bg-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c1917" />
          <stop offset="1" stopColor="#0c0a09" />
        </linearGradient>
        <linearGradient id="bg-die" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fef3c7" />
          <stop offset="1" stopColor="#fcd34d" />
        </linearGradient>
        <linearGradient id="bg-die-active" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" fill="url(#bg-bg)" />
      {/* 4×4 grid centered at 70,50 with cells 16×16 */}
      {finalGrid.map((letter, i) => {
        const r = Math.floor(i / 4);
        const c = i % 4;
        const x = 38 + c * 17;
        const y = 18 + r * 17;
        const active = pathSet.has(i);
        return (
          <g key={i}>
            <rect
              x={x} y={y} width="15" height="15" rx="2"
              fill={active ? 'url(#bg-die-active)' : 'url(#bg-die)'}
              stroke="#92400e" strokeWidth="0.5"
            />
            <text
              x={x + 7.5} y={y + 11}
              textAnchor="middle" fontSize="9" fontWeight="bold"
              fill={active ? '#052e16' : '#451a03'}
            >
              {letter}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function BattleshipThumb({ className }: { className?: string }) {
  // Single top-down ocean view with two ships visible — one taking a direct
  // hit (💥), the other being targeted by a crosshair. Splashes mark previous
  // misses. The "DIRECT HIT!" pill captures the game's signature moment.
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Battleship">
      <defs>
        <linearGradient id="bs-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c4a6e" />
          <stop offset="1" stopColor="#082f49" />
        </linearGradient>
        <linearGradient id="bs-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9ca3af" />
          <stop offset="1" stopColor="#4b5563" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" fill="url(#bs-sea)" />

      {/* Faint grid (10 cols × 7 rows) for the "battle map" feel */}
      {Array.from({ length: 11 }).map((_, i) => (
        <line key={`v${i}`} x1={i * 14} y1="0" x2={i * 14} y2="100" stroke="#0ea5e9" strokeWidth="0.3" opacity="0.25" />
      ))}
      {Array.from({ length: 8 }).map((_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 14} x2="140" y2={i * 14} stroke="#0ea5e9" strokeWidth="0.3" opacity="0.25" />
      ))}

      {/* Carrier (5-cell) — taking the hit. Stadium-shaped hull with rivet line. */}
      <g transform="translate(18 20)">
        <rect x="0" y="0" width="60" height="11" rx="5.5" fill="url(#bs-hull)" stroke="#0a0a0a" strokeWidth="0.5" />
        <line x1="2" y1="5.5" x2="58" y2="5.5" stroke="#1f2937" strokeWidth="0.4" />
        {/* Bridge + smokestack */}
        <rect x="22" y="2" width="10" height="7" rx="1" fill="#d1d5db" stroke="#0a0a0a" strokeWidth="0.3" />
        <circle cx="38" cy="5.5" r="1.8" fill="#1f2937" />
      </g>

      {/* Destroyer (2-cell) further south */}
      <g transform="translate(86 60) rotate(20)">
        <rect x="0" y="0" width="34" height="9" rx="4.5" fill="url(#bs-hull)" stroke="#0a0a0a" strokeWidth="0.5" />
        <line x1="2" y1="4.5" x2="32" y2="4.5" stroke="#1f2937" strokeWidth="0.4" />
        <rect x="12" y="1.6" width="8" height="6" rx="1" fill="#d1d5db" stroke="#0a0a0a" strokeWidth="0.3" />
      </g>

      {/* Miss splashes (small white rings) — failed shots in the open water */}
      {[
        { x: 12, y: 70 },
        { x: 100, y: 22 },
        { x: 130, y: 50 },
        { x: 50, y: 85 },
      ].map((s, i) => (
        <g key={i}>
          <circle cx={s.x} cy={s.y} r="2.5" fill="none" stroke="#fafafa" strokeWidth="1" opacity="0.85" />
          <circle cx={s.x} cy={s.y} r="0.8" fill="#fafafa" opacity="0.9" />
        </g>
      ))}

      {/* 💥 explosion on the carrier */}
      <text x="50" y="32" textAnchor="middle" fontSize="22">💥</text>

      {/* Crosshair locked on the destroyer */}
      <g transform="translate(105 66)" stroke="#34d399" strokeWidth="1.2" fill="none">
        <circle cx="0" cy="0" r="9" />
        <line x1="-13" y1="0" x2="-3" y2="0" />
        <line x1="3" y1="0" x2="13" y2="0" />
        <line x1="0" y1="-13" x2="0" y2="-3" />
        <line x1="0" y1="3" x2="0" y2="13" />
      </g>

    </svg>
  );
}

function CheckersThumb({ className }: { className?: string }) {
  // 4×4 corner of an 8×8 board with a few pieces
  const dark = '#7c2d12';
  const light = '#fef3c7';
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Checkers">
      <defs>
        <linearGradient id="ck-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c1917" />
          <stop offset="1" stopColor="#0c0a09" />
        </linearGradient>
        <radialGradient id="ck-red" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#fca5a5" />
          <stop offset="1" stopColor="#b91c1c" />
        </radialGradient>
        <radialGradient id="ck-black" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#525252" />
          <stop offset="1" stopColor="#0a0a0a" />
        </radialGradient>
      </defs>
      <rect width="140" height="100" fill="url(#ck-bg)" />
      {/* 8×8 board centered at (70, 50) with cells 11px */}
      {Array.from({ length: 8 }).map((_, r) =>
        Array.from({ length: 8 }).map((__, c) => {
          const isDark = (r + c) % 2 === 1;
          return (
            <rect
              key={`${r}-${c}`}
              x={26 + c * 11}
              y={6 + r * 11}
              width="11" height="11"
              fill={isDark ? dark : light}
            />
          );
        })
      )}
      {/* Pieces (only on dark squares) */}
      {[
        // Black pieces top three rows (selected)
        { r: 0, c: 1, color: 'B' }, { r: 0, c: 3, color: 'B' }, { r: 0, c: 7, color: 'B' },
        { r: 1, c: 0, color: 'B' }, { r: 1, c: 4, color: 'B' }, { r: 1, c: 6, color: 'B' },
        { r: 2, c: 3, color: 'B' },
        // Red pieces bottom three rows (selected)
        { r: 5, c: 4, color: 'R' },
        { r: 6, c: 1, color: 'R' }, { r: 6, c: 5, color: 'R' }, { r: 6, c: 7, color: 'R' },
        { r: 7, c: 0, color: 'R' }, { r: 7, c: 2, color: 'R' }, { r: 7, c: 6, color: 'R' },
      ].map((p, i) => (
        <circle
          key={i}
          cx={26 + p.c * 11 + 5.5}
          cy={6 + p.r * 11 + 5.5}
          r="3.8"
          fill={p.color === 'R' ? 'url(#ck-red)' : 'url(#ck-black)'}
          stroke="#0a0a0a"
          strokeWidth="0.3"
        />
      ))}
    </svg>
  );
}

function TicTacToeThumb({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Tic-Tac-Toe">
      <defs>
        <linearGradient id="ttt-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="ttt-win" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0"  stopColor="#34d399" stopOpacity="0" />
          <stop offset="0.5" stopColor="#34d399" stopOpacity="0.9" />
          <stop offset="1"  stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" fill="url(#ttt-bg)" />
      {/* grid (centered, 60x60) */}
      <g transform="translate(40 20)" stroke="#475569" strokeWidth="2" strokeLinecap="round">
        <line x1="20" y1="2"  x2="20" y2="58" />
        <line x1="40" y1="2"  x2="40" y2="58" />
        <line x1="2"  y1="20" x2="58" y2="20" />
        <line x1="2"  y1="40" x2="58" y2="40" />
      </g>
      {/* winning diagonal glow */}
      <line x1="44" y1="24" x2="94" y2="74" stroke="url(#ttt-win)" strokeWidth="10" strokeLinecap="round" />
      {/* X top-left */}
      <g transform="translate(46 26)" stroke="#34d399" strokeWidth="3" strokeLinecap="round" fill="none">
        <line x1="0" y1="0"  x2="10" y2="10" />
        <line x1="10" y1="0" x2="0" y2="10" />
      </g>
      {/* X center */}
      <g transform="translate(66 46)" stroke="#34d399" strokeWidth="3" strokeLinecap="round" fill="none">
        <line x1="0" y1="0"  x2="10" y2="10" />
        <line x1="10" y1="0" x2="0" y2="10" />
      </g>
      {/* X bottom-right */}
      <g transform="translate(86 66)" stroke="#34d399" strokeWidth="3" strokeLinecap="round" fill="none">
        <line x1="0" y1="0"  x2="10" y2="10" />
        <line x1="10" y1="0" x2="0" y2="10" />
      </g>
      {/* O top-right */}
      <circle cx="91" cy="31" r="6" fill="none" stroke="#38bdf8" strokeWidth="3" />
      {/* O bottom-left */}
      <circle cx="51" cy="71" r="6" fill="none" stroke="#38bdf8" strokeWidth="3" />
    </svg>
  );
}

function ConnectFourThumb({ className }: { className?: string }) {
  // Realistic mid-game position, with a vertical win highlighted
  const R = 'R', Y = 'Y', _ = null;
  type C = 'R' | 'Y' | null;
  const board: C[][] = [
    [_, _, _, _, _, _, _],
    [_, _, _, _, _, _, _],
    [_, _, _, R, _, _, _],
    [_, _, Y, R, Y, _, _],
    [_, Y, R, R, Y, _, _],
    [_, Y, R, R, R, Y, _],
  ];
  const winning = new Set(['2-3','3-3','4-3','5-3']); // Red vertical 4-in-a-row in col 3

  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Connect Four">
      <defs>
        <linearGradient id="c4-board" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <radialGradient id="c4-hole" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#020617" />
          <stop offset="1" stopColor="#0f172a" />
        </radialGradient>
        <radialGradient id="c4-red" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#fca5a5" />
          <stop offset="1" stopColor="#dc2626" />
        </radialGradient>
        <radialGradient id="c4-yellow" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#fef08a" />
          <stop offset="1" stopColor="#eab308" />
        </radialGradient>
      </defs>
      <rect width="140" height="100" fill="#0a0c12" />
      <rect x="14" y="8" width="112" height="84" rx="8" fill="url(#c4-board)" />
      {board.map((row, r) =>
        row.map((cell, c) => {
          const cx = 22 + c * 16;
          const cy = 16 + r * 13;
          const isWin = winning.has(`${r}-${c}`);
          return (
            <g key={`${r}-${c}`}>
              <circle cx={cx} cy={cy} r="6" fill="url(#c4-hole)" />
              {cell && (
                <circle
                  cx={cx} cy={cy} r="5.2"
                  fill={cell === 'R' ? 'url(#c4-red)' : 'url(#c4-yellow)'}
                  stroke={isWin ? '#34d399' : 'none'}
                  strokeWidth={isWin ? 1.2 : 0}
                />
              )}
            </g>
          );
        })
      )}
    </svg>
  );
}

function LongShotThumb({ className }: { className?: string }) {
  // Horses galloping along the bottom of the brown track ring, crossing a
  // VERTICAL checkered finish post placed perpendicular to the running
  // direction (like a real racetrack). Horse numbers + colors match the
  // canonical HORSE_COLORS from the actual game engine:
  //   1 red · 2 yellow · 3 navy · 4 lt-purple · 5 green · 6 lt-blue · 7 orange · 8 dk-purple
  // Dice in the top-right mirror the game's: green d6 (movement) + yellow d8 diamond.
  //
  // Horses on the TOP of the brown ring, following the oval curve — slightly
  // higher y at the corners (where the oval narrows down) and lower y at the
  // center (where the oval is tallest), so they look like they're running
  // around the bend rather than standing in a flat line. Counter-clockwise
  // direction = right→left at the top, matches the default 🐎 emoji facing.
  const horses = [
    { x: 32,  y: 44, num: 3, size: 18, color: '#1e3a8a' },
    { x: 58,  y: 40, num: 6, size: 22, color: '#38bdf8' },
    { x: 80,  y: 38, num: 1, size: 24, color: '#dc2626' },
    { x: 102, y: 40, num: 5, size: 22, color: '#22c55e' },
    { x: 122, y: 47, num: 7, size: 18, color: '#f97316' },
  ];
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Long Shot">
      <defs>
        <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e3a8a" />
          <stop offset="1" stopColor="#0c4a6e" />
        </linearGradient>
        <linearGradient id="ls-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a16207" />
          <stop offset="1" stopColor="#78350f" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" fill="url(#ls-sky)" />
      {/* Oval track + grass infield. Infield is flatter/shorter than before
          so there's more brown showing at the top — gives the horses room to
          run on the ring without dipping into the green field. */}
      <ellipse cx="70" cy="58" rx="62" ry="30" fill="url(#ls-turf)" />
      <ellipse cx="70" cy="58" rx="38" ry="9" fill="#166534" />

      {/* Vertical checkered finish-line post — perpendicular to running
          direction, sits dead-center at the bottom of the track ring. */}
      <g transform="translate(74 67)">
        {Array.from({ length: 8 }).map((_, row) => (
          <g key={row} transform={`translate(0 ${row * 2.2})`}>
            <rect x="0"   y="0"   width="2.5" height="1.1" fill={row % 2 === 0 ? '#fff' : '#0a0a0a'} />
            <rect x="2.5" y="0"   width="2.5" height="1.1" fill={row % 2 === 0 ? '#0a0a0a' : '#fff'} />
            <rect x="0"   y="1.1" width="2.5" height="1.1" fill={row % 2 === 0 ? '#0a0a0a' : '#fff'} />
            <rect x="2.5" y="1.1" width="2.5" height="1.1" fill={row % 2 === 0 ? '#fff' : '#0a0a0a'} />
          </g>
        ))}
      </g>

      {/* Pack of horses on the top straight of the track. Horse emoji 🐎
          faces left by default — matches counter-clockwise direction at the
          top. The colored saddlecloth is drawn as a rounded shape that's
          *wider at the bottom* (like cloth draping down the sides of the
          horse) and slightly tilted to suggest motion. */}
      {/* 🐎 emoji as the horse silhouette (much more polished than a hand-
          drawn SVG could be at this size). The saddlecloth is a small,
          subtle overlay anchored well into the horse's body so it reads as
          "painted on the horse" rather than floating above. */}
      {horses.map((h, i) => {
        // The 🐎 glyph renders ABOVE the baseline. -0.40 sits on the upper
        // body where the saddle would be. Shape is a trapezoid: narrow top
        // edge (sits on the spine), wider flared bottom (cloth draping down
        // both flanks). Slightly rounded corners.
        const cy = -h.size * 0.40;
        const wTop = h.size * 0.34;
        const wBot = h.size * 0.50;
        const ht   = h.size * 0.22;
        const fs   = Math.max(5, h.size * 0.18);
        const topY = cy - ht / 2;
        const botY = cy + ht / 2;
        return (
          <g key={i} transform={`translate(${h.x} ${h.y})`}>
            <text x="0" y="0" textAnchor="middle" fontSize={h.size}>🐎</text>
            {/* Flared saddlecloth — narrow top, wider bottom, soft corners */}
            <path
              d={`M ${-wTop / 2 + 0.4},${topY}
                  Q ${-wTop / 2},${topY} ${-wTop / 2 - 0.2},${topY + 0.8}
                  L ${-wBot / 2 + 0.4},${botY - 0.6}
                  Q ${-wBot / 2},${botY} ${-wBot / 2 + 0.9},${botY}
                  L ${wBot / 2 - 0.9},${botY}
                  Q ${wBot / 2},${botY} ${wBot / 2 - 0.4},${botY - 0.6}
                  L ${wTop / 2 + 0.2},${topY + 0.8}
                  Q ${wTop / 2},${topY} ${wTop / 2 - 0.4},${topY}
                  Z`}
              fill={h.color}
              stroke="#0a0a0a"
              strokeWidth="0.4"
            />
            {/* Subtle white sheen along the top edge for the curved-cloth feel */}
            <path
              d={`M ${-wTop / 2 + 0.6},${topY + 0.4}
                  Q 0,${topY - 0.2} ${wTop / 2 - 0.6},${topY + 0.4}`}
              fill="none"
              stroke="#fff"
              strokeWidth="0.35"
              opacity="0.45"
            />
            <text
              x="0" y={cy + fs * 0.36}
              textAnchor="middle"
              fontSize={fs}
              fontWeight="bold"
              fill="#fff"
              fontFamily="system-ui"
            >
              {h.num}
            </text>
          </g>
        );
      })}

      {/* Movement die (green d6) showing 2 */}
      <g transform="translate(106 8)">
        <rect width="13" height="13" rx="2" fill="#22c55e" stroke="#14532d" strokeWidth="0.4" />
        <circle cx="3.5" cy="3.5" r="1.2" fill="#0a0a0a" />
        <circle cx="9.5" cy="9.5" r="1.2" fill="#0a0a0a" />
      </g>
      {/* Horse-selector die (yellow d8 — drawn as a diamond) showing 2 */}
      <g transform="translate(121 8)">
        <polygon points="7,0 14,7 7,14 0,7" fill="#fbbf24" stroke="#92400e" strokeWidth="0.5" />
        <text x="7" y="9.5" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#0a0a0a" fontFamily="system-ui">2</text>
      </g>
    </svg>
  );
}

function PlaceholderThumb({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 100" className={className}>
      <rect width="140" height="100" fill="#1e293b" />
      <text x="70" y="58" textAnchor="middle" fill="#64748b" fontSize="14" fontFamily="system-ui">
        ?
      </text>
    </svg>
  );
}
