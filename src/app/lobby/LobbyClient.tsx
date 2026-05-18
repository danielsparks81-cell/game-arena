'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GAMES } from '@/lib/games/registry';
import MembersPanel from '@/components/MembersPanel';
import GeneralChat from '@/components/GeneralChat';

type RoomPlayer = { player_id: string; seat: number; profiles: { username: string } | null };
type Room = {
  id: string;
  game_type: string;
  status: string;
  host_id: string;
  created_at: string;
  room_players: RoomPlayer[];
};
type UserStat = { user_id: string; username: string; wins: number; losses: number; draws: number; games: number };

export default function LobbyClient({
  initialRooms, initialStats, currentUserId, currentUsername, newGameSection,
}: {
  initialRooms: Room[];
  initialStats: UserStat[];
  currentUserId: string;
  currentUsername: string;
  newGameSection: React.ReactNode;
}) {
  const supabase = createClient();
  const [rooms, setRooms] = useState<Room[]>(initialRooms);

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

  // ---- Filter / sort state ----
  const [gameFilter, setGameFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'playing'>('all');
  const [onlyOpen, setOnlyOpen] = useState(false);   // has at least one open seat
  const [onlyMine, setOnlyMine] = useState(false);   // I'm seated in it
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'players-desc' | 'players-asc'>('newest');

  const openAll = useMemo(() => rooms.filter(r => r.status !== 'finished'), [rooms]);

  const open = useMemo(() => {
    let list = openAll;
    if (gameFilter !== 'all')     list = list.filter(r => r.game_type === gameFilter);
    if (statusFilter !== 'all')   list = list.filter(r => r.status === statusFilter);
    if (onlyOpen)                 list = list.filter(r => maxPlayersFor(r.game_type) > r.room_players.length);
    if (onlyMine)                 list = list.filter(r => r.room_players.some(p => p.player_id === currentUserId));
    const sorted = [...list];
    if (sortBy === 'newest')        sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sortBy === 'oldest')        sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sortBy === 'players-desc')  sorted.sort((a, b) => b.room_players.length - a.room_players.length);
    if (sortBy === 'players-asc')   sorted.sort((a, b) => a.room_players.length - b.room_players.length);
    return sorted;
  }, [openAll, gameFilter, statusFilter, onlyOpen, onlyMine, sortBy, currentUserId]);

  const finished = useMemo(() => rooms.filter(r => r.status === 'finished').slice(0, 5), [rooms]);

  const filtersActive = gameFilter !== 'all' || statusFilter !== 'all' || onlyOpen || onlyMine;
  const resetFilters = () => {
    setGameFilter('all');
    setStatusFilter('all');
    setOnlyOpen(false);
    setOnlyMine(false);
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1fr_280px] lg:grid-cols-[1fr_320px]">
      {/* LEFT: new game tiles + active rooms */}
      <div className="space-y-8">
        {newGameSection}

        <section>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Active rooms</h2>
            <span className="text-sm text-neutral-400">
              {open.length}{filtersActive ? ` / ${openAll.length}` : ''} {open.length === 1 ? 'room' : 'rooms'}
            </span>
          </div>

          {/* Filter / sort toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-2 text-xs">
            {/* Game-type select */}
            <label className="flex items-center gap-1">
              <span className="text-neutral-500">Game:</span>
              <select
                value={gameFilter}
                onChange={e => setGameFilter(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
              >
                <option value="all">All</option>
                {Object.values(GAMES).map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>

            {/* Status select */}
            <label className="flex items-center gap-1">
              <span className="text-neutral-500">Status:</span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
              >
                <option value="all">Any</option>
                <option value="waiting">Waiting</option>
                <option value="playing">Playing</option>
              </select>
            </label>

            {/* Toggle chips */}
            <ToggleChip active={onlyOpen} onClick={() => setOnlyOpen(v => !v)}>Open seats only</ToggleChip>
            <ToggleChip active={onlyMine} onClick={() => setOnlyMine(v => !v)}>My rooms only</ToggleChip>

            {/* Sort select (right-aligned) */}
            <label className="ml-auto flex items-center gap-1">
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

            {filtersActive && (
              <button
                onClick={resetFilters}
                className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
              >
                Clear filters
              </button>
            )}
          </div>

          {open.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-800 p-6 text-center text-neutral-500">
              {filtersActive
                ? 'No rooms match those filters.'
                : 'No active rooms. Start a new game above or invite a friend from the right.'}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
              {open.map(r => <RoomRow key={r.id} room={r} currentUserId={currentUserId} />)}
            </ul>
          )}

          {finished.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-xl font-semibold text-neutral-400">Recently finished</h2>
              <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900/40">
                {finished.map(r => <RoomRow key={r.id} room={r} currentUserId={currentUserId} />)}
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
          initialStats={initialStats}
          className="md:max-h-[360px] md:overflow-y-auto"
        />
        <GeneralChat currentUserId={currentUserId} currentUsername={currentUsername} />
      </div>
    </div>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 transition ${
        active
          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
          : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-800'
      }`}
    >
      {children}
    </button>
  );
}

function maxPlayersFor(gameId: string): number {
  return GAMES[gameId]?.maxPlayers ?? 2;
}

function RoomRow({ room, currentUserId }: { room: Room; currentUserId: string }) {
  const game = GAMES[room.game_type]?.name ?? room.game_type;
  const max = maxPlayersFor(room.game_type);
  const seated = room.room_players.length;
  const players = room.room_players.map(p => p.profiles?.username || '???').join(', ') || '—';
  const im = room.room_players.some(p => p.player_id === currentUserId);
  const full = seated >= max;
  const cta = im ? 'Open' : full || room.status !== 'waiting' ? 'Watch' : 'Join';

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium">
          {game}
          <span className="ml-2 text-xs font-normal text-neutral-500">{seated}/{max} {seated === 1 ? 'player' : 'players'}</span>
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
