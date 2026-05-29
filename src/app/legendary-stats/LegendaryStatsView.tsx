'use client';

import { useMemo, useState } from 'react';
import { getCard } from '@/lib/games/legendary';

export type LegendaryGameMeta = {
  result: 'win' | 'loss' | 'tie';
  mastermind: string;
  scheme: string;
  heroClasses: string[];
  playerCount: number;
};

type Agg = { key: string; label: string; games: number; wins: number; losses: number; ties: number };

function cardName(id: string): string {
  try {
    const d = getCard(id);
    if ('name' in d && d.name) return d.name as string;
    if ('cardName' in d && d.cardName) return d.cardName as string;
  } catch { /* unknown id */ }
  return id;
}

function rate(a: Agg): number {
  return a.games === 0 ? 0 : a.wins / a.games;
}

/** Aggregate by a key extractor. For hero classes a game contributes to each
 *  class in the party (presence-based). */
function aggregate(
  games: LegendaryGameMeta[],
  keysOf: (g: LegendaryGameMeta) => string[],
  labelOf: (key: string) => string,
): Agg[] {
  const map = new Map<string, Agg>();
  for (const g of games) {
    for (const key of keysOf(g)) {
      let a = map.get(key);
      if (!a) { a = { key, label: labelOf(key), games: 0, wins: 0, losses: 0, ties: 0 }; map.set(key, a); }
      a.games += 1;
      if (g.result === 'win') a.wins += 1;
      else if (g.result === 'loss') a.losses += 1;
      else a.ties += 1;
    }
  }
  return [...map.values()];
}

const COUNT_FILTERS: Array<'all' | 1 | 2 | 3 | 4 | 5> = ['all', 1, 2, 3, 4, 5];

export default function LegendaryStatsView({ games }: { games: LegendaryGameMeta[] }) {
  const [pc, setPc] = useState<'all' | number>('all');

  const filtered = useMemo(
    () => (pc === 'all' ? games : games.filter(g => g.playerCount === pc)),
    [games, pc],
  );

  // Party win-rate per Mastermind / Scheme (the win-rate is the PARTY's; a low
  // rate = a dangerous Mastermind/Scheme). Hero classes are presence-based.
  const masterminds = useMemo(
    () => aggregate(filtered, g => [g.mastermind], cardName).sort((a, b) => rate(a) - rate(b)),
    [filtered],
  );
  const schemes = useMemo(
    () => aggregate(filtered, g => [g.scheme], cardName).sort((a, b) => rate(a) - rate(b)),
    [filtered],
  );
  const heroes = useMemo(
    // Hero classNames are already display-friendly.
    () => aggregate(filtered, g => g.heroClasses, k => k).sort((a, b) => rate(b) - rate(a)),
    [filtered],
  );

  const totalGames = filtered.length;
  const totalWins = filtered.filter(g => g.result === 'win').length;

  return (
    <div className="mt-5 space-y-6">
      {/* Player-count filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-neutral-500">Players</span>
        {COUNT_FILTERS.map(f => {
          const active = pc === f;
          const n = f === 'all' ? games.length : games.filter(g => g.playerCount === f).length;
          return (
            <button
              key={String(f)}
              onClick={() => setPc(f)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? 'border-amber-400 bg-amber-900/40 text-amber-100'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-amber-700/60'
              }`}
            >
              {f === 'all' ? 'All' : `${f}p`} <span className="text-neutral-500">({n})</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm">
        <span className="text-neutral-400">Recorded games: </span>
        <span className="font-semibold text-neutral-100">{totalGames}</span>
        {totalGames > 0 && (
          <span className="ml-3 text-neutral-400">
            Party win-rate:{' '}
            <span className="font-semibold text-emerald-400">{Math.round((100 * totalWins) / totalGames)}%</span>
          </span>
        )}
      </div>

      {totalGames === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-400">
          No games recorded for this filter yet. Play some Legendary!
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <StatTable title="Most Dangerous Masterminds" subtitle="lowest party win-rate" rows={masterminds} tone="rose" />
          <StatTable title="Toughest Schemes" subtitle="lowest party win-rate" rows={schemes} tone="violet" />
          <StatTable title="Most Effective Heroes" subtitle="highest win-rate when in the party" rows={heroes} tone="emerald" />
        </div>
      )}
    </div>
  );
}

function StatTable({ title, subtitle, rows, tone }: {
  title: string; subtitle: string; rows: Agg[];
  tone: 'rose' | 'violet' | 'emerald';
}) {
  const accent = tone === 'rose' ? '#fb7185' : tone === 'violet' ? '#c4b5fd' : '#34d399';
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-0.5 text-sm font-bold" style={{ color: accent }}>{title}</div>
      <div className="mb-2 text-[11px] uppercase tracking-wider text-neutral-500">{subtitle}</div>
      <div className="space-y-1">
        {rows.map(r => {
          const pct = Math.round(rate(r) * 100);
          return (
            <div key={r.key} className="flex items-center gap-2 rounded bg-neutral-800/50 px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate text-neutral-100" title={r.label}>{r.label}</span>
              <span className="tabular-nums text-neutral-400" title={`${r.wins}W / ${r.losses}L / ${r.ties}T`}>
                {r.games}g
              </span>
              <span
                className="w-10 rounded px-1 py-0.5 text-center font-bold tabular-nums"
                style={{
                  color: pct >= 50 ? '#34d399' : pct >= 30 ? '#fbbf24' : '#fb7185',
                  background: 'rgba(0,0,0,0.35)',
                }}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
