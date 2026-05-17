import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import TopBar from '@/components/TopBar';
import LobbyClient from './LobbyClient';

export default async function LobbyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  await supabase.rpc('cleanup_stale_rooms');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('id', user.id)
    .single();

  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, game_type, status, host_id, created_at, room_players(player_id, seat, profiles(username))')
    .order('created_at', { ascending: false })
    .limit(30);

  const { data: stats } = await supabase
    .from('user_stats')
    .select('user_id, username, wins, losses, draws, games');

  const username = profile?.username ?? user.email ?? 'player';

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar username={username} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <LobbyClient
          initialRooms={(rooms ?? []) as unknown as Parameters<typeof LobbyClient>[0]['initialRooms']}
          initialStats={(stats ?? []) as Parameters<typeof LobbyClient>[0]['initialStats']}
          currentUserId={user.id}
          currentUsername={username}
        />
      </main>
    </div>
  );
}
