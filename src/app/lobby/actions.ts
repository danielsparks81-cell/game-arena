'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getGame } from '@/lib/games/registry';

// Both `createRoom` and `inviteToGame` need the same thing: fetch the host's
// profile and ask the registry to build an initial state with them seated.
// Centralized so any new game just needs to register `createInitialStateForHost`
// in its GameDef.
async function buildHostSeatedState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  hostUserId: string,
  gameType: string,
) {
  const game = getGame(gameType);
  if (!game) throw new Error('Unknown game');
  const { data: profile } = await supabase
    .from('profiles').select('username, accent_color').eq('id', hostUserId).single();
  return game.createInitialStateForHost({
    userId: hostUserId,
    username: profile?.username ?? 'player',
    accentColor: (profile?.accent_color as string | undefined),
  });
}

export async function createRoom(formData: FormData) {
  const gameType = String(formData.get('gameType') || '');
  const game = getGame(gameType);
  if (!game) throw new Error('Unknown game');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const state = await buildHostSeatedState(supabase, user.id, gameType);

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
  const state = await buildHostSeatedState(supabase, user.id, gameType);

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
