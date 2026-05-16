'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { applyMove as applyMoveTTT, type TTTState } from '@/lib/games/tictactoe';
import { applyMove as applyMoveC4, type C4State } from '@/lib/games/connect4';

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

  // Already in?
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

  // Assign the second-player seat in the game state.
  const state = (room.state || {}) as Record<string, unknown> & { seats?: Record<string, string> };
  const seats = { ...(state.seats || {}) };
  if (seat === 1) {
    if (room.game_type === 'tictactoe' && !seats.O) seats.O = user.id;
    if (room.game_type === 'connect4'  && !seats.Y) seats.Y = user.id;
  }

  await supabase
    .from('rooms')
    .update({
      status: 'playing',
      state: { ...state, seats },
    })
    .eq('id', roomId);

  revalidatePath(`/rooms/${roomId}`);
}

export async function leaveRoom(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase.from('room_players').delete().eq('room_id', roomId).eq('player_id', user.id);
  revalidatePath(`/rooms/${roomId}`);
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
    .update({ state: next, status: next.winner ? 'finished' : 'playing' })
    .eq('id', roomId);
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
    .update({ state: next, status: next.winner ? 'finished' : 'playing' })
    .eq('id', roomId);
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
}
