'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GAMES, GAME_GUIDES, displayName as gameDisplayName, GAME_CATEGORIES, CATEGORY_LABELS, type GameCategory } from '@/lib/games/registry';
import { GameThumbnail } from '@/components/GameThumbnail';
import MembersPanel from '@/components/MembersPanel';
import GeneralChat from '@/components/GeneralChat';
import { createRoom } from './actions';

type RoomPlayer = { player_id: string; seat: number; profiles: { username: string } | null };
type Room = {
  id: string;
  game_type: string;
  status: string;
  host_id: string;
  created_at: string;
  room_players: RoomPlayer[];
};
type UserStat = { user_id: string; username: string; accent_color?: string | null; wins: number; losses: number; draws: number; games: number };

export default function LobbyClient({
  initialRooms, initialStats, currentUserId, currentUsername, currentUserAccent,
}: {
  initialRooms: Room[];
  initialStats: UserStat[];
  currentUserId: string;
  currentUsername: string;
  currentUserAccent?: string | null;
}) {
  const supabase = createClient();
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  // Which game's "How to play" modal is open (by game id), or null.
  const [infoGameId, setInfoGameId] = useState<string | null>(null);
  // playerId-sets keyed by room id — derived from `lobby-presence` events.
  // Anyone broadcasting `room_id: X` is on that room's page right now. Subtract
  // the seated player ids to get "watchers" (active spectators).
  const [presenceByRoom, setPresenceByRoom] = useState<Record<string, Set<string>>>({});

  // Realtime room list updates
  useEffect(() => {
    const refreshRooms = async () => {
      const { data } = await supabase
        .from('rooms')
        .select('id, game_type, status, host_id, created_at, room_players(player_id, seat, profiles(username))')
        .order('created_at', { ascending: false })
        .limit(30);
      setRooms((data ?? []) as unknown as Room[]);
    };
    const sub = supabase
      .channel('lobby-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' },        refreshRooms)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players' }, refreshRooms)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [supabase]);

  // Watcher counts come from MembersPanel's presence subscription via the
  // onWatcherSync callback below — we can't subscribe to `lobby-presence`
  // twice from the same page (Supabase rejects "cannot add presence callbacks
  // after subscribe"), so we piggyback on the one MembersPanel already owns.

  // ---- Filter / sort state ----
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'players-desc' | 'players-asc'>('newest');
  // Multi-select chips: which seated-player counts to show. 6 means "6 or more".
  const [playerCounts, setPlayerCounts] = useState<Set<number>>(new Set());
  const togglePlayerCount = (n: number) =>
    setPlayerCounts(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  // Multi-select category chips. Empty set = show every category. A game
  // matches if ANY of its `categories` overlap with the active filter.
  const [activeCategories, setActiveCategories] = useState<Set<GameCategory>>(new Set());
  const toggleCategory = (c: GameCategory) =>
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });

  // Game tiles filtered by search + player-count chips, sorted by player-count sort.
  // A chip "n" matches a game whose [min..max] range includes n; "6+" matches max >= 6.
  // Newest/oldest sorts have no meaning for the static game catalog, so they're a no-op here.
  const visibleGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    let all = Object.values(GAMES);
    if (q) all = all.filter(g => g.name.toLowerCase().includes(q));
    if (playerCounts.size > 0) {
      all = all.filter(g => {
        for (const n of playerCounts) {
          if (n === 6 ? g.maxPlayers >= 6 : (n >= g.minPlayers && n <= g.maxPlayers)) return true;
        }
        return false;
      });
    }
    if (activeCategories.size > 0) {
      all = all.filter(g => (g.categories ?? []).some(c => activeCategories.has(c)));
    }
    // Secondary tiebreaker (game name) so games with identical addedOn dates
    // — e.g. Boggle / Liar's Dice / Yahtzee, all added 2026-05-18 — still
    // flip order between newest and oldest. JavaScript's sort is stable; without
    // the tiebreaker, equal-key items stay in insertion order and the user can't
    // tell the sort actually fired.
    if (sortBy === 'newest')       all = [...all].sort((a, b) => b.addedOn.localeCompare(a.addedOn) || a.name.localeCompare(b.name));
    if (sortBy === 'oldest')       all = [...all].sort((a, b) => a.addedOn.localeCompare(b.addedOn) || b.name.localeCompare(a.name));
    if (sortBy === 'players-desc') all = [...all].sort((a, b) => b.maxPlayers - a.maxPlayers || a.minPlayers - b.minPlayers || a.name.localeCompare(b.name));
    if (sortBy === 'players-asc')  all = [...all].sort((a, b) => a.minPlayers - b.minPlayers || a.maxPlayers - b.maxPlayers || a.name.localeCompare(b.name));
    return all;
  }, [search, playerCounts, activeCategories, sortBy]);

  const openAll = useMemo(() => rooms.filter(r => r.status !== 'finished'), [rooms]);

  const open = useMemo(() => {
    let list = openAll;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(r => {
        const gameName = (GAMES[r.game_type]?.name ?? r.game_type).toLowerCase();
        if (gameName.includes(q)) return true;
        return r.room_players.some(p => (p.profiles?.username ?? '').toLowerCase().includes(q));
      });
    }
    if (playerCounts.size > 0)    list = list.filter(r => {
      const n = r.room_players.length;
      return playerCounts.has(n) || (n >= 6 && playerCounts.has(6));
    });
    const sorted = [...list];
    if (sortBy === 'newest')        sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sortBy === 'oldest')        sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sortBy === 'players-desc')  sorted.sort((a, b) => b.room_players.length - a.room_players.length);
    if (sortBy === 'players-asc')   sorted.sort((a, b) => a.room_players.length - b.room_players.length);
    return sorted;
  }, [openAll, search, playerCounts, sortBy, currentUserId]);

  const finished = useMemo(() => rooms.filter(r => r.status === 'finished').slice(0, 5), [rooms]);

  const filtersActive = !!search.trim() || playerCounts.size > 0 || activeCategories.size > 0;
  const resetFilters = () => {
    setSearch('');
    setPlayerCounts(new Set());
    setActiveCategories(new Set());
  };

  const toolbar = (
    // Single flex row that wraps on narrow viewports. The four logical
    // groups (Search · Category · Players · Sort) are spread across the full
    // bar width via `justify-between`, with thin vertical dividers between
    // them for emphasis.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-neutral-800 bg-neutral-900 p-2 text-xs">
      {/* Search */}
      <label className="flex items-center gap-1.5">
        <span className="text-neutral-500">🔍</span>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 outline-none focus:border-emerald-500"
        />
      </label>

      {/* Category chips (multi-select). Empty selection = show every category. */}
      <div className="flex flex-wrap items-center gap-1 border-l border-neutral-800 pl-6">
        <span className="text-neutral-500">Category:</span>
        {GAME_CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => toggleCategory(c)}
            className={`rounded-full border px-2 py-1 text-[11px] transition ${
              activeCategories.has(c)
                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Player-count chips */}
      <div className="flex items-center gap-1 border-l border-neutral-800 pl-6">
        <span className="text-neutral-500">Players:</span>
        {[1, 2, 3, 4, 5, 6].map(n => (
          <button
            key={n}
            onClick={() => togglePlayerCount(n)}
            className={`min-w-[28px] rounded-full border px-2 py-1 text-center transition ${
              playerCounts.has(n)
                ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            {n === 6 ? '6+' : n}
          </button>
        ))}
      </div>

      {/* Sort + Clear */}
      <div className="flex items-center gap-2 border-l border-neutral-800 pl-6">
        <label className="flex items-center gap-1">
          <span className="text-neutral-500">Sort:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="players-desc">Most players</option>
            <option value="players-asc">Fewest players</option>
          </select>
        </label>

        {/* Always rendered so the toolbar doesn't reflow when filters toggle. */}
        <button
          onClick={resetFilters}
          aria-hidden={!filtersActive}
          tabIndex={filtersActive ? 0 : -1}
          className={`rounded border border-neutral-700 px-2 py-1 text-neutral-300 transition hover:bg-neutral-800 ${
            filtersActive ? '' : 'pointer-events-none invisible'
          }`}
        >
          Clear filters
        </button>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1fr_280px] lg:grid-cols-[1fr_320px]">
      {/* LEFT: filter toolbar, new game tiles, active rooms */}
      <div className="space-y-6">
        {toolbar}

        <section>
          {visibleGames.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
              No games match &ldquo;{search.trim()}&rdquo;.
            </p>
          ) : (
            <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {visibleGames.map(g => (
                // The info button must NOT be nested inside the create-room
                // submit button (invalid HTML + it would create a room). So the
                // tile is a relative wrapper with the form + an overlaid ⓘ button.
                <div key={g.id} className="relative h-full">
                  <form action={createRoom} className="h-full">
                    <input type="hidden" name="gameType" value={g.id} />
                    <button
                      type="submit"
                      className="group relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 text-left transition hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10"
                    >
                      <GameThumbnail gameId={g.id} className="block aspect-[7/5] w-full" />
                      <div className="flex flex-1 flex-col p-2.5">
                        <div className="flex items-center justify-between gap-1">
                          <div className="truncate text-sm font-medium">
                            {g.name}
                            {g.beta && (
                              <span className="ml-1 align-middle rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                                Beta
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 opacity-0 transition group-hover:opacity-100">
                            Start →
                          </span>
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-neutral-400">{g.description}</div>
                        <div className="mt-auto pt-1 text-[10px] text-neutral-500">
                          {g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`}
                        </div>
                      </div>
                    </button>
                  </form>
                  {/* How-to-play button — overlays the thumbnail's top-right. */}
                  {GAME_GUIDES[g.id] && (
                    <button
                      type="button"
                      onClick={() => setInfoGameId(g.id)}
                      title={`How to play ${g.name}`}
                      aria-label={`How to play ${g.name}`}
                      className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-neutral-700/80 bg-neutral-950/70 text-xs font-semibold text-neutral-300 backdrop-blur-sm transition hover:border-emerald-400 hover:text-emerald-300"
                    >
                      ?
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Active rooms</h2>
            <span className="text-sm text-neutral-400">
              {open.length}{filtersActive ? ` / ${openAll.length}` : ''} {open.length === 1 ? 'room' : 'rooms'}
            </span>
          </div>

          {open.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-800 p-6 text-center text-neutral-500">
              {filtersActive
                ? 'No rooms match those filters.'
                : 'No active rooms. Start a new game above or invite a friend from the right.'}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
              {open.map(r => <RoomRow key={r.id} room={r} currentUserId={currentUserId} watcherIds={presenceByRoom[r.id]} />)}
            </ul>
          )}

          {finished.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-xl font-semibold text-neutral-400">Recently finished</h2>
              <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900/40">
                {finished.map(r => <RoomRow key={r.id} room={r} currentUserId={currentUserId} watcherIds={presenceByRoom[r.id]} />)}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* RIGHT: members panel + lobby chat, mirroring the room layout */}
      <div className="space-y-4 md:sticky md:top-4">
        <MembersPanel
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentUserAccent={currentUserAccent}
          initialStats={initialStats}
          className="md:max-h-[450px] md:overflow-y-auto"
          hideInGameSection
          onWatcherSync={setPresenceByRoom}
        />
        <GeneralChat currentUserId={currentUserId} currentUsername={currentUsername} currentUserAccent={currentUserAccent} />
      </div>

      {infoGameId && (
        <GameInfoModal gameId={infoGameId} onClose={() => setInfoGameId(null)} />
      )}
    </div>
  );
}

/** "How to play" modal — theme → objective → basic rules for one game. */
function GameInfoModal({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const game = GAMES[gameId];
  const guide = GAME_GUIDES[gameId];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!game || !guide) return null;
  const players = game.minPlayers === game.maxPlayers
    ? `${game.minPlayers} player${game.minPlayers === 1 ? '' : 's'}`
    : `${game.minPlayers}–${game.maxPlayers} players`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-800 p-4">
          <div className="flex items-center gap-3">
            <GameThumbnail gameId={gameId} className="h-12 w-16 shrink-0 overflow-hidden rounded-md" />
            <div>
              <h2 className="text-lg font-semibold leading-tight">
                {game.name}
                {game.beta && (
                  <span className="ml-1.5 align-middle rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                    Beta
                  </span>
                )}
              </h2>
              <p className="text-xs text-neutral-500">{players}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4 text-sm">
          <p className="text-neutral-300">{guide.theme}</p>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">Objective</h3>
            <p className="text-neutral-300">{guide.objective}</p>
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">How to play</h3>
            <ul className="space-y-1.5">
              {guide.rules.map((r, i) => (
                <li key={i} className="flex gap-2 text-neutral-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-600" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-neutral-800 p-4">
          <form action={createRoom}>
            <input type="hidden" name="gameType" value={gameId} />
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400"
            >
              Start a game →
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function maxPlayersFor(gameId: string): number {
  return GAMES[gameId]?.maxPlayers ?? 2;
}

function RoomRow({
  room, currentUserId, watcherIds,
}: {
  room: Room;
  currentUserId: string;
  /** Set of user IDs currently on this room's page (from `lobby-presence`).
      Includes seated players; we subtract them to get the actual spectator
      count. Undefined when presence hasn't synced yet — no badge then. */
  watcherIds?: Set<string>;
}) {
  const game = gameDisplayName(GAMES[room.game_type], room.game_type);
  const max = maxPlayersFor(room.game_type);
  const seated = room.room_players.length;
  const players = room.room_players.map(p => p.profiles?.username || '???').join(', ') || '—';
  const im = room.room_players.some(p => p.player_id === currentUserId);
  const full = seated >= max;
  const cta = im ? 'Open' : full || room.status !== 'waiting' ? 'Watch' : 'Join';

  // Spectator count = people on the room page who aren't seated. Don't show
  // 0 — only badge when there's actually someone watching.
  const seatedIds = new Set(room.room_players.map(p => p.player_id));
  const watcherCount = watcherIds
    ? [...watcherIds].filter(uid => !seatedIds.has(uid)).length
    : 0;

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium">
          {game}
          <span className="ml-2 text-xs font-normal text-neutral-500">{seated}/{max} {seated === 1 ? 'player' : 'players'}</span>
          {watcherCount > 0 && (
            <span
              className="ml-2 inline-flex items-center gap-1 rounded-full bg-neutral-800/60 px-2 py-0.5 text-[10px] font-medium text-neutral-300"
              title={`${watcherCount} ${watcherCount === 1 ? 'person is' : 'people are'} on this room's page but not seated`}
            >
              👀 {watcherCount} {watcherCount === 1 ? 'watching' : 'watching'}
            </span>
          )}
        </div>
        <div className="truncate text-sm text-neutral-400">{players}</div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs ${
          room.status === 'waiting' ? 'bg-amber-500/15 text-amber-400'
          : room.status === 'playing' ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-neutral-700/30 text-neutral-400'
        }`}>{room.status}</span>
        <Link
          href={`/rooms/${room.id}`}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
        >
          {cta}
        </Link>
      </div>
    </li>
  );
}
