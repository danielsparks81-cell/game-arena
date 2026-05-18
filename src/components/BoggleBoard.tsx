'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  BOARD_SIZE, MIN_WORD_LEN, findPath, pointsFor, msRemaining,
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
        <BoardGrid board={state.board} />
        <WordEntry
          board={state.board}
          alreadyFound={myWords}
          onSubmitWord={onSubmitWord}
        />
      </div>

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

function BoardGrid({ board, highlightPath }: { board: string[]; highlightPath?: number[] }) {
  return (
    <div
      className="mx-auto inline-grid overflow-hidden rounded-xl border-2 border-amber-800 bg-amber-950/40 p-2 shadow-lg"
      style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`, width: 'min(100%, 360px)', gap: '6px' }}
    >
      {board.map((letter, i) => {
        const active = highlightPath?.includes(i);
        // Position in the highlight path (0-indexed) — shown so the user can see direction
        const pathPos = highlightPath?.indexOf(i);
        return (
          <div
            key={i}
            className={`relative flex aspect-square items-center justify-center rounded-md text-xl font-bold transition ${
              active
                ? 'bg-emerald-500 text-neutral-950 shadow-md'
                : 'bg-amber-100 text-amber-900 shadow'
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

function WordEntry({
  board, alreadyFound, onSubmitWord,
}: {
  board: string[];
  alreadyFound: string[];
  onSubmitWord: (word: string) => Promise<{ ok: true; word: string } | { ok: false; error: string }>;
}) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Live adjacency preview as the user types
  const preview = useMemo(() => {
    const w = text.trim().toUpperCase();
    if (w.length < 2) return null;
    return findPath(board, w);
  }, [text, board]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const word = text.trim();
    if (word.length < MIN_WORD_LEN) {
      setFeedback({ kind: 'err', msg: `Need ≥${MIN_WORD_LEN} letters` });
      return;
    }
    if (alreadyFound.includes(word.toUpperCase())) {
      setFeedback({ kind: 'err', msg: 'Already found' });
      return;
    }
    if (!findPath(board, word)) {
      setFeedback({ kind: 'err', msg: "Can't trace on the board" });
      return;
    }
    startTransition(async () => {
      const res = await onSubmitWord(word);
      if (res.ok) {
        setFeedback({ kind: 'ok', msg: `+${pointsFor(res.word)} ${res.word}` });
        setText('');
      } else {
        setFeedback({ kind: 'err', msg: res.error });
      }
    });
  };

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <label className="block">
          <span className="block text-xs text-neutral-400">Type a word, press Enter</span>
          <input
            value={text}
            onChange={e => { setText(e.target.value); setFeedback(null); }}
            placeholder="e.g. DICE"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className={`mt-1 w-full rounded-md border bg-neutral-950 px-3 py-2 text-base font-mono uppercase outline-none ${
              preview === null && text.length >= 2
                ? 'border-rose-500/60 focus:border-rose-400'
                : preview && text.length >= MIN_WORD_LEN
                  ? 'border-emerald-500/60 focus:border-emerald-400'
                  : 'border-neutral-700 focus:border-emerald-500'
            }`}
          />
        </label>
        <button
          type="submit"
          disabled={pending || text.trim().length < MIN_WORD_LEN}
          className="w-full rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          Submit
        </button>
        {feedback && (
          <p className={`text-xs ${feedback.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
            {feedback.msg}
          </p>
        )}
      </form>

      {/* Live preview board reusing the same component for clarity */}
      {preview && text.length >= 2 && (
        <div className="text-center text-[10px] text-neutral-500">Preview path (live):</div>
      )}
      {preview && text.length >= 2 && (
        <BoardGrid board={board} highlightPath={preview} />
      )}
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
