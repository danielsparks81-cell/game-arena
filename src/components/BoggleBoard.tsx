'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  BOARD_SIZE, MIN_WORD_LEN, pointsFor, msRemaining,
  GAME_MODE_LABELS, aggregateTotals,
  type BoggleState, type BoggleGameMode,
} from '@/lib/games/boggle';
import { safeAccent } from '@/lib/accentColors';
import { sounds, unlockAudio } from '@/lib/sounds';

export default function BoggleBoard({
  state, currentUserId, isHost, disabled, onSubmitWord, onStart, onSetMode, onNextRound, onFinalize,
}: {
  state: BoggleState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onSubmitWord: (word: string) => Promise<{ ok: true; word: string } | { ok: false; error: string }>;
  onStart: () => void;
  onSetMode: (mode: BoggleGameMode) => void;
  onNextRound: () => void;
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

  // Ticking clock sound for the last 15 seconds. Fires once per second by
  // watching which integer-second bucket `remaining` is in. The 250 ms tick
  // interval of `now` means we'll capture each second boundary within a
  // quarter-second, good enough for a game countdown.
  const lastTickSec = useRef(-1);
  useEffect(() => {
    if (state.phase !== 'playing') { lastTickSec.current = -1; return; }
    const secs = Math.ceil(remaining / 1000);
    if (secs > 0 && secs <= 15 && secs !== lastTickSec.current) {
      lastTickSec.current = secs;
      sounds.tick();
    }
  }, [remaining, state.phase]);

  // ---------- Lobby ----------
  if (state.phase === 'lobby') {
    const playerCount = state.players.length;
    const canStart = isHost && playerCount >= 2;
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <p className="font-medium">Waiting for the host to start the game.</p>
          <p className="mt-1 text-xs text-neutral-400">
            Players seated: <span className="text-emerald-400">{playerCount}</span> — need at least 2.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {state.players.map(p => (
              <li key={p.playerId} className="text-neutral-300">• {p.username}</li>
            ))}
          </ul>

          {/* Mode selector (host only) */}
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Game mode {isHost ? '' : '(host picks)'}
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {(Object.keys(GAME_MODE_LABELS) as BoggleGameMode[]).map(m => {
                const selected = state.mode === m;
                return (
                  <button
                    key={m}
                    onClick={() => onSetMode(m)}
                    disabled={!isHost || disabled || selected}
                    className={`rounded-md border px-2 py-2 text-xs transition disabled:cursor-not-allowed ${
                      selected
                        ? 'border-emerald-400 bg-emerald-500/15 font-semibold text-emerald-200'
                        : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50'
                    }`}
                  >
                    {GAME_MODE_LABELS[m]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            {canStart ? (
              <button
                onClick={onStart}
                disabled={disabled}
                className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Start game ({playerCount} {playerCount === 1 ? 'player' : 'players'})
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

  // ---------- Between rounds ----------
  if (state.phase === 'between-rounds') {
    return <BetweenRoundsView state={state} me={me?.playerId ?? null} isHost={isHost} disabled={disabled} onNextRound={onNextRound} />;
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
            className={`relative flex aspect-square items-center justify-center rounded-md font-bold ${
              letter.length > 1 ? 'text-lg' : 'text-xl'
            } ${
              active ? 'bg-emerald-500 text-neutral-950 shadow-md' : 'bg-amber-100 text-amber-900 shadow'
            }`}
          >
            <LetterFace letter={letter} />
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

/** Renders a Boggle cell letter, formatting two-letter faces like "QU" as "Qu". */
function LetterFace({ letter }: { letter: string }) {
  if (letter.length === 2) {
    return (
      <span>
        {letter[0]}
        <span className="text-[0.7em] lowercase">{letter[1].toLowerCase()}</span>
      </span>
    );
  }
  return <>{letter}</>;
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
  /** Visual rotation of the whole board (degrees, multiple of 90°). Lets players sitting
   *  at different angles around a shared screen orient the board to their viewpoint. */
  const [rotation, setRotation] = useState(0);
  /** Counter that bumps on every rejected submission; gates a 2-second input lockout +
   *  red board tint so a player can't immediately retry a misfire. */
  const [errorTick, setErrorTick] = useState(0);
  const [errorCooldown, setErrorCooldown] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errorTick === 0) return;
    setErrorCooldown(true);
    const id = window.setTimeout(() => setErrorCooldown(false), 2000);
    return () => window.clearTimeout(id);
  }, [errorTick]);

  const currentWord = path.map(i => board[i]).join('');

  // Find which cell a screen point falls into. Uses elementFromPoint and our data-cell-idx attr.
  // The outer 20% rim of each cell is a dead zone — the pointer must be in the central 60%
  // before we register it. This stops a diagonal drag from accidentally latching onto an
  // orthogonal neighbor whose corner the pointer brushes through.
  const cellAtPoint = useCallback((x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = (el as Element).closest('[data-cell-idx]');
    if (!cell) return null;
    const rect = (cell as HTMLElement).getBoundingClientRect();
    const px = (x - rect.left) / rect.width;
    const py = (y - rect.top) / rect.height;
    const margin = 0.2;
    if (px < margin || px > 1 - margin || py < margin || py > 1 - margin) return null;
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
    if (errorCooldown) return; // lockout after a rejected submission
    unlockAudio(); // prime AudioContext on first gesture so countdown tick plays
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
      setErrorTick(t => t + 1);
      clear();
      return;
    }
    if (alreadyFound.includes(word)) {
      setFeedback({ kind: 'err', msg: 'Already found' });
      setErrorTick(t => t + 1);
      clear();
      return;
    }
    startTransition(async () => {
      const res = await onSubmitWord(word);
      if (res.ok) {
        setFeedback({ kind: 'ok', msg: `+${pointsFor(res.word)} ${res.word}` });
      } else {
        setFeedback({ kind: 'err', msg: res.error });
        setErrorTick(t => t + 1);
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

      {/* Interactive board — centered horizontally + rotated by the player's perspective. */}
      <div className="flex flex-col items-center gap-2">
        <div
          ref={boardRef}
          onPointerMove={onPointerMove}
          className={`grid select-none overflow-hidden rounded-xl border-2 p-2 shadow-lg transition-all duration-300 ${
            errorCooldown ? 'border-rose-500 bg-rose-950/60 ring-2 ring-rose-500/40' : 'border-amber-800 bg-amber-950/40'
          }`}
          style={{
            gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
            width: 'min(100%, 380px)',
            gap: '6px',
            touchAction: 'none',
            transform: `rotate(${rotation}deg)`,
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
              className={`relative flex aspect-square cursor-pointer items-center justify-center rounded-md font-bold transition select-none ${
                letter.length > 1 ? 'text-lg' : 'text-xl'
              } ${
                active
                  ? isLast
                    ? 'bg-emerald-400 text-neutral-950 shadow-lg ring-2 ring-emerald-200'
                    : 'bg-emerald-500 text-neutral-950 shadow-md'
                  : 'bg-amber-100 text-amber-900 shadow hover:bg-amber-200'
              } ${pending ? 'opacity-50' : ''}`}
            >
              {/* Counter-rotate cell content so letters stay upright as the grid rotates. */}
              <div
                className="flex h-full w-full items-center justify-center transition-transform duration-300"
                style={{ transform: `rotate(${-rotation}deg)` }}
              >
                <LetterFace letter={letter} />
                {active && (
                  <span className="absolute right-0.5 top-0.5 rounded bg-emerald-900/70 px-1 text-[9px] font-bold text-white">
                    {pathPos + 1}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        </div>
        <button
          type="button"
          onClick={() => setRotation(r => r + 90)}
          title="Rotate board 90°"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-lg text-neutral-300 transition hover:rotate-90 hover:border-emerald-500 hover:text-emerald-300"
        >
          ↻
        </button>
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

function RoundScoresBlock({ scores, me, medals = false, animated = false, accentByPlayerId }: {
  scores: { playerId: string; username: string; breakdown: { word: string; points: number; duplicate: boolean }[]; total: number }[];
  me: string | null;
  medals?: boolean;
  /** When true, words reveal one at a time, interleaved across players by length, with
   *  duplicates getting crossed out (and totals adjusted) at the moment they're discovered. */
  animated?: boolean;
  /** Optional map of playerId → accent color for coloring usernames in the header. */
  accentByPlayerId?: Record<string, string | undefined>;
}) {
  const medalEmoji = ['🥇', '🥈', '🥉'];

  // Pre-compute each player's final rank so medals can be assigned correctly
  // after tallying, regardless of display order.
  const finalRanks = useMemo(() => {
    const sorted = [...scores].sort((a, b) => b.total - a.total);
    const map = new Map<string, number>();
    sorted.forEach((s, i) => map.set(s.playerId, i));
    return map;
  }, [scores]);

  // Build the global reveal sequence: for each word length 3..8+, iterate every player
  // and emit each of their words of that length. This gives the dramatic "all 3-letter
  // words first, then all 4-letter words, etc." order.
  // IMPORTANT: playerIdx indexes into `scores` (original, unsorted order) — never into a
  // score-sorted copy, which would reveal the winner's position before tallying is done.
  const sequence = useMemo(() => {
    type Item = { playerIdx: number; word: string; rawPoints: number; len: number };
    const items: Item[] = [];
    const lengths = new Set<number>();
    for (const r of scores) for (const b of r.breakdown) lengths.add(b.word.length);
    const sortedLens = [...lengths].sort((a, b) => a - b);
    for (const len of sortedLens) {
      for (let p = 0; p < scores.length; p++) {
        const words = scores[p].breakdown
          .filter(b => b.word.length === len)
          .sort((a, b) => a.word.localeCompare(b.word));
        for (const w of words) {
          items.push({ playerIdx: p, word: w.word, rawPoints: pointsFor(w.word), len });
        }
      }
    }
    return items;
  }, [scores]);

  const [step, setStep] = useState(0);
  // Tallying is "done" when not animated (static view) OR when all words have been revealed.
  const done = !animated || step >= sequence.length;

  useEffect(() => {
    if (!animated) { setStep(sequence.length); return; }
    // (Re)start the reveal whenever the sequence's identity changes (new round).
    setStep(0);
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setStep(n);
      if (n >= sequence.length) window.clearInterval(id);
    }, 650); // quarter of the original 2600 ms — snappier reveal
    return () => window.clearInterval(id);
  }, [animated, sequence]);

  // Compute each player's revealed words + duplicate flags + running total at this step.
  // Uses `scores` (original order) as the source of truth — no score-based sorting.
  const view = useMemo(() => {
    const revealedPerPlayer: { word: string; rawPoints: number; len: number }[][] = scores.map(() => []);
    for (let i = 0; i < Math.min(step, sequence.length); i++) {
      const it = sequence[i];
      revealedPerPlayer[it.playerIdx].push({ word: it.word, rawPoints: it.rawPoints, len: it.len });
    }
    // Lookup: word → set of playerIdxs that have revealed it
    const wordOwners = new Map<string, Set<number>>();
    revealedPerPlayer.forEach((words, p) => {
      for (const w of words) {
        if (!wordOwners.has(w.word)) wordOwners.set(w.word, new Set());
        wordOwners.get(w.word)!.add(p);
      }
    });
    return revealedPerPlayer.map((words, p) => {
      const flagged = words.map(w => ({ ...w, duplicate: (wordOwners.get(w.word)?.size ?? 0) > 1 }));
      const total = flagged.reduce((sum, w) => sum + (w.duplicate ? 0 : w.rawPoints), 0);
      // Group by length for sectioned display
      const byLen = new Map<number, typeof flagged>();
      for (const w of flagged) {
        if (!byLen.has(w.len)) byLen.set(w.len, []);
        byLen.get(w.len)!.push(w);
      }
      return { player: scores[p], words: flagged, byLen, total };
    });
  }, [scores, sequence, step]);

  const lastRevealed = step > 0 && step <= sequence.length ? sequence[step - 1] : null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {view.map((v, idx) => {
        // Medals are only shown once tallying is complete, and rank is derived from
        // the final totals — not from display position.
        const rank = done && medals ? (finalRanks.get(v.player.playerId) ?? idx) : -1;
        return (
          <div
            key={v.player.playerId}
            className={`rounded-md border p-3 text-sm ${
              v.player.playerId === me
                ? 'border-emerald-500/50 bg-emerald-500/5'
                : 'border-neutral-800 bg-neutral-900'
            }`}
          >
            {/* Header: name + score. Score stays hidden until tallying is done. */}
            <div className="mb-3 text-center">
              <div className="font-medium">
                {rank >= 0 && <span className="mr-1">{medalEmoji[rank] ?? ''}</span>}
                <span style={{ color: safeAccent(accentByPlayerId?.[v.player.playerId]) }}>
                  {v.player.username}
                </span>
              </div>
              <div className="font-mono text-2xl font-bold text-amber-400">
                {done ? v.total : '—'}
              </div>
            </div>
            {v.player.breakdown.length === 0 ? (
              <p className="text-xs text-neutral-500">No words submitted.</p>
            ) : v.words.length === 0 ? (
              <p className="text-xs text-neutral-600">…</p>
            ) : (
              <div className="space-y-2">
                {[...v.byLen.entries()].sort((a, b) => a[0] - b[0]).map(([len, words]) => (
                  <div key={len}>
                    <div className="mb-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
                      {len} letters
                    </div>
                    <ul className="flex flex-wrap gap-1.5">
                      {words.map(b => {
                        const isLatest = lastRevealed?.playerIdx === idx && lastRevealed?.word === b.word;
                        return (
                          <li
                            key={b.word}
                            className={`rounded px-2 py-0.5 font-mono text-xs transition-all ${
                              b.duplicate
                                ? 'bg-neutral-800 text-neutral-500 line-through'
                                : 'bg-emerald-500/10 text-emerald-300'
                            } ${isLatest ? 'animate-pop' : ''}`}
                            title={b.duplicate ? 'Cancelled — another player also found it' : `+${b.rawPoints}`}
                          >
                            {b.word} <span className="text-neutral-500">·{b.rawPoints}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BetweenRoundsView({
  state, me, isHost, disabled, onNextRound,
}: {
  state: BoggleState; me: string | null; isHost: boolean; disabled: boolean; onNextRound: () => void;
}) {
  const lastRound = state.rounds[state.rounds.length - 1];
  const totals = aggregateTotals(state);
  const standings = [...totals].sort((a, b) => b.total - a.total);
  const target = state.mode === 'to-50' ? 50 : state.mode === 'to-100' ? 100 : null;
  // Lookup map so RoundScoresBlock + the running-totals table can color each
  // player's name with their preferred accent.
  const accentByPlayerId: Record<string, string | undefined> = {};
  for (const p of state.players) accentByPlayerId[p.playerId] = p.accent_color;
  const roundsLabel = state.mode === '3-rounds'
    ? `Round ${state.round} of 3`
    : target
      ? `Race to ${target} pts`
      : `Round ${state.round}`;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-center">
        <h2 className="text-lg font-bold text-amber-400">⏱ Round {state.round} complete</h2>
        <p className="text-xs text-neutral-400">{roundsLabel} · {GAME_MODE_LABELS[state.mode]}</p>
      </div>

      {/* This round's per-word breakdown */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Round {state.round} scores
        </div>
        {lastRound && <RoundScoresBlock scores={lastRound.scores} me={me} animated accentByPlayerId={accentByPlayerId} />}
      </div>

      {/* Cumulative standings so far */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Running totals
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-2 py-1 text-left">Player</th>
              {state.rounds.map(r => <th key={r.round} className="px-2 py-1 text-center">R{r.round}</th>)}
              <th className="px-2 py-1 text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            {standings.map(s => (
              <tr key={s.playerId} className={`border-t border-neutral-800/60 ${s.playerId === me ? 'bg-emerald-500/5' : ''}`}>
                <td className="px-2 py-1.5 font-medium" style={{ color: safeAccent(accentByPlayerId[s.playerId]) }}>{s.username}</td>
                {s.perRound.map((p, i) => <td key={i} className="px-2 py-1.5 text-center font-mono text-neutral-300">{p}</td>)}
                <td className="px-2 py-1.5 text-center font-mono text-lg font-bold text-amber-400">{s.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {target && (
          <p className="mt-2 text-center text-[11px] text-neutral-500">
            First to {target} wins. Leader: <span className="text-amber-300">{standings[0]?.username}</span> at {standings[0]?.total}.
          </p>
        )}
      </div>

      <div className="text-center">
        {isHost ? (
          <button
            onClick={onNextRound}
            disabled={disabled}
            className="rounded-md bg-emerald-500 px-6 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            Start round {state.round + 1}
          </button>
        ) : (
          <p className="text-sm text-neutral-400">Waiting for the host to start the next round…</p>
        )}
      </div>
    </div>
  );
}

function ScoringPanel({ state, me }: { state: BoggleState; me: string | null }) {
  const standings = [...(state.finalResults ?? [])].sort((a, b) => b.total - a.total);
  const medals = ['🥇', '🥈', '🥉'];
  const winner = standings[0];
  // Always animate the last round's tally — for single-round games the user never
  // saw BetweenRoundsView, and for multi-round games the final round goes straight
  // to `finished` (skipping between-rounds), so neither path showed the reveal.
  const lastRound = state.rounds[state.rounds.length - 1] ?? null;
  const isSingleRound = state.rounds.length === 1;
  const accentByPlayerId: Record<string, string | undefined> = {};
  for (const p of state.players) accentByPlayerId[p.playerId] = p.accent_color;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/5 p-4">
        <div className="mb-3 text-center">
          <h2 className="text-xl font-bold text-amber-400">🏁 Game over!</h2>
          <p className="text-xs text-neutral-400">{GAME_MODE_LABELS[state.mode]} · {state.rounds.length} round{state.rounds.length === 1 ? '' : 's'}</p>
          {winner && (
            <p className="mt-1 text-sm text-neutral-300">
              Winner: <span className="font-semibold" style={{ color: safeAccent(accentByPlayerId[winner.playerId]) }}>{winner.username}</span>{' '}
              <span className="font-mono">({winner.total} pts)</span>
            </p>
          )}
        </div>

        {/* Last-round dramatic reveal — words tick in shortest-first, interleaved
            across players, duplicates crossed out mid-stream. Always runs: for
            single-round games the user never saw BetweenRoundsView, and for
            multi-round games the final round skips between-rounds entirely.
            Medals only shown for single-round (multi-round medals live in the
            overall standings table below, not in the per-round tally). */}
        {lastRound && (
          <div className="mb-4">
            <RoundScoresBlock scores={lastRound.scores} me={me} animated medals={isSingleRound} accentByPlayerId={accentByPlayerId} />
          </div>
        )}

        {/* Aggregate standings */}
        <table className="mb-4 w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-2 py-1 text-left">Player</th>
              {state.rounds.map(r => <th key={r.round} className="px-2 py-1 text-center">R{r.round}</th>)}
              <th className="px-2 py-1 text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, idx) => (
              <tr key={s.playerId} className={`border-t border-neutral-800/60 ${s.playerId === me ? 'bg-emerald-500/5' : ''}`}>
                <td className="px-2 py-1.5 font-medium" style={{ color: safeAccent(accentByPlayerId[s.playerId]) }}>
                  <span className="mr-1">{medals[idx] ?? ''}</span>{s.username}
                </td>
                {s.perRound.map((p, i) => <td key={i} className="px-2 py-1.5 text-center font-mono text-neutral-300">{p}</td>)}
                <td className="px-2 py-1.5 text-center font-mono text-lg font-bold text-amber-400">{s.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Per-round expandable breakdowns */}
        {state.rounds.map(r => (
          <details key={r.round} className="mt-3 rounded-md border border-neutral-800 bg-neutral-900 p-2 text-sm">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Round {r.round} word breakdown
            </summary>
            <div className="mt-2">
              <RoundScoresBlock scores={r.scores} me={me} />
            </div>
          </details>
        ))}
        <p className="mt-3 text-center text-[11px] italic text-neutral-500">
          Words found by more than one player in the same round cancel each other out.
        </p>
      </div>
    </div>
  );
}
