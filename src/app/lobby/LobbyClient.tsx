'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GAMES } from '@/lib/games/registry';

type RoomPlayer = { player_id: string; seat: number; profiles: { username: string } | null };
type Room = {
  id: string;
  game_type: string;
  status: string;
  host_id: string;
  created_at: string;
  room_players: RoomPlayer[];
};

export default function LobbyClient({ initialRooms, currentUserId }: { initialRooms: Room[]; currentUserId: string }) {
  const supabase = createClient();
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    // Online presence
    const presence = supabase.channel('lobby-presence', { config: { presence: { key: currentUserId } } });
    presence
      .on('presence', { event: 'sync' }, () => {
        setOnlineCount(Object.keys(presence.presenceState()).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presence.track({ online_at: new Date().toISOString() });
        }
      });

    // Realtime room list
    const refresh = async () => {
      const { data } = await supabase
        .from('rooms')
        .select('id, game_type, status, host_id, created_at, room_players(player_id, seat, profiles(username))')
        .order('created_at', { ascending: false })
        .limit(30);
      setRooms((data ?? []) as unknown as Room[]);
    };

    const sub = supabase
      .channel('lobby-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players' }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(presence);
      supabase.removeChannel(sub);
    };
  }, [supabase, currentUserId]);

  const open = rooms.filter(r => r.status !== 'finished');
  const finished = rooms.filter(r => r.status === 'finished').slice(0, 5);

  return (
    <>
      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Active rooms</h2>
          <span className="text-sm text-neutral-400">{onlineCount} online</span>
        </div>
        {open.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-800 p-6 text-center text-neutral-500">
            No active rooms. Start a new game above.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
            {open.map(r => <RoomRow key={r.id} room={r} currentUserId={currentUserId} />)}
          </ul>
        )}
      </section>

      {finished.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-semibold text-neutral-400">Recently finished</h2>
          <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900/40">
            {finished.map(r => <RoomRow key={r.id} room={r} currentUserId={currentUserId} />)}
          </ul>
        </section>
      )}
    </>
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
