'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GAMES } from '@/lib/games/registry';
import { sounds } from '@/lib/sounds';
import { inviteToGame } from './actions';

type RoomPlayer = { player_id: string; seat: number; profiles: { username: string } | null };
type Room = {
  id: string;
  game_type: string;
  status: string;
  host_id: string;
  created_at: string;
  room_players: RoomPlayer[];
};
type OnlineUser = { id: string; username: string };
type UserStat = { user_id: string; wins: number; losses: number; draws: number; games: number };

type PresencePayload = { user_id: string; username: string; online_at: string };

export default function LobbyClient({
  initialRooms, initialStats, currentUserId, currentUsername,
}: {
  initialRooms: Room[];
  initialStats: UserStat[];
  currentUserId: string;
  currentUsername: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [stats, setStats] = useState<Map<string, UserStat>>(
    new Map(initialStats.map(s => [s.user_id, s]))
  );
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [invitee, setInvitee] = useState<OnlineUser | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [inviteToast, setInviteToast] = useState<{ from: string; roomId: string; game: string } | null>(null);

  // Online presence — every lobby viewer publishes themselves and listens for others.
  useEffect(() => {
    const presence = supabase.channel('lobby-presence', {
      config: { presence: { key: currentUserId } },
    });
    presence
      .on('presence', { event: 'sync' }, () => {
        const state = presence.presenceState<PresencePayload>();
        const users: OnlineUser[] = [];
        const seen = new Set<string>();
        for (const arr of Object.values(state)) {
          for (const p of arr) {
            if (!seen.has(p.user_id)) {
              seen.add(p.user_id);
              users.push({ id: p.user_id, username: p.username });
            }
          }
        }
        users.sort((a, b) => a.username.localeCompare(b.username));
        setOnline(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presence.track({
            user_id: currentUserId,
            username: currentUsername,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => { supabase.removeChannel(presence); };
  }, [supabase, currentUserId, currentUsername]);

  // Realtime room list updates + stats refresh when a game finishes
  useEffect(() => {
    const refreshRooms = async () => {
      const { data } = await supabase
        .from('rooms')
        .select('id, game_type, status, host_id, created_at, room_players(player_id, seat, profiles(username))')
        .order('created_at', { ascending: false })
        .limit(30);
      setRooms((data ?? []) as unknown as Room[]);
    };
    const refreshStats = async () => {
      const { data } = await supabase
        .from('user_stats')
        .select('user_id, wins, losses, draws, games');
      if (data) setStats(new Map(data.map(s => [s.user_id, s as UserStat])));
    };
    const sub = supabase
      .channel('lobby-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' },         refreshRooms)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players' },  refreshRooms)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_history' }, refreshStats)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [supabase]);

  // User-specific channel for direct invites
  useEffect(() => {
    const ch = supabase.channel(`user:${currentUserId}`, {
      config: { broadcast: { ack: false } },
    });
    ch.on('broadcast', { event: 'invite' }, ({ payload }) => {
      const p = payload as { from: string; roomId: string; game: string };
      sounds.notify();
      setInviteToast(p);
    });
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentUserId]);

  const open = useMemo(() => rooms.filter(r => r.status !== 'finished'), [rooms]);
  const finished = useMemo(() => rooms.filter(r => r.status === 'finished').slice(0, 5), [rooms]);
  const otherOnline = useMemo(() => online.filter(u => u.id !== currentUserId), [online, currentUserId]);

  async function doInvite(target: OnlineUser, gameType: string) {
    setInviteError(null);
    startTransition(async () => {
      try {
        const { roomId } = await inviteToGame(target.id, gameType);
        // notify the invitee in real time
        const notify = supabase.channel(`user:${target.id}`);
        notify.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await notify.send({
              type: 'broadcast',
              event: 'invite',
              payload: { from: currentUsername, roomId, game: gameType },
            });
            supabase.removeChannel(notify);
          }
        });
        setInvitee(null);
        router.push(`/rooms/${roomId}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not send invite';
        setInviteError(msg);
      }
    });
  }

  return (
    <>
      {/* Invite toast */}
      {inviteToast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-toast-in">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-neutral-900 px-4 py-3 shadow-xl shadow-emerald-500/20">
            <span className="text-2xl">🎮</span>
            <div className="text-sm">
              <div className="font-medium">
                <span className="text-emerald-400">{inviteToast.from}</span> invited you to play{' '}
                <span className="text-amber-400">{GAMES[inviteToast.game]?.name ?? inviteToast.game}</span>
              </div>
            </div>
            <Link
              href={`/rooms/${inviteToast.roomId}`}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
              onClick={() => setInviteToast(null)}
            >
              Join
            </Link>
            <button
              onClick={() => setInviteToast(null)}
              className="rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {invitee && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/70 p-4"
          onClick={() => setInvitee(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Invite {invitee.username}</h3>
            <p className="mt-1 text-sm text-neutral-400">Pick a game:</p>
            <div className="mt-4 grid gap-2">
              {Object.values(GAMES).map(g => (
                <button
                  key={g.id}
                  disabled={pending}
                  onClick={() => doInvite(invitee, g.id)}
                  className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-left transition hover:border-emerald-500 disabled:opacity-50"
                >
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-neutral-400">{g.description}</div>
                </button>
              ))}
            </div>
            {inviteError && (
              <p className="mt-3 rounded-md border border-red-900/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {inviteError}
              </p>
            )}
            <button
              onClick={() => { setInvitee(null); setInviteError(null); }}
              className="mt-4 w-full rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px] lg:grid-cols-[1fr_280px]">
        {/* LEFT: active rooms */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Active rooms</h2>
            <span className="text-sm text-neutral-400">{open.length} active · {online.length} online</span>
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

        {/* RIGHT: online users */}
        <aside className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">Online</h2>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
              {online.length}
            </span>
          </div>
          <ul className="space-y-1">
            <li className="flex items-center justify-between rounded-md bg-neutral-950 px-2 py-1.5 text-sm">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-medium text-emerald-400">{currentUsername}</span>
                <span className="text-xs text-neutral-500">(you)</span>
              </span>
              <WinRateBadge stat={stats.get(currentUserId)} />
            </li>
            {otherOnline.length === 0 ? (
              <li className="rounded-md px-2 py-3 text-center text-xs text-neutral-500">
                Nobody else online right now.
              </li>
            ) : (
              otherOnline.map(u => (
                <li key={u.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-neutral-800/60">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <span className="truncate">{u.username}</span>
                    <WinRateBadge stat={stats.get(u.id)} />
                  </span>
                  <button
                    onClick={() => setInvitee(u)}
                    disabled={pending}
                    className="ml-2 shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500 hover:text-neutral-950 disabled:opacity-50"
                  >
                    Invite
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>
      </div>
    </>
  );
}

function WinRateBadge({ stat }: { stat?: UserStat }) {
  if (!stat || stat.games === 0) {
    return <span className="text-xs text-neutral-600" title="No games yet">—</span>;
  }
  const pct = Math.round((stat.wins / stat.games) * 100);
  const tone =
    pct >= 60 ? 'bg-emerald-500/15 text-emerald-400' :
    pct >= 40 ? 'bg-sky-500/15 text-sky-400'         :
                'bg-neutral-700/30 text-neutral-300';
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${tone}`}
      title={`${stat.wins}W · ${stat.losses}L · ${stat.draws}D · ${stat.games} games`}
    >
      {pct}%
    </span>
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
