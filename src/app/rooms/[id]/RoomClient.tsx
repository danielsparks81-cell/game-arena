'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GAMES } from '@/lib/games/registry';
import type { TTTState } from '@/lib/games/tictactoe';
import { type C4State, C4_COLS, C4_ROWS } from '@/lib/games/connect4';
import { sounds, unlockAudio } from '@/lib/sounds';
import MembersPanel from '@/components/MembersPanel';
import {
  joinRoom, leaveRoom, makeMoveTTT, makeMoveC4, sendChat, proposeRematch,
} from './actions';

type RoomPlayer = { player_id: string; seat: number; profiles: { username: string } | null };
type Room = {
  id: string;
  game_type: string;
  status: string;
  host_id: string;
  state: unknown;
  max_players: number;
  rematch_votes: string[];
  room_players: RoomPlayer[];
};
type ChatMsg = {
  id: number; body: string; created_at: string;
  sender_id: string; profiles: { username: string } | null;
};

const ROOM_SELECT =
  'id, game_type, status, host_id, state, max_players, rematch_votes, room_players(player_id, seat, profiles(username))';

export default function RoomClient({
  roomId, currentUserId, currentUsername, initialRoom, initialMessages,
}: {
  roomId: string;
  currentUserId: string;
  currentUsername: string;
  initialRoom: Room;
  initialMessages: ChatMsg[];
}) {
  const supabase = createClient();
  const [room, setRoom] = useState<Room>(initialRoom);
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState('');

  const imSeated = room.room_players.some(p => p.player_id === currentUserId);

  // Auto-join if seat available and not seated yet
  useEffect(() => {
    if (!imSeated && room.status === 'waiting' && room.room_players.length < room.max_players) {
      startTransition(() => { joinRoom(roomId); });
    }
  }, [imSeated, room.status, room.room_players.length, room.max_players, roomId]);

  // Realtime subscriptions — broadcast is the primary channel, postgres_changes is a fallback.
  useEffect(() => {
    const refreshRoom = async () => {
      const { data } = await supabase.from('rooms').select(ROOM_SELECT).eq('id', roomId).single();
      if (data) setRoom(data as unknown as Room);
    };

    const refreshMessages = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, body, created_at, sender_id, profiles(username)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (data) setMessages(data as unknown as ChatMsg[]);
    };

    const ch = supabase.channel(`room-${roomId}`)
      // Primary: server actions broadcast on this channel after any DB mutation.
      .on('broadcast', { event: 'room-changed' }, () => {
        refreshRoom();
        refreshMessages();
      })
      // Fallback: postgres_changes if broadcast is missed.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms',        filter: `id=eq.${roomId}` },     refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, refreshRoom)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const m = payload.new as { id: number; body: string; created_at: string; sender_id: string };
          const { data: prof } = await supabase
            .from('profiles').select('username').eq('id', m.sender_id).single();
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, { ...m, profiles: prof ? { username: prof.username } : null }]);
        })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [supabase, roomId]);

  // Sound effects: detect moves and game end
  const prevWinnerRef = useRef<unknown>(null);
  const prevMoveRef   = useRef<number>(0);
  useEffect(() => {
    const s = room.state as { winner?: unknown; board?: unknown };
    const winner = s?.winner ?? null;
    const moveCount = countMoves(s);

    if (winner && !prevWinnerRef.current) {
      if (winner === 'draw') sounds.draw();
      else sounds.win();
    } else if (moveCount > prevMoveRef.current) {
      if (room.game_type === 'connect4') sounds.drop();
      else sounds.click();
    }
    prevWinnerRef.current = winner;
    prevMoveRef.current = moveCount;
  }, [room.state, room.game_type]);

  const gameName = GAMES[room.game_type]?.name ?? room.game_type;
  const finished = room.status === 'finished';
  const iVoted = room.rematch_votes?.includes(currentUserId) ?? false;
  const otherSeated = room.room_players.find(p => p.player_id !== currentUserId);
  const otherVoted = otherSeated ? room.rematch_votes?.includes(otherSeated.player_id) : false;

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-[1fr_320px]">
      <section>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold sm:text-2xl">{gameName}</h1>
            <p className="text-sm text-neutral-400">Room <code className="text-neutral-300">{roomId.slice(0, 8)}</code> · {room.status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ShareButton roomId={roomId} />
            <Link href="/lobby" className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900">
              ← Lobby
            </Link>
          </div>
        </div>

        <Seats room={room} currentUserId={currentUserId} />

        {room.game_type === 'tictactoe' && (
          <TicTacToeBoard
            state={room.state as TTTState}
            currentUserId={currentUserId}
            disabled={pending || room.status !== 'playing'}
            onMove={(cell) => { unlockAudio(); startTransition(() => { makeMoveTTT(roomId, cell); }); }}
          />
        )}

        {room.game_type === 'connect4' && (
          <ConnectFourBoard
            state={room.state as C4State}
            currentUserId={currentUserId}
            disabled={pending || room.status !== 'playing'}
            onMove={(col) => { unlockAudio(); startTransition(() => { makeMoveC4(roomId, col); }); }}
          />
        )}

        {finished && imSeated && (
          <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-emerald-900/40 bg-emerald-500/5 p-5">
            <p className="text-sm text-neutral-300">Rematch? Both players need to agree.</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => startTransition(() => { proposeRematch(roomId); })}
                disabled={pending || iVoted}
                className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {iVoted ? '✓ You voted' : 'Rematch'}
              </button>
              <span className="text-sm text-neutral-400">
                {otherSeated
                  ? otherVoted
                    ? `${otherSeated.profiles?.username ?? 'Opponent'} ready ✓`
                    : `Waiting on ${otherSeated.profiles?.username ?? 'opponent'}…`
                  : 'No opponent in room'}
              </span>
            </div>
          </div>
        )}

        {imSeated && !finished && (
          <div className="mt-6">
            <button
              onClick={() => startTransition(() => { leaveRoom(roomId); })}
              className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20"
            >
              Leave room
            </button>
          </div>
        )}
      </section>

      <div className="space-y-4">
        <MembersPanel
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          className="lg:max-h-[320px] lg:overflow-y-auto"
        />
      <aside className="flex h-80 flex-col rounded-xl border border-neutral-800 bg-neutral-900 lg:h-[480px]">
        <div className="border-b border-neutral-800 px-4 py-2 text-sm font-medium">Chat</div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
          {messages.length === 0 && <p className="text-neutral-500">No messages yet.</p>}
          {messages.map(m => (
            <div key={m.id}>
              <span className={`font-medium ${m.sender_id === currentUserId ? 'text-emerald-400' : 'text-sky-400'}`}>
                {m.profiles?.username || '???'}:
              </span>{' '}
              <span className="text-neutral-200">{m.body}</span>
            </div>
          ))}
        </div>
        <form
          className="flex gap-2 border-t border-neutral-800 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft;
            if (!v.trim()) return;
            setDraft('');
            startTransition(() => { sendChat(roomId, v); });
          }}
        >
          <input
            value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={imSeated ? `Message as ${currentUsername}` : 'Join the room to chat'}
            disabled={!imSeated}
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
          />
          <button
            type="submit" disabled={!imSeated || !draft.trim()}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
          >Send</button>
        </form>
      </aside>
      </div>
    </main>
  );
}

