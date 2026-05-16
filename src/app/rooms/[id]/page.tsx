import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import TopBar from '@/components/TopBar';
import RoomClient from './RoomClient';

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('id', user.id)
    .single();

  const { data: room } = await supabase
    .from('rooms')
    .select('id, game_type, status, host_id, state, max_players, room_players(player_id, seat, profiles(username))')
    .eq('id', id)
    .single();
  if (!room) notFound();

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id, body, created_at, sender_id, profiles(username)')
    .eq('room_id', id)
    .order('created_at', { ascending: true })
    .limit(100);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar username={profile?.username ?? user.email ?? 'player'} />
      <RoomClient
        roomId={id}
        currentUserId={user.id}
        currentUsername={profile?.username ?? 'you'}
        initialRoom={room as unknown as Parameters<typeof RoomClient>[0]['initialRoom']}
        initialMessages={(messages ?? []) as unknown as Parameters<typeof RoomClient>[0]['initialMessages']}
      />
    </div>
  );
}
