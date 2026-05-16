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

  const username = profile?.username ?? user.email ?? 'player';

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar username={username} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Start a new game</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.values(GAMES).map(g => (
              <form key={g.id} action={createRoom}>
                <input type="hidden" name="gameType" value={g.id} />
                <button
                  type="submit"
                  className="group relative w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 text-left transition hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10"
                >
                  <GameThumbnail gameId={g.id} className="block aspect-[7/5] w-full" />
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{g.name}</div>
                      <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 opacity-0 transition group-hover:opacity-100">
                        Start →
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-neutral-400">{g.description}</div>
                    <div className="mt-2 text-xs text-neutral-500">
                      {g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`}
                    </div>
                  </div>
                </button>
              </form>
            ))}
          </div>
        </section>

        <LobbyClient initialRooms={(rooms ?? []) as unknown as Parameters<typeof LobbyClient>[0]['initialRooms']} currentUserId={user.id} />
      </main>
    </div>
  );
}
