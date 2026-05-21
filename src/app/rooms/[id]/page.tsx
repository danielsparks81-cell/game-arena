import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProjectedState } from '@/lib/games/registry';
import RoomClient from './RoomClient';

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Sweep stale rooms before rendering so this one doesn't linger if abandoned.
  await supabase.rpc('cleanup_stale_rooms');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, accent_color')
    .eq('id', user.id)
    .single();

  const { data: rawRoom } = await supabase
    .from('rooms')
    .select('id, game_type, status, host_id, state, max_players, rematch_votes, abandon_votes, turn_started_at, time_per_player, room_players(player_id, seat, profiles(username, accent_color))')
    .eq('id', id)
    .single();
  if (!rawRoom) notFound();
  // Project private zones (opponent's hand, decks) BEFORE the room data ever
  // crosses the wire to the client — otherwise the initial-render JSON would
  // leak everything regardless of the projected client-side refresh below.
  const room = { ...rawRoom, state: getProjectedState(rawRoom.game_type, rawRoom.state, user.id) };

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id, body, created_at, sender_id, profiles(username, accent_color)')
    .eq('room_id', id)
    .order('created_at', { ascending: true })
    .limit(100);

  // TopBar lives inside RoomClient so its center-slot can react to live room state
  // (showing Resign / Propose Abandon only during a playing game we're seated in).
  return (
    <RoomClient
      roomId={id}
      currentUserId={user.id}
      currentUsername={profile?.username ?? 'you'}
      currentUserAccent={profile?.accent_color ?? null}
      currentUserEmail={user.email ?? null}
      initialRoom={room as unknown as Parameters<typeof RoomClient>[0]['initialRoom']}
      initialMessages={(messages ?? []) as unknown as Parameters<typeof RoomClient>[0]['initialMessages']}
    />
  );
}
