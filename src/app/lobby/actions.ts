'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getGame } from '@/lib/games/registry';
import { initialState as tttInitial } from '@/lib/games/tictactoe';
import { initialState as c4Initial } from '@/lib/games/connect4';

export async function createRoom(formData: FormData) {
  const gameType = String(formData.get('gameType') || '');
  const game = getGame(gameType);
  if (!game) throw new Error('Unknown game');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Initial state with host seated as the first player
  const state =
    gameType === 'tictactoe' ? { ...tttInitial(), seats: { X: user.id } } :
    gameType === 'connect4'  ? { ...c4Initial(),  seats: { R: user.id } } :
    {};

  const { data: room, error } = await supabase
    .from('rooms')
    .insert({
      game_type: gameType,
      host_id: user.id,
      max_players: game.maxPlayers,
      state,
    })
    .select('id')
    .single();
  if (error || !room) throw new Error(error?.message || 'Could not create room');

  const { error: rpErr } = await supabase
    .from('room_players')
    .insert({ room_id: room.id, player_id: user.id, seat: 0 });
  if (rpErr) throw new Error(rpErr.message);

  redirect(`/rooms/${room.id}`);
}

export async function inviteToGame(targetUserId: string, gameType: string): Promise<{ roomId: string }> {
  const game = getGame(gameType);
  if (!game) throw new Error('Unknown game');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  if (targetUserId === user.id) throw new Error("Can't invite yourself");

  const { data: target } = await supabase
    .from('profiles').select('id').eq('id', targetUserId).maybeSingle();
  if (!target) throw new Error('User not found');

  // Host seats themselves; invitee joins themselves when they click the notification
  // (RLS only allows users to insert their own room_players rows).
  const state =
    gameType === 'tictactoe' ? { ...tttInitial(), seats: { X: user.id } } :
    gameType === 'connect4'  ? { ...c4Initial(),  seats: { R: user.id } } :
    {};

  const { data: room, error } = await supabase
    .from('rooms')
    .insert({
      game_type: gameType,
      host_id: user.id,
      max_players: game.maxPlayers,
      state,
      status: 'waiting',
    })
    .select('id')
    .single();
  if (error || !room) throw new Error(error?.message || 'Could not create room');

  const { error: rpErr } = await supabase
    .from('room_players')
    .insert({ room_id: room.id, player_id: user.id, seat: 0 });
  if (rpErr) throw new Error(rpErr.message);

  return { roomId: room.id };
}
