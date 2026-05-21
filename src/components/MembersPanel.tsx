'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GAMES, displayName as gameDisplayName } from '@/lib/games/registry';
import { safeAccent } from '@/lib/accentColors';
import { sounds } from '@/lib/sounds';
import { inviteToGame } from '@/app/lobby/actions';

type OnlineUser = { id: string; username: string; roomId?: string; accent?: string };
type UserStat = { user_id: string; username: string; accent_color?: string | null; wins: number; losses: number; draws: number; games: number };
type PresencePayload = { user_id: string; username: string; online_at: string; room_id?: string; accent_color?: string };

export default function MembersPanel({
  currentUserId,
  currentUsername,
  currentUserAccent,
  initialStats = [],
  className = '',
  currentRoom,
  hideInGameSection = false,
  currentGame,
  onWatcherSync,
}: {
  currentUserId: string;
  currentUsername: string;
  /** Hex color the current user picked on their profile (falls back to default emerald). */
  currentUserAccent?: string | null;
  initialStats?: UserStat[];
  className?: string;
  /**
   * If provided AND the room is `waiting` with at least one open seat, the Invite button
   * will pull the friend into THIS room instead of creating a new one.
   */
  currentRoom?: { id: string; gameType: string; status: string; openSeats: number };
  /**
   * When true, hides the "In game" header and folds those users into the Online list.
   * Used on the lobby page, where the active-rooms list already conveys who is in a game.
   */
  hideInGameSection?: boolean;
  /**
   * Drives the "In game" section: the seated players of THIS room sorted by turn
   * order, plus the user ID of whoever is currently up (hourglass).
   */
  currentGame?: {
    orderedIds: string[];
    activeId: string | null;
    usernamesById: Record<string, string>;
    /** Per-player accent color, keyed by user UUID, sourced from each
        profile. Renders each seated player's name in their preferred color. */
    accentsById?: Record<string, string | null | undefined>;
    /** ISO timestamp of when the current turn started; drives the 60s countdown
        rendered next to the active player. Null = no live turn (waiting/finished). */
    turnStartedAt?: string | null;
    /** Cumulative milliseconds each player has spent on their turns in this
        game so far. Used for the always-visible "Xm Ys" total beside every
        seated player's name. */
    timePerPlayerMs?: Record<string, number>;
  };
  /**
   * Called by MembersPanel whenever the `lobby-presence` channel syncs. The
   * argument maps roomId → set of user IDs currently on that room's page.
   * Used by LobbyClient to render "X watching" badges without subscribing to
   * the same channel twice (Supabase rejects duplicate subscribers, which is
   * how we initially crashed the lobby). Only the lobby passes this in.
   */
  onWatcherSync?: (byRoom: Record<string, Set<string>>) => void;
}) {
  const myAccent = safeAccent(currentUserAccent);
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
        // Users can have multiple presence records (e.g. lobby tab + game tab).
        // Prefer the entry with a room_id so we don't mistakenly list them as
        // "free online" when they're actively in a game in another tab — that
        // bug caused the same name to appear in both In Game and Online.
        const byUserId = new Map<string, PresencePayload>();
        const byRoom: Record<string, Set<string>> = {};
        for (const arr of Object.values(state)) {
          for (const p of arr) {
            // Watcher aggregation (lobby uses this to render "X watching" badges).
            if (p.room_id) {
              if (!byRoom[p.room_id]) byRoom[p.room_id] = new Set();
              byRoom[p.room_id].add(p.user_id);
            }
            const existing = byUserId.get(p.user_id);
            if (!existing || (!existing.room_id && p.room_id)) {
              byUserId.set(p.user_id, p);
            }
          }
        }
        const users: OnlineUser[] = [];
        for (const p of byUserId.values()) {
          users.push({ id: p.user_id, username: p.username, roomId: p.room_id, accent: p.accent_color });
        }
        users.sort((a, b) => a.username.localeCompare(b.username));
        setOnline(users);
        onWatcherSync?.(byRoom);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presence.track({
            user_id: currentUserId,
            username: currentUsername,
            online_at: new Date().toISOString(),
            room_id: currentRoom?.id,
            accent_color: myAccent,
          });
        }
      });
    return () => { supabase.removeChannel(presence); };
  }, [supabase, currentUserId, currentUsername, currentRoom?.id, myAccent]);

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
  const otherOnlineInGame = useMemo(() => otherOnline.filter(u => !!u.roomId), [otherOnline]);
  const otherOnlineFree    = useMemo(() => otherOnline.filter(u =>  !u.roomId), [otherOnline]);
  const meInGame = !!currentRoom;
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
                <span className="text-amber-400">{gameDisplayName(GAMES[inviteToast.game], inviteToast.game)}</span>
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
                  Add them to this <span className="text-emerald-400">{gameDisplayName(GAMES[currentRoom.gameType], currentRoom.gameType)}</span> room
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
                      <div className="font-medium">
                        {g.name}
                        {g.beta && (
                          <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                            Beta
                          </span>
                        )}
                      </div>
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
          {/* In game — hidden on the lobby (where the active-rooms list already covers it).
              When `currentGame` is provided, this becomes "players in THIS room, sorted by
              turn order" with an hourglass next to whoever is currently up. */}
          {!hideInGameSection && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">In game</h2>
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-400">
                  {currentGame
                    ? currentGame.orderedIds.length
                    : otherOnlineInGame.length + (meInGame ? 1 : 0)}
                </span>
              </div>
              <ul className="space-y-1">
                {currentGame && currentGame.orderedIds.length > 0 ? (
                  // Player rows stay in their original turn order for the whole
                  // game — the hourglass moves between rows but the rows don't
                  // reshuffle. Matches what players saw at the start of the match.
                  currentGame.orderedIds.map(uid => {
                    const isMe = uid === currentUserId;
                    const isActive = currentGame.activeId === uid;
                    const name = currentGame.usernamesById[uid] ?? (isMe ? currentUsername : '???');
                    // Resolve accent from the freshest available source. Live
                    // presence is most current (broadcasts on tab focus / accent
                    // changes), then the room's profile join, then my own prop,
                    // finally the default. This stops "color flipped to emerald
                    // mid-game" when any single source goes stale.
                    const accent = safeAccent(
                      online.find(u => u.id === uid)?.accent
                      ?? currentGame.accentsById?.[uid]
                      ?? (isMe ? currentUserAccent : null),
                    );
                    return (
                      <li
                        key={uid}
                        // Highlight follows the ACTIVE player (whose turn it is),
                        // not the viewer — you already know which row is you.
                        className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition ${
                          isActive ? 'bg-neutral-950' : 'hover:bg-neutral-800/60'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                          <span
                            className={`truncate ${isMe ? 'font-medium' : ''}`}
                            style={{ color: accent }}
                          >
                            {name}
                          </span>
                        </span>
                        {/* Right-side cluster: live turn-bits (countdown + hourglass)
                            slot in to the LEFT of the total-time anchor, so the total
                            stays in the same rightmost spot every row, every turn. */}
                        <span className="ml-2 flex shrink-0 items-center gap-1.5">
                          {isActive && currentGame.turnStartedAt && (
                            <TurnCountdown startIso={currentGame.turnStartedAt} limitSec={60} />
                          )}
                          {isActive && (
                            <span
                              className="text-base leading-none animate-pop"
                              title="Their turn"
                              aria-label="Their turn"
                            >
                              ⏳
                            </span>
                          )}
                          <PlayerTotalTime
                            storedMs={currentGame.timePerPlayerMs?.[uid] ?? 0}
                            liveSinceIso={isActive && currentGame.turnStartedAt ? currentGame.turnStartedAt : null}
                          />
                        </span>
                      </li>
                    );
                  })
                ) : (
                  <>
                    {meInGame && (
                      <li className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-neutral-800/60">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: myAccent }} />
                          <span className="font-medium" style={{ color: myAccent }}>{currentUsername}</span>
                        </span>
                      </li>
                    )}
                    {otherOnlineInGame.length === 0 && !meInGame ? (
                      <li className="rounded-md px-2 py-3 text-center text-xs text-neutral-500">
                        No one is playing right now.
                      </li>
                    ) : (
                      otherOnlineInGame.map(u => {
                        const accent = safeAccent(u.accent);
                        return (
                          <li key={u.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-neutral-800/60">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                              <span className="truncate" style={{ color: accent }}>{u.username}</span>
                            </span>
                          </li>
                        );
                      })
                    )}
                  </>
                )}
              </ul>
            </>
          )}

          {/* Online — collapsible like Offline, open by default. On the lobby
              (hideInGameSection), in-game users are folded into this list too. */}
          <details className={`group ${hideInGameSection ? '' : 'mt-4 border-t border-neutral-800 pt-4'}`} open>
            <summary className="mb-3 flex cursor-pointer list-none items-center justify-between select-none">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-neutral-300">
                <span className="inline-block text-neutral-600 transition-transform group-open:rotate-90">▶</span>
                Online
              </h2>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                {(hideInGameSection ? otherOnline.length : otherOnlineFree.length) + (hideInGameSection || !meInGame ? 1 : 0)}
              </span>
            </summary>
            <ul className="space-y-1">
              {(hideInGameSection || !meInGame) && (
                <li className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-neutral-800/60">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: myAccent }} />
                    <span className="font-medium" style={{ color: myAccent }}>{currentUsername}</span>
                  </span>
                </li>
              )}
            {(hideInGameSection ? otherOnline : otherOnlineFree).map(u => {
                const accent = safeAccent(u.accent);
                return (
                <li key={u.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition hover:bg-neutral-800/60">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                    <span className="truncate" style={{ color: accent }}>{u.username}</span>
                  </span>
                  {currentRoom && (
                    <button
                      onClick={() => {
                        if (canInviteToCurrent) {
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
                  )}
                </li>
                );
              })}
            </ul>
          </details>
        </div>

        <details className="group border-t border-neutral-800 pt-4">
          <summary className="mb-3 flex cursor-pointer list-none items-center justify-between select-none">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-neutral-500">
              {/* Caret rotates 90° when the section is open */}
              <span className="inline-block text-neutral-600 transition-transform group-open:rotate-90">▶</span>
              Offline
            </h2>
            <span className="rounded-full bg-neutral-700/40 px-2 py-0.5 text-xs font-medium text-neutral-400">
              {offline.length}
            </span>
          </summary>
          {offline.length === 0 ? (
            <p className="rounded-md px-2 py-3 text-center text-xs text-neutral-500">
              Nobody else has signed up yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {offline.map(u => {
                const accent = safeAccent(u.accent_color);
                return (
                <li key={u.user_id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-neutral-800/40">
                  <span className="flex min-w-0 items-center gap-2">
                    {/* Offline name keeps the colored dot but the text is dimmed
                        to grey to reinforce "not here right now" — accent still
                        survives on the dot. */}
                    <span className="h-2 w-2 shrink-0 rounded-full opacity-60" style={{ backgroundColor: accent }} />
                    <span className="truncate">{u.username}</span>
                  </span>
                  {currentRoom && (
                    <button
                      onClick={() => {
                        const target = { id: u.user_id, username: u.username };
                        if (canInviteToCurrent) {
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
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </details>
      </aside>
    </>
  );
}

/**
 * Always-visible cumulative-time badge for a player. Renders total minutes
 * (rounded down) the player has spent on their turns in this game. The
 * stored total is auto-maintained server-side by a DB trigger; when
 * `liveSinceIso` is set (this player is currently active), we add live
 * elapsed time so the value ticks up across each minute boundary.
 *
 * Anchored to the far right of the row by the parent flex container so the
 * position is stable for the whole game — the per-turn countdown + hourglass
 * sit to its LEFT and only appear for the active player.
 */
function PlayerTotalTime({
  storedMs, liveSinceIso,
}: {
  storedMs: number;
  liveSinceIso: string | null;
}) {
  const liveStart = useMemo(
    () => (liveSinceIso ? new Date(liveSinceIso).getTime() : null),
    [liveSinceIso],
  );
  const [, setTick] = useState(0);
  useEffect(() => {
    // Tick every 15s while live — minute display only flips every 60s anyway,
    // so we don't need to re-render every second here.
    if (liveStart == null) return;
    const id = setInterval(() => setTick(t => t + 1), 15000);
    return () => clearInterval(id);
  }, [liveStart]);
  const liveMs = liveStart != null ? Math.max(0, Date.now() - liveStart) : 0;
  const totalSec = Math.floor((storedMs + liveMs) / 1000);
  const minutes = Math.floor(totalSec / 60);
  return (
    <span
      className="rounded bg-neutral-800/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-400 tabular-nums"
      title={`Total time on their turns this game: ${totalSec}s`}
    >
      {minutes}m
    </span>
  );
}

/**
 * Tiny ticking badge that shows seconds remaining since `startIso`, counting
 * down from `limitSec` (default 60s). Color shifts amber under 20s, red under
 * 10s. After 0 it freezes at "0s" — no enforcement, just a social nudge.
 */
function TurnCountdown({ startIso, limitSec = 60 }: { startIso: string; limitSec?: number }) {
  const start = useMemo(() => new Date(startIso).getTime(), [startIso]);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [start]);
  const secsLeft = Math.max(0, Math.ceil(limitSec - (Date.now() - start) / 1000));
  const tone =
    secsLeft <= 10 ? 'bg-rose-500/20 text-rose-300 animate-pulse'
    : secsLeft <= 20 ? 'bg-amber-500/20 text-amber-300'
    : 'bg-neutral-800 text-neutral-400';
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ${tone}`}
      title={`${secsLeft}s left on this turn (60s suggested)`}
    >
      {secsLeft}s
    </span>
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
