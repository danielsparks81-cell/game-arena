// Inline SVG thumbnails for each game — no external assets, scales perfectly.

export function GameThumbnail({ gameId, className }: { gameId: string; className?: string }) {
  if (gameId === 'tictactoe') return <TicTacToeThumb className={className} />;
  if (gameId === 'connect4')  return <ConnectFourThumb className={className} />;
  if (gameId === 'longshot')  return <LongShotThumb className={className} />;
  if (gameId === 'checkers')  return <CheckersThumb className={className} />;
  if (gameId === 'battleship') return <BattleshipThumb className={className} />;
  return <PlaceholderThumb className={className} />;
}

function BattleshipThumb({ className }: { className?: string }) {
  // Ocean-blue grid with a couple of ships, hit and miss markers
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Battleship">
      <defs>
        <linearGradient id="bs-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c4a6e" />
          <stop offset="1" stopColor="#082f49" />
        </linearGradient>
        <linearGradient id="bs-ship" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9ca3af" />
          <stop offset="1" stopColor="#4b5563" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" rx="10" fill="#020617" />
      {/* Two boards side by side */}
      {[18, 80].map((ox, boardIdx) => (
        <g key={ox}>
          <rect x={ox} y={10} width="42" height="80" rx="3" fill="url(#bs-sea)" />
          {/* Grid lines (6×10 small) */}
          {Array.from({ length: 7 }).map((_, i) => (
            <line
              key={`v-${boardIdx}-${i}`}
              x1={ox + i * 7} y1={10}
              x2={ox + i * 7} y2={90}
              stroke="#0ea5e9" strokeWidth="0.3" opacity="0.4"
            />
          ))}
          {Array.from({ length: 11 }).map((_, i) => (
            <line
              key={`h-${boardIdx}-${i}`}
              x1={ox} y1={10 + i * 8}
              x2={ox + 42} y2={10 + i * 8}
              stroke="#0ea5e9" strokeWidth="0.3" opacity="0.4"
            />
          ))}
        </g>
      ))}
      {/* Left board: own fleet — show ships + a few opponent shots */}
      <rect x={18 + 1*7 + 1} y={10 + 2*8 + 1} width={3*7 - 2} height={8 - 2} rx="2" fill="url(#bs-ship)" />
      <rect x={18 + 4*7 + 1} y={10 + 4*8 + 1} width={7 - 2} height={4*8 - 2} rx="2" fill="url(#bs-ship)" />
      <circle cx={18 + 2*7 + 3.5} cy={10 + 2*8 + 4} r="1.2" fill="#dc2626" />
      <circle cx={18 + 0*7 + 3.5} cy={10 + 5*8 + 4} r="1.2" fill="#fafafa" />
      {/* Right board: opponent — only show hits and misses */}
      <circle cx={80 + 3*7 + 3.5} cy={10 + 1*8 + 4} r="1.2" fill="#fafafa" />
      <circle cx={80 + 1*7 + 3.5} cy={10 + 3*8 + 4} r="1.2" fill="#dc2626" />
      <circle cx={80 + 2*7 + 3.5} cy={10 + 3*8 + 4} r="1.2" fill="#dc2626" />
      <circle cx={80 + 5*7 + 3.5} cy={10 + 5*8 + 4} r="1.2" fill="#fafafa" />
      <circle cx={80 + 4*7 + 3.5} cy={10 + 6*8 + 4} r="1.2" fill="#dc2626" />
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
      <rect width="140" height="100" rx="10" fill="url(#ck-bg)" />
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
      <rect width="140" height="100" rx="10" fill="url(#ttt-bg)" />
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
    [_, Y, R, Y, R, Y, _],
  ];
  const winning = new Set(['2-3','3-3','4-3','5-3']); // Red vertical in col 3

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
      <rect width="140" height="100" rx="10" fill="#0a0c12" />
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
  // Oval racetrack with 4 colored "horses" mid-race
  return (
    <svg viewBox="0 0 140 100" className={className} role="img" aria-label="Long Shot">
      <defs>
        <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c4a6e" />
          <stop offset="1" stopColor="#082f49" />
        </linearGradient>
        <linearGradient id="ls-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a16207" />
          <stop offset="1" stopColor="#78350f" />
        </linearGradient>
      </defs>
      <rect width="140" height="100" rx="10" fill="url(#ls-sky)" />
      {/* Outer track (oval) */}
      <ellipse cx="70" cy="55" rx="60" ry="32" fill="url(#ls-turf)" />
      {/* Inner field (grass) */}
      <ellipse cx="70" cy="55" rx="34" ry="14" fill="#166534" />
      {/* Finish line */}
      <line x1="10" y1="55" x2="36" y2="55" stroke="#fff" strokeWidth="1.5" strokeDasharray="2 1.5" />
      {/* Horses around the track (small colored arcs) */}
      <g>
        <circle cx="46" cy="33" r="3" fill="#dc2626" />
        <circle cx="72" cy="25" r="3" fill="#2563eb" />
        <circle cx="100" cy="36" r="3" fill="#eab308" />
        <circle cx="114" cy="62" r="3" fill="#22c55e" />
        <circle cx="92" cy="80" r="3" fill="#a855f7" />
      </g>
      {/* Dice */}
      <g transform="translate(112 10)">
        <rect width="14" height="14" rx="2" fill="#fafafa" />
        <circle cx="4" cy="4"  r="1.4" fill="#0a0a0a" />
        <circle cx="10" cy="4" r="1.4" fill="#0a0a0a" />
        <circle cx="4" cy="10" r="1.4" fill="#0a0a0a" />
        <circle cx="10" cy="10" r="1.4" fill="#0a0a0a" />
      </g>
      <g transform="translate(96 10)">
        <rect width="14" height="14" rx="2" fill="#fbbf24" />
        <text x="7" y="11" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#0a0a0a" fontFamily="system-ui">5</text>
      </g>
    </svg>
  );
}

function PlaceholderThumb({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 100" className={className}>
      <rect width="140" height="100" rx="10" fill="#1e293b" />
      <text x="70" y="58" textAnchor="middle" fill="#64748b" fontSize="14" fontFamily="system-ui">
        ?
      </text>
    </svg>
  );
}
