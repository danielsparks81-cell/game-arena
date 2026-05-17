'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GAMES } from '@/lib/games/registry';
import { sounds } from '@/lib/sounds';
import { inviteToGame } from '@/app/lobby/actions';

type OnlineUser = { id: string; username: string };
type UserStat = { user_id: string; username: string; wins: number; losses: number; draws: number; games: number };
type PresencePayload = { user_id: string; username: string; online_at: string };

export default function MembersPanel({
  currentUserId,
  currentUsername,
  initialStats = [],
  className = '',
  currentRoom,
}: {
  currentUserId: string;
  currentUsername: string;
  initialStats?: UserStat[];
  className?: string;
  /**
   * If provided AND the room is `waiting` with at least one open seat, the Invite button
   * will pull the friend into THIS room instead of creating a new one.
   */
  currentRoom?: { id: string; gameType: string; status: string; openSeats: number };
}) {
  const supabase = createClient();
  const router = useRouter();
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [stats, setStats] = useState<Map<string, UserStat>>(
    new Map(initialStats.map(s => [s.user_id, s]))
  );
  const [invitee, setInvitee] = useState<OnlineUser | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [inviteToast, setInviteToast] = useState<{ from: string; roomId: string; game: string } | null>(null);

  // Online presence (uses a single shared channel so presence is global across pages)
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

  // Stats — fetch on mount if no initial data, then refresh whenever a game finishes.
  useEffect(() => {
    const refresh = async () => {
      const { data } = await supabase
        .from('user_stats')
        .select('user_id, username, wins, losses, draws, games');
      if (data) setStats(new Map(data.map(s => [s.user_id, s as UserStat])));
    };
    if (initialStats.length === 0) refresh();
    const sub = supabase
      .channel('members-stats')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_history' }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [supabase, initialStats.length]);

  // Incoming invites toast — works on any page that mounts MembersPanel.
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

  const otherOnline = useMemo(() => online.filter(u => u.id !== currentUserId), [online, currentUserId]);
  const offline = useMemo(() => {
    const onlineIds = new Set(online.map(u => u.id));
    return Array.from(stats.values())
      .filter(s => !onlineIds.has(s.user_id) && s.user_id !== currentUserId)
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [stats, online, currentUserId]);

  const canInviteToCurrent =
    !!currentRoom && currentRoom.status === 'waiting' && currentRoom.openSeats > 0;

  async function doInvite(target: OnlineUser, gameType: string) {
    setInviteError(null);
    startTransition(async () => {
      try {
        let roomId: string;
        let game: string;
        let createdNewRoom = false;

        if (canInviteToCurrent && currentRoom) {
          // Pull the friend into the room we're already in
          roomId = currentRoom.id;
          game = currentRoom.gameType;
        } else {
          // Spin up a new room for the chosen game
          const res = await inviteToGame(target.id, gameType);
          roomId = res.roomId;
          game = gameType;
          createdNewRoom = true;
        }

        // Broadcast the invite toast to the target's user channel
        const notify = supabase.channel(`user:${target.id}`);
        notify.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await notify.send({
              type: 'broadcast',
              event: 'invite',
              payload: { from: currentUsername, roomId, game },
            });
            supabase.removeChannel(notify);
          }
        });

        setInvitee(null);
        // Only navigate if we actually created a new room (don't bounce out of the current one)
        if (createdNewRoom) router.push(`/rooms/${roomId}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not send invite';
        setInviteError(msg);
      }
    });
  }

  return (
    <>
      {inviteToast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-toast-in">
          <div className="flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-emerald-500/40 bg-neutral-900 px-4 py-3 shadow-xl shadow-emerald-500/20">
            <span className="text-2xl">🎮</span>
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium">
                <span className="text-emerald-400">{inviteToast.from}</span> invited you to play{' '}
                <span className="text-amber-400">{GAMES[inviteToast.game]?.name ?? inviteToast.game}</span>
              </div>
            </div>
            <Link
              href={`/rooms/${inviteToast.roomId}`}
              className="shrink-0 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400"
              onClick={() => setInviteToast(null)}
            >
              Join
            </Link>
            <button
              onClick={() => setInviteToast(null)}
              className="shrink-0 rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {invitee && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/70 p-4"
          onClick={() => { setInvitee(null); setInviteError(null); }}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Invite {invitee.username}</h3>

            {canInviteToCurrent && currentRoom ? (
              <>
                <p className="mt-1 text-sm text-neutral-400">
                  Add them to this <span className="text-emerald-400">{GAMES[currentRoom.gameType]?.name ?? currentRoom.gameType}</span> room
                  ({currentRoom.openSeats} {currentRoom.openSeats === 1 ? 'seat' : 'seats'} open).
                </p>
                <button
                  disabled={pending}
                  onClick={() => doInvite(invitee, currentRoom.gameType)}
                  className="mt-4 w-full rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  Invite to this room
                </button>
              </>
            ) : (
              <>
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
              </>
            )}

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

      <aside className={`space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4 ${className}`}>
        <div>
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
                    onClick={() => {
                      // Inside a waiting room with seats open → invite directly, skip the picker
                      if (canInviteToCurrent && currentRoom) {
                        doInvite(u, currentRoom.gameType);
                      } else {
                        setInvitee(u);
                      }
                    }}
                    disabled={pending}
                    className="ml-2 shrink-0 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500 hover:text-neutral-950 disabled:opacity-50"
                  >
                    Invite
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="border-t border-neutral-800 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">Offline</h2>
            <span className="rounded-full bg-neutral-700/40 px-2 py-0.5 text-xs font-medium text-neutral-400">
              {offline.length}
            </span>
          </div>
          {offline.length === 0 ? (
            <p className="rounded-md px-2 py-3 text-center text-xs text-neutral-500">
              Nobody else has signed up yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {offline.map(u => (
                <li key={u.user_id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-neutral-800/40">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-neutral-600" />
                    <span className="truncate">{u.username}</span>
                    <WinRateBadge stat={u} />
                  </span>
                  <button
                    onClick={() => {
                      const target = { id: u.user_id, username: u.username };
                      if (canInviteToCurrent && currentRoom) {
                        doInvite(target, currentRoom.gameType);
                      } else {
                        setInvitee(target);
                      }
                    }}
                    disabled={pending}
                    title="They won't see a popup, but the room you create will appear in their lobby when they log in"
                    className="ml-2 shrink-0 rounded-md border border-neutral-700 px-2 py-0.5 text-xs font-medium text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200 disabled:opacity-50"
                  >
                    Invite
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

function WinRateBadge({ stat }: { stat?: UserStat }) {
  const decisive = stat ? stat.wins + stat.losses : 0;
  if (!stat || decisive === 0) {
    return <span className="text-xs text-neutral-600" title="No decisive games yet">—</span>;
  }
  const pct = Math.round((stat.wins / decisive) * 100);
  const tone =
    pct >= 60 ? 'bg-emerald-500/15 text-emerald-400' :
    pct >= 40 ? 'bg-sky-500/15 text-sky-400'         :
                'bg-neutral-700/30 text-neutral-300';
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${tone}`}
      title={`${stat.wins}W · ${stat.losses}L · ${stat.draws}D · ${pct}% (draws not counted)`}
    >
      {pct}%
    </span>
  );
}
