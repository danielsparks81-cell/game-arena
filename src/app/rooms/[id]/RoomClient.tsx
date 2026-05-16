'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GAMES } from '@/lib/games/registry';
import type { TTTState } from '@/lib/games/tictactoe';
import { type C4State, C4_COLS, C4_ROWS } from '@/lib/games/connect4';
import { joinRoom, leaveRoom, makeMoveTTT, makeMoveC4, sendChat } from './actions';

type RoomPlayer = { player_id: string; seat: number; profiles: { username: string } | null };
type Room = {
  id: string;
  game_type: string;
  status: string;
  host_id: string;
  state: unknown;
  max_players: number;
  room_players: RoomPlayer[];
};
type ChatMsg = {
  id: number; body: string; created_at: string;
  sender_id: string; profiles: { username: string } | null;
};

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

  // Realtime: room state, players, chat
  useEffect(() => {
    const refreshRoom = async () => {
      const { data } = await supabase
        .from('rooms')
        .select('id, game_type, status, host_id, state, max_players, room_players(player_id, seat, profiles(username))')
        .eq('id', roomId)
        .single();
      if (data) setRoom(data as unknown as Room);
    };

    const ch = supabase.channel(`room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, refreshRoom)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          // fetch the username for the new message
          const m = payload.new as { id: number; body: string; created_at: string; sender_id: string };
          const { data: prof } = await supabase
            .from('profiles').select('username').eq('id', m.sender_id).single();
          setMessages(prev => [...prev, { ...m, profiles: prof ? { username: prof.username } : null }]);
        })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [supabase, roomId]);

  const gameName = GAMES[room.game_type]?.name ?? room.game_type;

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_320px]">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{gameName}</h1>
            <p className="text-sm text-neutral-400">Room <code className="text-neutral-300">{roomId.slice(0, 8)}</code> · {room.status}</p>
          </div>
          <div className="flex gap-2">
            <ShareButton roomId={roomId} />
            <Link href="/lobby" className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900">
              Back to lobby
            </Link>
          </div>
        </div>

        <Seats room={room} currentUserId={currentUserId} />

        {room.game_type === 'tictactoe' && (
          <TicTacToeBoard
            state={room.state as TTTState}
            currentUserId={currentUserId}
            disabled={pending || room.status !== 'playing'}
            onMove={(cell) => startTransition(() => { makeMoveTTT(roomId, cell); })}
          />
        )}

        {room.game_type === 'connect4' && (
          <ConnectFourBoard
            state={room.state as C4State}
            currentUserId={currentUserId}
            disabled={pending || room.status !== 'playing'}
            onMove={(col) => startTransition(() => { makeMoveC4(roomId, col); })}
          />
        )}

        {imSeated && room.status !== 'finished' && (
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

      <aside className="flex h-[600px] flex-col rounded-xl border border-neutral-800 bg-neutral-900">
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
    </main>
  );
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

  return (
    <div>
      <div className="mb-3 text-center text-sm text-neutral-400">
        {state.winner
          ? state.winner === 'draw' ? 'Draw!' : `${state.winner} wins! 🎉`
          : yourMark
            ? (yourTurn ? `Your turn (${yourMark})` : `Waiting on ${state.turn}…`)
            : `Spectating · ${state.turn}'s turn`}
      </div>
      <div className="mx-auto grid w-72 grid-cols-3 gap-2 sm:w-96">
        {state.board.map((cell, i) => (
          <button
            key={i}
            disabled={disabled || !yourTurn || cell !== null}
            onClick={() => onMove(i)}
            className="flex aspect-square items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-5xl font-bold transition hover:border-emerald-500 disabled:hover:border-neutral-800"
          >
            <span className={cell === 'X' ? 'text-emerald-400' : cell === 'O' ? 'text-sky-400' : ''}>{cell}</span>
          </button>
        ))}
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

  // Top row of column buttons (hover indicator + click-to-drop)
  const colFull = (col: number) => state.board[0][col] !== null;

  return (
    <div>
      <div className="mb-3 text-center text-sm text-neutral-400">
        {state.winner
          ? state.winner === 'draw'
            ? 'Draw!'
            : `${state.winner === 'R' ? 'Red' : 'Yellow'} wins! 🎉`
          : yourMark
            ? (yourTurn
                ? `Your turn (${yourMark === 'R' ? 'Red' : 'Yellow'})`
                : `Waiting on ${state.turn === 'R' ? 'Red' : 'Yellow'}…`)
            : `Spectating · ${state.turn === 'R' ? 'Red' : 'Yellow'}'s turn`}
      </div>

      <div className="mx-auto w-fit rounded-xl bg-blue-900 p-3 shadow-xl">
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
            return (
              <button
                key={idx}
                disabled={disabled || !yourTurn || colFull(c)}
                onClick={() => onMove(c)}
                className="aspect-square w-10 rounded-full bg-blue-950 transition sm:w-12 disabled:cursor-default"
              >
                <span
                  className={`block h-full w-full rounded-full transition ${
                    cell === 'R' ? 'bg-red-500'
                    : cell === 'Y' ? 'bg-yellow-400'
                    : 'bg-neutral-900'
                  } ${winning ? 'ring-4 ring-emerald-400' : ''}`}
                />
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
