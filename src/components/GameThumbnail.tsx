// Inline SVG thumbnails for each game — no external assets, scales perfectly.

export function GameThumbnail({ gameId, className }: { gameId: string; className?: string }) {
  if (gameId === 'tictactoe') return <TicTacToeThumb className={className} />;
  if (gameId === 'connect4')  return <ConnectFourThumb className={className} />;
  return <PlaceholderThumb className={className} />;
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
