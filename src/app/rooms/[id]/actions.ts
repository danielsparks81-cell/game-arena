'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { applyMove as applyMoveTTT, initialState as tttInitial, type TTTState } from '@/lib/games/tictactoe';
import { applyMove as applyMoveC4, initialState as c4Initial, type C4State } from '@/lib/games/connect4';
import {
  addPlayer as lsAddPlayer,
  startRace as lsStartRace,
  rollDice as lsRollDice,
  type LSState,
} from '@/lib/games/longshot';

/**
 * Push a "room changed" event over Supabase Realtime broadcast so every connected client
 * refetches immediately. This is more reliable than relying on postgres_changes alone,
 * which can lag or silently drop with RLS in some Supabase configurations.
 */
async function notifyRoom(roomId: string) {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{
          topic: `room-${roomId}`,
          event: 'room-changed',
          payload: { at: Date.now() },
          private: false,
        }],
      }),
    });
  } catch {
    // Best-effort — postgres_changes will still cover it eventually.
  }
}

export async function joinRoom(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state, max_players, room_players(player_id, seat)')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');

  if ((room.room_players as { player_id: string }[]).some(p => p.player_id === user.id)) return;
  if (room.status !== 'waiting') throw new Error('Room is not accepting players');
  if (room.room_players.length >= room.max_players) throw new Error('Room is full');

  const usedSeats = new Set((room.room_players as { seat: number }[]).map(p => p.seat));
  let seat = 0;
  while (usedSeats.has(seat)) seat++;

  const { error: insErr } = await supabase
    .from('room_players')
    .insert({ room_id: roomId, player_id: user.id, seat });
  if (insErr) throw new Error(insErr.message);

  if (room.game_type === 'longshot') {
    // Long Shot: stay in 'waiting' until host clicks Start. Add player to game state.
    const { data: profile } = await supabase
      .from('profiles').select('username').eq('id', user.id).single();
    const username = profile?.username ?? 'player';
    const newState = lsAddPlayer((room.state || {}) as LSState, user.id, username, seat);
    await supabase.from('rooms').update({ state: newState }).eq('id', roomId);
  } else {
    // Tic-Tac-Toe / Connect Four: auto-start when 2nd player joins.
    const state = (room.state || {}) as Record<string, unknown> & { seats?: Record<string, string> };
    const seats = { ...(state.seats || {}) };
    if (seat === 1) {
      if (room.game_type === 'tictactoe' && !seats.O) seats.O = user.id;
      if (room.game_type === 'connect4'  && !seats.Y) seats.Y = user.id;
    }
    await supabase
      .from('rooms')
      .update({ status: 'playing', state: { ...state, seats } })
      .eq('id', roomId);
  }

  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

/** Active player rolls both dice and resolves movement. Server-rolled for fairness. */
export async function rollDiceLS(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'longshot') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Race not in progress');

  const state = (room.state || {}) as LSState;
  const me = state.players.find(p => p.playerId === user.id);
  if (!me || me.seat !== state.activePlayerSeat) {
    throw new Error('Only the active player can roll the dice');
  }

  const horseDie = 1 + Math.floor(Math.random() * 8);    // d8
  const movementDie = 1 + Math.floor(Math.random() * 6); // d6
  const next = lsRollDice(state, horseDie, movementDie);
  if ('error' in next) throw new Error(next.error);

  const updates: { state: LSState; status?: string } = { state: next };
  if (next.phase === 'finished') updates.status = 'finished';

  await supabase.from('rooms').update(updates).eq('id', roomId);
  await notifyRoom(roomId);
}

/** Host flips a waiting Long Shot room to 'playing'. */
export async function startGame(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state, host_id, room_players(player_id)')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.host_id !== user.id) throw new Error('Only the host can start the game');
  if (room.status !== 'waiting') throw new Error('Game already started');
  if (room.room_players.length < 2) throw new Error('Need at least 2 players');

  if (room.game_type === 'longshot') {
    const next = lsStartRace((room.state || {}) as LSState);
    if ('error' in next) throw new Error(next.error);
    await supabase
      .from('rooms')
      .update({ status: 'playing', state: next })
      .eq('id', roomId);
  } else {
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
  }

  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

export async function leaveRoom(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase.from('room_players').delete().eq('room_id', roomId).eq('player_id', user.id);
  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

/** Insert a game_history row when a game finishes. Idempotent: caller decides when. */
async function recordHistory(
  supabase: SupabaseClient,
  roomId: string,
  gameType: string,
  seats: Record<string, string>,
  winner: 'X' | 'O' | 'R' | 'Y' | 'draw',
) {
  const playerIds = Object.values(seats).filter(Boolean) as string[];
  const winnerId = winner === 'draw' ? null : seats[winner] ?? null;
  await supabase.from('game_history').insert({
    room_id: roomId,
    game_type: gameType,
    winner_id: winnerId,
    player_ids: playerIds,
  });
}

export async function makeMoveTTT(roomId: string, cell: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'tictactoe') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = applyMoveTTT(room.state as TTTState, cell, user.id);
  if ('error' in next) throw new Error(next.error);

  await supabase
    .from('rooms')
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistory(supabase, roomId, 'tictactoe', next.seats as Record<string, string>, next.winner);
  await notifyRoom(roomId);
}

export async function makeMoveC4(roomId: string, col: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'connect4') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = applyMoveC4(room.state as C4State, col, user.id);
  if ('error' in next) throw new Error(next.error);

  await supabase
    .from('rooms')
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistory(supabase, roomId, 'connect4', next.seats as Record<string, string>, next.winner);
  await notifyRoom(roomId);
}

export async function sendChat(roomId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase.from('chat_messages').insert({
    room_id: roomId, sender_id: user.id, body: trimmed.slice(0, 500),
  });
  await notifyRoom(roomId);
}

/**
 * Vote for a rematch. When all seated players have voted, reset the board with swapped seats
 * and put the room back into `playing` status.
 */
export async function proposeRematch(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state, rematch_votes, room_players(player_id, seat)')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.status !== 'finished') throw new Error('Game is not finished');

  const seated = (room.room_players as { player_id: string; seat: number }[])
    .filter(p => p.seat === 0 || p.seat === 1);
  if (!seated.some(p => p.player_id === user.id)) throw new Error('Not a seated player');

  const votes = new Set((room.rematch_votes as string[]) || []);
  votes.add(user.id);

  const everyone = seated.length >= 2 && seated.every(p => votes.has(p.player_id));

  if (!everyone) {
    await supabase.from('rooms').update({ rematch_votes: Array.from(votes) }).eq('id', roomId);
    return { restarted: false };
  }

  // Swap seats and reset the board.
  const oldState = (room.state || {}) as { seats?: Record<string, string> };
  const oldSeats = oldState.seats || {};

  let newState: TTTState | C4State;
  if (room.game_type === 'tictactoe') {
    newState = { ...tttInitial(), seats: { X: oldSeats.O ?? '', O: oldSeats.X ?? '' } };
  } else if (room.game_type === 'connect4') {
    newState = { ...c4Initial(), seats: { R: oldSeats.Y ?? '', Y: oldSeats.R ?? '' } };
  } else {
    throw new Error('Unsupported game type');
  }

  await supabase
    .from('rooms')
    .update({ state: newState, status: 'playing', rematch_votes: [] })
    .eq('id', roomId);

  await notifyRoom(roomId);
  return { restarted: true };
}
