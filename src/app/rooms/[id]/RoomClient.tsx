'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GAMES } from '@/lib/games/registry';
import type { TTTState } from '@/lib/games/tictactoe';
import { type C4State, C4_COLS, C4_ROWS } from '@/lib/games/connect4';
import { sounds, unlockAudio } from '@/lib/sounds';
import MembersPanel from '@/components/MembersPanel';
import LongShotBoard from '@/components/LongShotBoard';
import CheckersBoard from '@/components/CheckersBoard';
import BattleshipBoard from '@/components/BattleshipBoard';
import type { LSState } from '@/lib/games/longshot';
import type { CheckersState } from '@/lib/games/checkers';
import type { BSState } from '@/lib/games/battleship';
import {
  joinRoom, leaveRoom, makeMoveTTT, makeMoveC4, makeMoveCheckers, makeMoveBattleship,
  sendChat, proposeRematch, startGame, rollDiceLS, takeActionLS,
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

  // "And they're off!" announcement when a Long Shot race transitions from waiting → playing
  const prevStatusRef = useRef<string>(initialRoom.status);
  useEffect(() => {
    if (
      prevStatusRef.current === 'waiting' &&
      room.status === 'playing' &&
      room.game_type === 'longshot'
    ) {
      sounds.theyreOff();
    }
    prevStatusRef.current = room.status;
  }, [room.status, room.game_type]);

  const gameName = GAMES[room.game_type]?.name ?? room.game_type;
  const finished = room.status === 'finished';
  const iVoted = room.rematch_votes?.includes(currentUserId) ?? false;
  const otherSeated = room.room_players.filter(p => p.player_id !== currentUserId);
  const allOthersVoted = otherSeated.length > 0
    && otherSeated.every(p => room.rematch_votes?.includes(p.player_id));
  const unvotedOthers = otherSeated.filter(p => !room.rematch_votes?.includes(p.player_id));

  return (
    <main className="mx-auto grid w-full max-w-[1800px] flex-1 grid-cols-1 gap-4 p-4 sm:gap-6 sm:p-6 lg:grid-cols-[1fr_320px]">
      <section>
        {/* Hide the seats grid for Long Shot during play — the in-board Players strip
            covers seated/turn info and the seats grid wastes vertical space. */}
        {!(room.game_type === 'longshot' && room.status === 'playing') && (
          <Seats room={room} currentUserId={currentUserId} />
        )}

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

        {room.game_type === 'checkers' && (
          <CheckersBoard
            state={room.state as CheckersState}
            currentUserId={currentUserId}
            disabled={pending || room.status !== 'playing'}
            onMove={(from, to) => { unlockAudio(); startTransition(() => { makeMoveCheckers(roomId, from, to); }); }}
          />
        )}

        {room.game_type === 'battleship' && (
          <BattleshipBoard
            state={room.state as BSState}
            currentUserId={currentUserId}
            disabled={pending || room.status === 'finished'}
            onMove={(payload) => { unlockAudio(); startTransition(() => { makeMoveBattleship(roomId, payload); }); }}
          />
        )}

        {room.game_type === 'longshot' && room.status === 'waiting' && (
          <LongShotPlaceholder
            room={room}
            currentUserId={currentUserId}
            pending={pending}
            onStart={() => startTransition(() => { startGame(roomId); })}
          />
        )}

        {room.game_type === 'longshot' && room.status !== 'waiting' && (
          <LongShotBoard
            state={room.state as LSState}
            currentUserId={currentUserId}
            disabled={pending}
            onRoll={() => { unlockAudio(); startTransition(() => { rollDiceLS(roomId); }); }}
            onAction={(payload) => { unlockAudio(); startTransition(() => { takeActionLS(roomId, payload); }); }}
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
                {otherSeated.length === 0
                  ? 'No opponents in room'
                  : allOthersVoted
                    ? 'All players ready ✓'
                    : `Waiting on: ${unvotedOthers.map(p => p.profiles?.username ?? 'opponent').join(', ')}…`}
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
        {/* Game header — moved here from the left section so the board gets full width.
            The bug-report button now lives in the TopBar (site-wide). */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h1 className="text-lg font-semibold sm:text-xl">{gameName}</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            Room <code className="text-neutral-300">{roomId.slice(0, 8)}</code> · {room.status}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ShareButton roomId={roomId} />
            <Link href="/lobby" className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900">
              ← Lobby
            </Link>
          </div>
        </div>

        <MembersPanel
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentRoom={{
            id: roomId,
            gameType: room.game_type,
            status: room.status,
            openSeats: Math.max(0, room.max_players - room.room_players.length),
          }}
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

const SEAT_LABELS: Record<string, string[]> = {
  tictactoe: ['X', 'O'],
  connect4:  ['Red', 'Yellow'],
};

function Seats({ room, currentUserId }: { room: Room; currentUserId: string }) {
  const labels = SEAT_LABELS[room.game_type];
  const seated = [...room.room_players].sort((a, b) => a.seat - b.seat);
  const slots = Array.from({ length: room.max_players }, (_, i) => seated.find(p => p.seat === i));
  // For larger games (Long Shot up to 8), use a grid so seats wrap; for 2-player games keep a row.
  const grid = room.max_players > 2
    ? 'grid grid-cols-2 gap-2 sm:grid-cols-4'
    : 'flex gap-2';
  return (
    <div className={`mb-4 ${grid}`}>
      {slots.map((p, i) => (
        <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${room.max_players <= 2 ? 'flex-1' : ''} ${
          p ? 'border-neutral-700 bg-neutral-900' : 'border-dashed border-neutral-800 text-neutral-500'
        }`}>
          <div className="text-xs text-neutral-500">
            Seat {i + 1}{labels?.[i] ? ` (${labels[i]})` : ''}
          </div>
          <div className={`truncate ${p?.player_id === currentUserId ? 'font-semibold text-emerald-400' : ''}`}>
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

function LongShotPlaceholder({
  room, currentUserId, pending, onStart,
}: {
  room: Room;
  currentUserId: string;
  pending: boolean;
  onStart: () => void;
}) {
  const isHost = room.host_id === currentUserId;
  const playerCount = room.room_players.length;
  const canStart = isHost && room.status === 'waiting' && playerCount >= 2;

  return (
    <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      {room.status === 'waiting' ? (
        <>
          <div>
            <h3 className="text-lg font-semibold">Waiting for players</h3>
            <p className="mt-1 text-sm text-neutral-400">
              Up to {room.max_players} players. Share the room link or invite friends from the panel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canStart ? (
              <button
                onClick={onStart}
                disabled={pending}
                className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Start race ({playerCount} {playerCount === 1 ? 'player' : 'players'})
              </button>
            ) : isHost ? (
              <span className="text-sm text-neutral-500">Need at least 2 seated players to start.</span>
            ) : (
              <span className="text-sm text-neutral-500">Waiting for the host to start the race…</span>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-700 p-6 text-center">
          <h3 className="text-lg font-semibold">🏇 Race in progress</h3>
          <p className="mt-2 text-sm text-neutral-400">
            The Long Shot race UI ships in the next deploy. Game state is being tracked in the background.
          </p>
        </div>
      )}
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
