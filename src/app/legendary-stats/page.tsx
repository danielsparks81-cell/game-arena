import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import TopBar from '@/components/TopBar';
import LegendaryStatsView, { type LegendaryGameMeta } from './LegendaryStatsView';

// Aggregate analytics for Legendary, computed over every recorded game's
// game_history.meta payload (mastermind / scheme / hero classes / player
// count / co-op result). Global across all players.

export default async function LegendaryStatsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .single();
  const username = profile?.username ?? user.email ?? 'player';

  // Pull Legendary rows that carry analytics meta. If the `meta` column hasn't
  // been migrated yet the query errors — surface a friendly hint instead of a
  // crash.
  const { data, error } = await supabase
    .from('game_history')
    .select('meta')
    .eq('game_type', 'legendary')
    .not('meta', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(2000);

  const needsMigration = !!error;
  const games: LegendaryGameMeta[] = (data ?? [])
    .map((r: { meta: unknown }) => r.meta as LegendaryGameMeta)
    .filter((m): m is LegendaryGameMeta =>
      !!m && typeof m === 'object' && Array.isArray((m as LegendaryGameMeta).heroClasses));

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <TopBar username={username} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight text-amber-300">Legendary — Battle Records</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Win-rates across every recorded game. Which Masterminds crush parties, which Schemes
          run them out of time, and which Hero classes carry the day.
        </p>
        {needsMigration ? (
          <div className="mt-6 rounded-lg border border-amber-700/50 bg-amber-950/30 p-4 text-sm text-amber-200">
            The analytics column isn’t set up yet. Run <code className="rounded bg-black/40 px-1">supabase/migrations/013_game_history_meta.sql</code> in
            the Supabase SQL editor, then play a Legendary game to start collecting stats.
          </div>
        ) : (
          <LegendaryStatsView games={games} />
        )}
      </main>
    </div>
  );
}
