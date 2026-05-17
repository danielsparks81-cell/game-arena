import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import TopBar from '@/components/TopBar';
import { GAMES } from '@/lib/games/registry';
import ProfileForm from './ProfileForm';

type HistoryRow = {
  id: number;
  game_type: string;
  winner_id: string | null;
  player_ids: string[];
  finished_at: string;
};

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, created_at')
    .eq('id', user.id)
    .single();

  // Fetch recent games involving this player
  const { data: history } = await supabase
    .from('game_history')
    .select('id, game_type, winner_id, player_ids, finished_at')
    .contains('player_ids', [user.id])
    .order('finished_at', { ascending: false })
    .limit(25);

  const rows = (history ?? []) as HistoryRow[];

  // Resolve opponent usernames
  const opponentIds = new Set<string>();
  for (const r of rows) for (const pid of r.player_ids) if (pid !== user.id) opponentIds.add(pid);
  const { data: opponents } = opponentIds.size
    ? await supabase.from('profiles').select('id, username').in('id', Array.from(opponentIds))
    : { data: [] as { id: string; username: string }[] };
  const nameById = new Map((opponents ?? []).map(o => [o.id, o.username]));

  // Compute W/L/D
  let wins = 0, losses = 0, draws = 0;
  for (const r of rows) {
    if (r.winner_id === null) draws++;
    else if (r.winner_id === user.id) wins++;
    else losses++;
  }
  const total = rows.length;
  const decisive = wins + losses;
  const winRate = decisive > 0 ? Math.round((wins / decisive) * 100) : 0;

  const username = profile?.username ?? 'player';
  const joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar username={username} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{username}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              Record:{' '}
              <span className="font-mono text-emerald-400">{wins}W</span>
              <span className="text-neutral-600"> · </span>
              <span className="font-mono text-red-400">{losses}L</span>
              <span className="text-neutral-600"> · </span>
              <span className="font-mono text-neutral-300">{draws}D</span>
              {total > 0 && (
                <>
                  <span className="text-neutral-600"> · </span>
                  <span className="font-mono text-sky-400">{winRate}%</span>
                </>
              )}
            </p>
          </div>
          <Link href="/lobby" className="shrink-0 text-sm text-emerald-400 hover:underline">← Back to lobby</Link>
        </div>

        <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <ProfileForm initialUsername={username} />
        </section>

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Games" value={total} />
          <Stat label="Wins"   value={wins}   color="text-emerald-400" />
          <Stat label="Losses" value={losses} color="text-red-400" />
          <Stat label="Draws"  value={draws}  color="text-neutral-300" />
          <div className="col-span-2 sm:col-span-4">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="text-neutral-400">Win rate</span>
                <span className="font-mono text-emerald-400">{winRate}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all"
                  style={{ width: `${winRate}%` }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-300">Recent games</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-500">No games played yet — head to the lobby and challenge someone.</p>
          ) : (
            <ul className="divide-y divide-neutral-800">
              {rows.slice(0, 10).map(r => {
                const opponentId = r.player_ids.find(p => p !== user.id);
                const opponent = opponentId ? (nameById.get(opponentId) ?? 'unknown') : 'solo';
                const outcome =
                  r.winner_id === null ? 'draw' :
                  r.winner_id === user.id ? 'win' : 'loss';
                const gameName = GAMES[r.game_type]?.name ?? r.game_type;
                const when = new Date(r.finished_at).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                });
                return (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <span className="font-medium">{gameName}</span>
                      <span className="text-neutral-500"> vs </span>
                      <span className="text-neutral-300">{opponent}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-neutral-500">{when}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${
                        outcome === 'win'  ? 'bg-emerald-500/15 text-emerald-400' :
                        outcome === 'loss' ? 'bg-red-500/15 text-red-400'         :
                                              'bg-neutral-700/30 text-neutral-300'
                      }`}>
                        {outcome}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 text-sm">
          <h2 className="mb-3 font-medium text-neutral-300">Account</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-neutral-400">
            <dt>Email</dt><dd className="text-neutral-200">{user.email}</dd>
            <dt>Joined</dt><dd className="text-neutral-200">{joined}</dd>
            <dt>User ID</dt><dd className="font-mono text-xs text-neutral-500">{user.id}</dd>
          </dl>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-center">
      <div className={`text-2xl font-semibold ${color ?? 'text-neutral-100'}`}>{value}</div>
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
    </div>
  );
}
