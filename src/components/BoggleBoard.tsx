'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  BOARD_SIZE, MIN_WORD_LEN, pointsFor, msRemaining,
  type BoggleState,
} from '@/lib/games/boggle';

export default function BoggleBoard({
  state, currentUserId, isHost, disabled, onSubmitWord, onStart, onFinalize,
}: {
  state: BoggleState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onSubmitWord: (word: string) => Promise<{ ok: true; word: string } | { ok: false; error: string }>;
  onStart: () => void;
  onFinalize: () => Promise<void>;
}) {
  const me = state.players.find(p => p.playerId === currentUserId);
  const myWords = me?.words ?? [];

  // Live countdown — tick every 250ms
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const remaining = msRemaining(state, now);

  // When the timer hits 0 client-side and we're still in 'playing', call finalize
  const finalizedRef = useRef(false);
  useEffect(() => {
    if (state.phase === 'playing' && remaining <= 0 && !finalizedRef.current) {
      finalizedRef.current = true;
      onFinalize().catch(() => {});
    }
    if (state.phase !== 'playing') finalizedRef.current = false;
  }, [state.phase, remaining, onFinalize]);

  // ---------- Lobby ----------
  if (state.phase === 'lobby') {
    const playerCount = state.players.length;
    const canStart = isHost && playerCount >= 2;
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <p className="font-medium">Waiting for the host to start the round.</p>
          <p className="mt-1 text-xs text-neutral-400">
            Players seated: <span className="text-emerald-400">{playerCount}</span> — need at least 2.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {state.players.map(p => (
              <li key={p.playerId} className="text-neutral-300">• {p.username}</li>
            ))}
          </ul>
          <div className="mt-3">
            {canStart ? (
              <button
                onClick={onStart}
                disabled={disabled}
                className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Start round ({playerCount} {playerCount === 1 ? 'player' : 'players'})
              </button>
            ) : isHost ? (
              <span className="text-sm text-neutral-500">Need at least 2 seated players to start.</span>
            ) : (
              <span className="text-sm text-neutral-500">Waiting for the host to start…</span>
            )}
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          Each round is <strong>3 minutes</strong>. Find words by chaining adjacent letters (h/v/diag);
          no die may be re-used in a single word. Minimum {MIN_WORD_LEN} letters.
        </p>
      </div>
    );
  }

  // ---------- Finished ----------
  if (state.phase === 'finished') {
    return <ScoringPanel state={state} me={me?.playerId ?? null} />;
  }

  // ---------- Playing ----------
  return (
    <div className="space-y-3">
      <TimerBar remaining={remaining} duration={state.duration} />
      <TraceBoard
        board={state.board}
        alreadyFound={myWords}
        onSubmitWord={onSubmitWord}
      />
      <FoundList words={myWords} />
    </div>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

function TimerBar({ remaining, duration }: { remaining: number; duration: number }) {
  const pct = Math.max(0, Math.min(100, (remaining / duration) * 100));
  const seconds = Math.ceil(remaining / 1000);
  const mm = Math.floor(seconds / 60).toString().padStart(1, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  const warning = remaining < 30_000;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium">⏱ {mm}:{ss}</span>
        <span className={warning ? 'text-rose-400 font-semibold' : 'text-neutral-400'}>
          {warning ? 'Hurry!' : 'remaining'}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full transition-[width] duration-200 ease-linear ${warning ? 'bg-rose-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Static read-only board (used in lobby preview / scoring panel).
 */
function BoardGrid({ board, highlightPath }: { board: string[]; highlightPath?: number[] }) {
  return (
    <div
      className="mx-auto inline-grid overflow-hidden rounded-xl border-2 border-amber-800 bg-amber-950/40 p-2 shadow-lg"
      style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`, width: 'min(100%, 360px)', gap: '6px' }}
    >
      {board.map((letter, i) => {
        const active = highlightPath?.includes(i);
        const pathPos = highlightPath?.indexOf(i);
        return (
          <div
            key={i}
            className={`relative flex aspect-square items-center justify-center rounded-md text-xl font-bold ${
              active ? 'bg-emerald-500 text-neutral-950 shadow-md' : 'bg-amber-100 text-amber-900 shadow'
            }`}
          >
            {letter}
            {active && pathPos !== undefined && (
              <span className="absolute right-0.5 top-0.5 rounded bg-emerald-900/70 px-1 text-[9px] font-bold text-white">
                {pathPos + 1}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** True if two board indices are adjacent (h/v/diag) on the 4×4 grid. */
function isAdjacent(a: number, b: number): boolean {
  if (a === b) return false;
  const ar = Math.floor(a / BOARD_SIZE), ac = a % BOARD_SIZE;
  const br = Math.floor(b / BOARD_SIZE), bc = b % BOARD_SIZE;
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc)) === 1;
}

/**
 * Interactive board — drag to trace a word. Press anywhere on a letter to start,
 * drag (mouse or touch) over adjacent letters to extend, release to submit.
 * Works on desktop (mouse) and mobile (touch) via Pointer Events.
 */
function TraceBoard({
  board, alreadyFound, onSubmitWord,
}: {
  board: string[];
  alreadyFound: string[];
  onSubmitWord: (word: string) => Promise<{ ok: true; word: string } | { ok: false; error: string }>;
}) {
  const [path, setPath] = useState<number[]>([]);
  const [tracing, setTracing] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const boardRef = useRef<HTMLDivElement>(null);

  const currentWord = path.map(i => board[i]).join('');

  // Find which cell a screen point falls into. Uses elementFromPoint and our data-cell-idx attr.
  const cellAtPoint = useCallback((x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = (el as Element).closest('[data-cell-idx]');
    if (!cell) return null;
    const idx = (cell as HTMLElement).dataset.cellIdx;
    return idx !== undefined ? Number(idx) : null;
  }, []);

  // Extend (or backtrack) the path with a newly-entered cell.
  const tryExtend = useCallback((idx: number) => {
    setPath(prev => {
      if (prev.length === 0) return [idx];
      const last = prev[prev.length - 1];
      if (idx === last) return prev;
      // Backtrack — entering the previous cell pops the last segment
      if (prev.length >= 2 && idx === prev[prev.length - 2]) {
        return prev.slice(0, -1);
      }
      if (prev.includes(idx)) return prev;
      if (!isAdjacent(last, idx)) return prev;
      return [...prev, idx];
    });
  }, []);

  // ---- Pointer handlers ----
  const onPointerDown = (e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    setTracing(true);
    setPath([idx]);
    setFeedback(null);
    // Capture the pointer so we keep getting move events even if the finger leaves the cell
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!tracing) return;
    const idx = cellAtPoint(e.clientX, e.clientY);
    if (idx === null) return;
    tryExtend(idx);
  };

  const finalize = useCallback(() => {
    if (!tracing) return;
    setTracing(false);
    const word = path.map(i => board[i]).join('').toUpperCase();
    const clear = () => setPath([]);

    if (word.length < MIN_WORD_LEN) {
      setFeedback({ kind: 'err', msg: `Word too short (${word.length}/${MIN_WORD_LEN})` });
      clear();
      return;
    }
    if (alreadyFound.includes(word)) {
      setFeedback({ kind: 'err', msg: 'Already found' });
      clear();
      return;
    }
    startTransition(async () => {
      const res = await onSubmitWord(word);
      if (res.ok) {
        setFeedback({ kind: 'ok', msg: `+${pointsFor(res.word)} ${res.word}` });
      } else {
        setFeedback({ kind: 'err', msg: res.error });
      }
      clear();
    });
  }, [tracing, path, board, alreadyFound, onSubmitWord]);

  // Listen for pointer-up anywhere — releasing outside the board still submits.
  useEffect(() => {
    if (!tracing) return;
    const up = () => finalize();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [tracing, finalize]);

  return (
    <div className="space-y-3">
      {/* Current-word banner — shows what's being traced + recent submit feedback */}
      <div className="flex items-baseline justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
        <span className="text-neutral-500">
          {tracing
            ? <>Tracing: <span className="font-mono font-bold text-emerald-300">{currentWord || '—'}</span></>
            : 'Press a letter and drag to spell a word. Release to submit.'}
        </span>
        {feedback && (
          <span className={feedback.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}>
            {feedback.msg}
          </span>
        )}
      </div>

      {/* Interactive board */}
      <div
        ref={boardRef}
        onPointerMove={onPointerMove}
        className="mx-auto inline-grid select-none overflow-hidden rounded-xl border-2 border-amber-800 bg-amber-950/40 p-2 shadow-lg"
        style={{
          gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
          width: 'min(100%, 380px)',
          gap: '6px',
          touchAction: 'none',
        }}
      >
        {board.map((letter, i) => {
          const active = path.includes(i);
          const pathPos = path.indexOf(i);
          const isLast = path[path.length - 1] === i;
          return (
            <div
              key={i}
              data-cell-idx={i}
              onPointerDown={(e) => onPointerDown(e, i)}
              className={`relative flex aspect-square cursor-pointer items-center justify-center rounded-md text-xl font-bold transition select-none ${
                active
                  ? isLast
                    ? 'bg-emerald-400 text-neutral-950 shadow-lg ring-2 ring-emerald-200'
                    : 'bg-emerald-500 text-neutral-950 shadow-md'
                  : 'bg-amber-100 text-amber-900 shadow hover:bg-amber-200'
              } ${pending ? 'opacity-50' : ''}`}
            >
              {letter}
              {active && (
                <span className="absolute right-0.5 top-0.5 rounded bg-emerald-900/70 px-1 text-[9px] font-bold text-white">
                  {pathPos + 1}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FoundList({ words }: { words: string[] }) {
  const sortedByLen = [...words].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const totalPotential = words.reduce((acc, w) => acc + pointsFor(w), 0);
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-1 flex items-baseline justify-between text-xs uppercase tracking-wider text-neutral-500">
        <span>Your words ({words.length})</span>
        <span>{totalPotential} max pts (before duplicates)</span>
      </div>
      {words.length === 0 ? (
        <p className="text-xs text-neutral-600">No words yet. Type one above to get started.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {sortedByLen.map(w => (
            <li key={w} className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs">
              {w} <span className="text-neutral-500">·{pointsFor(w)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScoringPanel({ state, me }: { state: BoggleState; me: string | null }) {
  const results = state.results ?? [];
  const ranked = [...results].sort((a, b) => b.total - a.total);
  const medals = ['🥇', '🥈', '🥉'];
  const winner = ranked[0];
  return (
    <div className="space-y-3">
      <BoardGrid board={state.board} />
      <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/5 p-4">
        <div className="mb-3 text-center">
          <h2 className="text-xl font-bold text-amber-400">🏁 Time&apos;s up!</h2>
          {winner && (
            <p className="text-sm text-neutral-300">
              Winner: <span className="font-semibold text-amber-300">{winner.username}</span>{' '}
              <span className="font-mono">({winner.total} pts)</span>
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ranked.map((r, idx) => (
            <div
              key={r.playerId}
              className={`rounded-md border p-3 text-sm ${
                r.playerId === me
                  ? 'border-emerald-500/50 bg-emerald-500/5'
                  : 'border-neutral-800 bg-neutral-900'
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-medium">
                  <span className="mr-1">{medals[idx] ?? ''}</span>{r.username}
                </span>
                <span className="font-mono text-lg font-bold text-amber-400">{r.total}</span>
              </div>
              {r.breakdown.length === 0 ? (
                <p className="text-xs text-neutral-500">No words submitted.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {[...r.breakdown].sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word)).map(b => (
                    <li
                      key={b.word}
                      className={`rounded px-2 py-0.5 font-mono text-xs ${
                        b.duplicate
                          ? 'bg-neutral-800 text-neutral-500 line-through'
                          : 'bg-emerald-500/10 text-emerald-300'
                      }`}
                      title={b.duplicate ? 'Cancelled — another player also found it' : `+${b.points}`}
                    >
                      {b.word} <span className="text-neutral-500">·{b.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] italic text-neutral-500">
          Words found by more than one player are crossed out (cancel each other out).
        </p>
      </div>
    </div>
  );
}
