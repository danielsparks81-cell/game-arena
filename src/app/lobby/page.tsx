import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GAMES } from '@/lib/games/registry';
import TopBar from '@/components/TopBar';
import { GameThumbnail } from '@/components/GameThumbnail';
import LobbyClient from './LobbyClient';
import { createRoom } from './actions';

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

  const newGameSection = (
    <section>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Object.values(GAMES).map(g => (
          <form key={g.id} action={createRoom}>
            <input type="hidden" name="gameType" value={g.id} />
            <button
              type="submit"
              className="group relative w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 text-left transition hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10"
            >
              <GameThumbnail gameId={g.id} className="block aspect-[7/5] w-full" />
              <div className="p-2.5">
                <div className="flex items-center justify-between gap-1">
                  <div className="truncate text-sm font-medium">{g.name}</div>
                  <span className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 opacity-0 transition group-hover:opacity-100">
                    Start →
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-neutral-400">{g.description}</div>
                <div className="mt-1 text-[10px] text-neutral-500">
                  {g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`}
                </div>
              </div>
            </button>
          </form>
        ))}
      </div>
    </section>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar username={username} />
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <LobbyClient
          initialRooms={(rooms ?? []) as unknown as Parameters<typeof LobbyClient>[0]['initialRooms']}
          initialStats={(stats ?? []) as Parameters<typeof LobbyClient>[0]['initialStats']}
          currentUserId={user.id}
          currentUsername={username}
          newGameSection={newGameSection}
        />
      </main>
    </div>
  );
}