function countMoves(s: unknown): number {
  if (!s || typeof s !== 'object') return 0;
  const obj = s as { board?: unknown };
  if (!obj.board) return 0;
  if (Array.isArray(obj.board) && obj.board.length > 0 && Array.isArray(obj.board[0])) {
    // 2D board (connect4)
    return (obj.board as unknown[][]).reduce((acc, row) => acc + row.filter(c => c !== null).length, 0);
  }
  // Flat board (tictactoe)
  return (obj.board as unknown[]).filter(c => c !== null).length;
}

const SEAT_LABELS: Record<string, [string, string]> = {
  tictactoe: ['X', 'O'],
  connect4:  ['Red', 'Yellow'],
};

function Seats({ room, currentUserId }: { room: Room; currentUserId: string }) {
  const labels = SEAT_LABELS[room.game_type] ?? ['Seat 1', 'Seat 2'];
  const seated = [...room.room_players].sort((a, b) => a.seat - b.seat);
  const slots = Array.from({ length: room.max_players }, (_, i) => seated.find(p => p.seat === i));
  return (
    <div className="mb-4 flex gap-2">
      {slots.map((p, i) => (
        <div key={i} className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
          p ? 'border-neutral-700 bg-neutral-900' : 'border-dashed border-neutral-800 text-neutral-500'
        }`}>
          <div className="text-xs text-neutral-500">Seat {i + 1} ({labels[i] ?? `P${i + 1}`})</div>
          <div className={p?.player_id === currentUserId ? 'font-semibold text-emerald-400' : ''}>
            {p?.profiles?.username || 'Waiting…'}
          </div>
        </div>
      ))}
    </div>
  );
}

function TicTacToeBoard({
  state, currentUserId, disabled, onMove,
}: {
  state: TTTState; currentUserId: string; disabled: boolean; onMove: (i: number) => void;
}) {
  const yourMark = state.seats.X === currentUserId ? 'X' : state.seats.O === currentUserId ? 'O' : null;
  const yourTurn = yourMark && state.turn === yourMark && !state.winner;
  const winning = new Set(state.winningLine ?? []);

  const statusText = state.winner
    ? state.winner === 'draw' ? 'Draw!' : `${state.winner} wins! 🎉`
    : yourMark
      ? (yourTurn ? `Your turn (${yourMark})` : `Waiting on ${state.turn}…`)
      : `Spectating · ${state.turn}'s turn`;

  return (
    <div>
      <div className="mb-3 text-center text-sm text-neutral-400">{statusText}</div>
      <div className="mx-auto grid w-72 grid-cols-3 gap-2 sm:w-96">
        {state.board.map((cell, i) => {
          const isWin = winning.has(i);
          return (
            <button
              key={i}
              disabled={disabled || !yourTurn || cell !== null}
              onClick={() => onMove(i)}
              className={`group flex aspect-square items-center justify-center rounded-xl border p-4 shadow-inner transition ${
                isWin
                  ? 'border-emerald-400 bg-emerald-500/10 animate-win-pulse'
                  : 'border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 hover:border-emerald-500 hover:from-neutral-800 disabled:hover:border-neutral-800 disabled:hover:from-neutral-900'
              }`}
            >
              {cell === 'X' && (
                <svg key={`X-${i}`} viewBox="0 0 24 24" className="h-full w-full text-emerald-400 animate-piece-in">
                  <line x1="5"  y1="5"  x2="19" y2="19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  <line x1="19" y1="5"  x2="5"  y2="19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {cell === 'O' && (
                <svg key={`O-${i}`} viewBox="0 0 24 24" className="h-full w-full text-sky-400 animate-piece-in">
                  <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="3" fill="none" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConnectFourBoard({
  state, currentUserId, disabled, onMove,
}: {
  state: C4State; currentUserId: string; disabled: boolean; onMove: (col: number) => void;
}) {
  const yourMark = state.seats.R === currentUserId ? 'R' : state.seats.Y === currentUserId ? 'Y' : null;
  const yourTurn = yourMark && state.turn === yourMark && !state.winner;

  const isWinning = (r: number, c: number) =>
    !!state.winningLine?.some(cell => cell.r === r && cell.c === c);

  const colFull = (col: number) => state.board[0][col] !== null;

  const statusText = state.winner
    ? state.winner === 'draw'
      ? 'Draw!'
      : `${state.winner === 'R' ? 'Red' : 'Yellow'} wins! 🎉`
    : yourMark
      ? (yourTurn
          ? `Your turn (${yourMark === 'R' ? 'Red' : 'Yellow'})`
          : `Waiting on ${state.turn === 'R' ? 'Red' : 'Yellow'}…`)
      : `Spectating · ${state.turn === 'R' ? 'Red' : 'Yellow'}'s turn`;

  return (
    <div>
      <div className="mb-3 text-center text-sm text-neutral-400">{statusText}</div>

      <div className="mx-auto w-fit rounded-xl bg-gradient-to-b from-blue-700 to-blue-900 p-3 shadow-2xl">
        {/* Drop buttons */}
        <div
          className="mb-1 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${C4_COLS}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: C4_COLS }, (_, c) => (
            <button
              key={c}
              disabled={disabled || !yourTurn || colFull(c)}
              onClick={() => onMove(c)}
              aria-label={`Drop in column ${c + 1}`}
              className="h-6 rounded text-xs text-blue-200 transition hover:bg-blue-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ▼
            </button>
          ))}
        </div>

        {/* Board */}
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${C4_COLS}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: C4_ROWS * C4_COLS }, (_, idx) => {
            const r = Math.floor(idx / C4_COLS);
            const c = idx % C4_COLS;
            const cell = state.board[r][c];
            const winning = isWinning(r, c);
            const isLastMove = state.lastMove && state.lastMove.r === r && state.lastMove.c === c;
            return (
              <button
                key={idx}
                disabled={disabled || !yourTurn || colFull(c)}
                onClick={() => onMove(c)}
                className="aspect-square w-9 rounded-full bg-blue-950 shadow-inner transition sm:w-12 disabled:cursor-default"
              >
                {cell ? (
                  <span
                    key={`${cell}-${r}-${c}`}
                    className={`block h-full w-full rounded-full transition ${
                      cell === 'R'
                        ? 'bg-gradient-to-br from-red-400 to-red-600 shadow-lg shadow-red-900/40'
                        : 'bg-gradient-to-br from-yellow-300 to-yellow-500 shadow-lg shadow-yellow-900/40'
                    } ${winning ? 'ring-4 ring-emerald-400 animate-win-pulse' : ''} ${isLastMove ? 'animate-drop-in' : ''}`}
                    style={isLastMove ? ({ ['--drop-from' as string]: `-${(r + 1) * 100}%` } as React.CSSProperties) : undefined}
                  />
                ) : (
                  <span className="block h-full w-full rounded-full bg-neutral-900/80" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ShareButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(`${window.location.origin}/rooms/${roomId}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900"
    >
      {copied ? 'Link copied!' : 'Copy invite link'}
    </button>
  );
}
