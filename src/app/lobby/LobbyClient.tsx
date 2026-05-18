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

  const open = useMemo(() => rooms.filter(r => r.status !== 'finished'), [rooms]);
  const finished = useMemo(() => rooms.filter(r => r.status === 'finished').slice(0, 5), [rooms]);

  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1fr_260px] lg:grid-cols-[1fr_280px]">
      {/* LEFT: new game tiles + active rooms */}
      <div className="space-y-8">
        {newGameSection}

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Active rooms</h2>
            <span className="text-sm text-neutral-400">{open.length} active</span>
          </div>
          {open.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-800 p-6 text-center text-neutral-500">
              No active rooms. Start a new game above or invite a friend from the right.
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

function RoomRow({ room, currentUserId }: { room: Room; currentUserId: string }) {
  const game = GAMES[room.game_type]?.name ?? room.game_type;
  const players = room.room_players.map(p => p.profiles?.username || '???').join(', ') || '—';
  const im = room.room_players.some(p => p.player_id === currentUserId);
  const full = room.room_players.length >= 2;
  const cta = im ? 'Open' : full || room.status !== 'waiting' ? 'Watch' : 'Join';

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <div className="font-medium">{game}</div>
        <div className="text-sm text-neutral-400">{players}</div>
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
