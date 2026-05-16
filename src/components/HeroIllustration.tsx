// Decorative hero illustration: floating game pieces over a soft gradient.

export default function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 280" className={className} role="img" aria-label="Game pieces">
      <defs>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#10b981" stopOpacity="0.25" />
          <stop offset="1" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="board" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <radialGradient id="red" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#fca5a5" />
          <stop offset="1" stopColor="#dc2626" />
        </radialGradient>
        <radialGradient id="yellow" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0" stopColor="#fef08a" />
          <stop offset="1" stopColor="#eab308" />
        </radialGradient>
        <filter id="drop" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* Soft glow background */}
      <circle cx="200" cy="140" r="180" fill="url(#glow)" />

      {/* Tic-tac-toe board (rotated, back) */}
      <g transform="translate(60 60) rotate(-12)" filter="url(#drop)">
        <rect width="130" height="130" rx="14" fill="#0f172a" stroke="#1e293b" strokeWidth="2" />
        <g stroke="#475569" strokeWidth="2.5" strokeLinecap="round">
          <line x1="44"  y1="14"  x2="44"  y2="116" />
          <line x1="86"  y1="14"  x2="86"  y2="116" />
          <line x1="14"  y1="44"  x2="116" y2="44" />
          <line x1="14"  y1="86"  x2="116" y2="86" />
        </g>
        {/* X X X diagonal */}
        <g stroke="#34d399" strokeWidth="4" strokeLinecap="round" fill="none">
          <line x1="22"  y1="22"  x2="36"  y2="36" /><line x1="36"  y1="22"  x2="22"  y2="36" />
          <line x1="58"  y1="58"  x2="78"  y2="78" /><line x1="78"  y1="58"  x2="58"  y2="78" />
          <line x1="100" y1="100" x2="114" y2="114" /><line x1="114" y1="100" x2="100" y2="114" />
        </g>
        {/* Two O's */}
        <circle cx="100" cy="29" r="11" fill="none" stroke="#38bdf8" strokeWidth="3.5" />
        <circle cx="29"  cy="100" r="11" fill="none" stroke="#38bdf8" strokeWidth="3.5" />
        {/* Winning glow */}
        <line x1="22" y1="22" x2="114" y2="114" stroke="#34d399" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      </g>

      {/* Connect Four board (rotated, front) */}
      <g transform="translate(195 75) rotate(8)" filter="url(#drop)">
        <rect width="180" height="155" rx="14" fill="url(#board)" />
        {[0,1,2,3].map(r =>
          [0,1,2,3,4,5,6].map(c => {
            const cx = 18 + c * 24;
            const cy = 22 + r * 28;
            return <circle key={`h-${r}-${c}`} cx={cx} cy={cy} r="9" fill="#0a0e1a" />;
          })
        )}
        {/* Some pieces */}
        <circle cx="42"  cy="106" r="9" fill="url(#red)" />
        <circle cx="66"  cy="106" r="9" fill="url(#yellow)" />
        <circle cx="66"  cy="78"  r="9" fill="url(#red)" />
        <circle cx="90"  cy="106" r="9" fill="url(#yellow)" />
        <circle cx="90"  cy="78"  r="9" fill="url(#red)" />
        <circle cx="90"  cy="50"  r="9" fill="url(#yellow)" />
        <circle cx="114" cy="106" r="9" fill="url(#red)" />
        <circle cx="114" cy="78"  r="9" fill="url(#yellow)" />
        <circle cx="138" cy="106" r="9" fill="url(#red)" />
      </g>
    </svg>
  );
}
