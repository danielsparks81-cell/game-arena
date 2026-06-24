'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GAMES, GAME_GUIDES, displayName as gameDisplayName } from '@/lib/games/registry';
import { sounds } from '@/lib/sounds';
import MembersPanel from '@/components/MembersPanel';
import GeneralChat from '@/components/GeneralChat';
import TopBar from '@/components/TopBar';
import RoomTopBarActions from '@/components/RoomTopBarActions';
import RematchToast from '@/components/RematchToast';
import GameViewport from '@/components/GameViewport';
import { BOARD_RENDERERS } from '@/lib/games/boards';

// Per-game logical canvas width. The GameViewport scales each game to fit the
// available area at this design width (keeping aspect). Full-width / flexible
// games NEED a value; tune as games are designed ~16:9. HeroQuest is omitted
// (it has its own board zoom).
//
// Pick a width close to the widest common play area (≈ a 1080p/1440p viewport
// with the chat hidden) so text-heavy boards render near 1× there — scaling UP
// past the design width softens text (upscaling can't add detail), while
// scaling DOWN with the chat open stays crisp.
const GAME_DESIGN_WIDTH: Record<string, number> = {
  legendary: 1800,
  longshot: 1800,
  spellduel: 1100,
  battleship: 960,
  yahtzee: 980,
  checkers: 680,
  liarsdice: 820,
  boggle: 720,
  tictactoe: 560,
  rps: 600,
};

// Crispness-first: GameViewport never upscales past native by default (maxScale
// 1) so text stays sharp — extra room is letterboxed. Only small, pure-shape
// games (no dense text to soften) opt into scaling UP to fill the screen; their
// vector boards scale crisply. Anything text/card/dice-heavy stays at 1.
const GAME_MAX_SCALE: Record<string, number> = {
  tictactoe: 1.9,
  rps: 1.9,
  checkers: 1.7,
  battleship: 1.4,
};
import { getTurnInfo } from '@/lib/games/turnOrder';
import { useTurnNotification } from '@/lib/useTurnNotification';
import { safeAccent } from '@/lib/accentColors';
import { fetchRoom, joinRoom, kickPlayer, sendChat } from './actions';

type RoomPlayer = { player_id: string; seat: number; profiles: { username: string; accent_color?: string | null } | null };
type Room = {
  id: string;
  game_type: string;
  status: string;
  host_id: string;
  state: unknown;
  max_players: number;
  rematch_votes: string[];
  abandon_votes: string[];
  turn_started_at: string | null;
  time_per_player: Record<string, number> | null;
  room_players: RoomPlayer[];
};
type ChatMsg = {
  id: number; body: string; created_at: string;
  sender_id: string; profiles: { username: string; accent_color?: string | null } | null;
};

// ROOM_SELECT used to live here for the client-side refetch — moved into
// fetchRoom (server action) along with the per-viewer state projection.

export default function RoomClient({
  roomId, currentUserId, currentUsername, currentUserAccent, currentUserEmail, initialRoom, initialMessages,
}: {
  roomId: string;
  currentUserId: string;
  currentUsername: string;
  currentUserAccent?: string | null;
  currentUserEmail: string | null;
  initialRoom: Room;
  initialMessages: ChatMsg[];
}) {
  const supabase = createClient();
  const [room, setRoom] = useState<Room>(initialRoom);
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  // Sidebar collapse state — persisted PER GAME so the player's preference sticks
  // independently for each game. With no saved preference, HeroScape defaults
  // COLLAPSED (its board wants the full width); every other game defaults expanded
  // so newcomers see chat + members.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`roomSidebarCollapsed:${room.game_type}`);
      setSidebarCollapsed(saved === null ? room.game_type === 'heroscape' : saved === '1');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { localStorage.setItem(`roomSidebarCollapsed:${room.game_type}`, sidebarCollapsed ? '1' : '0'); } catch {}
  }, [sidebarCollapsed, room.game_type]);

  const imSeated = room.room_players.some(p => p.player_id === currentUserId);

  // Auto-join if seat available and not seated yet
  useEffect(() => {
    if (!imSeated && room.status === 'waiting' && room.room_players.length < room.max_players) {
      startTransition(() => { joinRoom(roomId); });
    }
  }, [imSeated, room.status, room.room_players.length, room.max_players, roomId]);

  // Realtime subscriptions — broadcast is the primary channel, postgres_changes is a fallback.
  useEffect(() => {
    const refreshRoom = async () => {
      // Route through the server action so the private zones (opponent's hand,
      // decks for games that hide them) get projected away before the row
      // crosses the wire. A direct supabase.from('rooms')... here would leak
      // raw state at the network layer.
      try {
        const data = await fetchRoom(roomId);
        if (data) setRoom(data as Room);
      } catch {
        // Most likely cause: the room was deleted (e.g. stale-room sweep).
        // Silently no-op; the postgres_changes fallback will sort us out.
      }
    };

    const refreshMessages = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, body, created_at, sender_id, profiles(username, accent_color)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (data) setMessages(data as unknown as ChatMsg[]);
    };

    const ch = supabase.channel(`room-${roomId}`)
      // Primary: server actions broadcast on this channel after any DB mutation.
      .on('broadcast', { event: 'room-changed' }, () => {
        refreshRoom();
        refreshMessages();
      })
      // Fallback: postgres_changes if broadcast is missed.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms',        filter: `id=eq.${roomId}` },     refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, refreshRoom)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const m = payload.new as { id: number; body: string; created_at: string; sender_id: string };
          const { data: prof } = await supabase
            .from('profiles').select('username, accent_color').eq('id', m.sender_id).single();
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, { ...m, profiles: prof ? { username: prof.username, accent_color: prof.accent_color } : null }]);
        })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [supabase, roomId]);

  // Sound effects: detect moves and game end
  const prevWinnerRef = useRef<unknown>(null);
  const prevMoveRef   = useRef<number>(0);
  useEffect(() => {
    const s = room.state as { winner?: unknown; board?: unknown };
    const winner = s?.winner ?? null;
    const moveCount = countMoves(s);

    if (winner && !prevWinnerRef.current) {
      if (winner === 'draw') sounds.draw();
      else sounds.win();
    } else if (moveCount > prevMoveRef.current) {
      if (room.game_type === 'connect4') sounds.drop();
      else sounds.click();
    }
    prevWinnerRef.current = winner;
    prevMoveRef.current = moveCount;
  }, [room.state, room.game_type]);

  // "And they're off!" announcement when a Long Shot race transitions from waiting → playing
  const prevStatusRef = useRef<string>(initialRoom.status);
  useEffect(() => {
    if (
      prevStatusRef.current === 'waiting' &&
      room.status === 'playing' &&
      room.game_type === 'longshot'
    ) {
      sounds.theyreOff();
    }
    prevStatusRef.current = room.status;
  }, [room.status, room.game_type]);

  const gameName = gameDisplayName(GAMES[room.game_type], room.game_type);
  const finished = room.status === 'finished';

  // Hold the "Rematch?" prompt back for a grace period after a FRESH finish, so a
  // final dice-roll / win animation can play out first instead of being spoiled by
  // the prompt popping up mid-roll. (Loading into an already-finished room shows it
  // promptly — there's no animation to wait for.)
  const [showRematch, setShowRematch] = useState(finished);
  const wasFinishedOnMount = useRef(finished);
  // The HeroScape board broadcasts while its dice-roll overlay is on screen; hold the prompt
  // until the final (game-winning) roll has finished playing instead of spoiling it mid-roll.
  const [diceBusy, setDiceBusy] = useState(false);
  const sawOverlayRef = useRef(false);
  useEffect(() => {
    const onDice = (e: Event) => setDiceBusy(!!(e as CustomEvent).detail?.active);
    window.addEventListener('hs:dice-overlay', onDice);
    return () => window.removeEventListener('hs:dice-overlay', onDice);
  }, []);
  useEffect(() => { if (diceBusy) sawOverlayRef.current = true; }, [diceBusy]);
  useEffect(() => {
    if (!finished) { setShowRematch(false); sawOverlayRef.current = false; return; }
    if (wasFinishedOnMount.current) { setShowRematch(true); return; }
    if (diceBusy) { setShowRematch(false); return; } // a final dice-roll overlay is still playing
    // Show just after the winning roll's overlay ends; with no overlay (other games / a non-attack
    // finish) keep the original grace period so their own end animations aren't spoiled.
    const delay = sawOverlayRef.current ? 700 : 2800;
    const t = setTimeout(() => setShowRematch(true), delay);
    return () => clearTimeout(t);
  }, [finished, diceBusy]);

  // Ping the player when the turn cycles back to them (and the tab is in the
  // background). No-op if they haven't granted browser-notification permission.
  const activeIdNow = getTurnInfo(room.game_type, room.state).activeId;
  useTurnNotification({
    activeId: activeIdNow,
    currentUserId,
    gameName,
    enabled: imSeated && room.status === 'playing',
  });

  const iVoted = room.rematch_votes?.includes(currentUserId) ?? false;
  const otherSeated = room.room_players.filter(p => p.player_id !== currentUserId);
  const allOthersVoted = otherSeated.length > 0
    && otherSeated.every(p => room.rematch_votes?.includes(p.player_id));
  const unvotedOthers = otherSeated.filter(p => !room.rematch_votes?.includes(p.player_id));

  // TopBar center actions are visible only mid-game to seated players. Resign is
  // hidden in 3+ player games (use Propose Abandon there).
  const showRoomActions = imSeated && room.status === 'playing';
  const abandonVotes = (room.abandon_votes ?? []).length;
  const iVotedAbandon = (room.abandon_votes ?? []).includes(currentUserId);

  // Single-level Undo for Legendary. state.undo is set by the engine after any
  // action that revealed no hidden information AND belongs to this viewer's
  // seat. The snapshot itself was stripped by projection — we only need the
  // {seat,label} marker to know whether to render the button.
  const mySeat = room.room_players.find(p => p.player_id === currentUserId)?.seat;
  const undoMarker = (() => {
    if (room.game_type !== 'legendary' || !showRoomActions || mySeat === undefined) return null;
    const u = (room.state as { undo?: { seat: number; label: string } } | null)?.undo;
    if (!u || u.seat !== mySeat) return null;
    return { label: u.label };
  })();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        username={currentUsername || currentUserEmail || 'player'}
        centerSlot={showRoomActions ? (
          <RoomTopBarActions
            roomId={roomId}
            isTwoPlayerGame={room.max_players === 2}
            abandonVotes={abandonVotes}
            seatedCount={room.room_players.length}
            iVoted={iVotedAbandon}
            undo={undoMarker}
          />
        ) : undefined}
      />
    <main className={`mx-auto grid w-full max-w-[2200px] flex-1 grid-cols-1 gap-2 overflow-x-clip p-2 lg:min-h-0 lg:overflow-hidden lg:grid-rows-[minmax(0,1fr)] ${sidebarCollapsed ? '' : 'lg:grid-cols-[1fr_320px]'}`}>
      {/* Sidebar collapse toggle — always visible at top-right of the viewport
          on desktop. Hidden on mobile (where the sidebar already stacks below). */}
      <button
        type="button"
        onClick={() => setSidebarCollapsed(v => !v)}
        className="fixed top-20 right-3 z-40 hidden h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/90 text-neutral-300 shadow-lg backdrop-blur-sm transition hover:border-neutral-500 hover:bg-neutral-800 hover:text-white lg:flex"
        title={sidebarCollapsed ? 'Show members + chat panel' : 'Hide members + chat panel for more board space'}
        aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        {sidebarCollapsed ? '◀' : '▶'}
      </button>
      <section className="min-w-0">
        {/* Per-game board via the BOARD_RENDERERS map (adding a game = one entry
            there). Both the waiting lobby (seats + setup) and the live board
            route through GameViewport, which scales them to fit the screen —
            keeping aspect and letterboxing the spare dimension. HeroQuest's live
            board is the exception (it has its own zoom). The How-to-play guide
            sits at the very bottom of the window while waiting. */}
        {(() => {
          const board = BOARD_RENDERERS[room.game_type]?.({
            roomId,
            currentUserId,
            isHost: room.host_id === currentUserId,
            status: room.status,
            state: room.state,
            maxPlayers: room.max_players,
            playerCount: room.room_players.length,
            pending,
            startTransition,
          });

          if (room.status === 'waiting') {
            return (
              <>
                <GameViewport designWidth={GAME_DESIGN_WIDTH[room.game_type] ?? 1200}>
                  <div className="w-full">
                    <Seats
                      room={room}
                      currentUserId={currentUserId}
                      onKick={room.host_id === currentUserId
                        ? (pid) => startTransition(() => { kickPlayer(roomId, pid); })
                        : undefined}
                    />
                    {board}
                  </div>
                </GameViewport>
                <div className="mx-auto mt-3 w-full max-w-[1440px]">
                  <GameGuidePanel gameId={room.game_type} gameName={gameName} />
                </div>
              </>
            );
          }

          if (room.game_type === 'heroquest') {
            // Full-width: the board's own fit-to-window logic sizes the 32x23
            // grid to the available area, so don't cap it at 1440.
            return <div className="w-full">{board}</div>;
          }
          // Legendary renders at native size (NO transform scaling): it's a
          // fluid grid that fills the column width crisply at a locked font
          // size, and any trigger/prompt extends BELOW the board and scrolls
          // rather than rescaling the whole board. Scaling-to-fit is wrong here
          // because a prompt appearing would shrink the entire board.
          if (room.game_type === 'legendary') {
            return <div className="w-full">{board}</div>;
          }
          // HeroScape's live board is responsive (the draft fills the width; the
          // play view pins to viewport height with the map filling the center),
          // so render it full-width rather than scaling it to a fixed design
          // width and letterboxing the spare space.
          if (room.game_type === 'heroscape') {
            return <div className="w-full">{board}</div>;
          }
          return <GameViewport designWidth={GAME_DESIGN_WIDTH[room.game_type]} maxScale={GAME_MAX_SCALE[room.game_type]}>{board}</GameViewport>;
        })()}
      </section>

      <div className={`space-y-4 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
        {/* Game header — moved here from the left section so the board gets full width.
            The bug-report button now lives in the TopBar (site-wide). */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h1 className="text-lg font-semibold sm:text-xl">{gameName}</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            Room <code className="text-neutral-300">{roomId.slice(0, 8)}</code> · {room.status}
          </p>
        </div>

        <MembersPanel
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentRoom={{
            id: roomId,
            gameType: room.game_type,
            status: room.status,
            openSeats: Math.max(0, room.max_players - room.room_players.length),
          }}
          currentUserAccent={currentUserAccent}
          currentGame={(() => {
            const { orderedIds, activeId } = getTurnInfo(room.game_type, room.state);
            const usernamesById: Record<string, string> = {};
            const accentsById: Record<string, string | null | undefined> = {};
            for (const rp of room.room_players) {
              if (rp.profiles?.username) usernamesById[rp.player_id] = rp.profiles.username;
              accentsById[rp.player_id] = rp.profiles?.accent_color ?? null;
            }
            return {
              orderedIds,
              activeId,
              usernamesById,
              accentsById,
              // Active player's turn started here. Used for the 60-second countdown
              // shown next to the hourglass. Null while waiting / finished.
              turnStartedAt: room.status === 'playing' ? room.turn_started_at : null,
              // Cumulative ms per player UUID across the whole game so far,
              // auto-maintained by a DB trigger on every state change.
              timePerPlayerMs: room.time_per_player ?? {},
            };
          })()}
          className="lg:max-h-[360px] lg:overflow-y-auto"
        />
      <RoomChatPanel
        roomId={roomId}
        currentUserId={currentUserId}
        currentUsername={currentUsername || currentUserEmail || 'player'}
        currentUserAccent={currentUserAccent}
        messages={messages}
        draft={draft}
        setDraft={setDraft}
        imSeated={imSeated}
        onSend={(v) => { setDraft(''); startTransition(() => { sendChat(roomId, v); }); }}
      />
      </div>
    </main>
    <RematchToast
      roomId={roomId}
      finished={showRematch}
      imSeated={imSeated}
      iVoted={iVoted}
      voteTally={(room.rematch_votes ?? []).filter(id =>
        room.room_players.some(p => p.player_id === id)
      ).length}
      totalSeated={room.room_players.length}
      otherSeated={otherSeated.map(p => ({ player_id: p.player_id, profiles: p.profiles }))}
      unvotedOthers={unvotedOthers.map(p => ({ player_id: p.player_id, profiles: p.profiles }))}
      allOthersVoted={allOthersVoted}
    />
    </div>
  );
}

function countMoves(s: unknown): number {
  if (!s || typeof s !== 'object') return 0;
  const obj = s as { board?: unknown };
  if (!obj.board) return 0;
  if (Array.isArray(obj.board) && obj.board.length > 0 && Array.isArray(obj.board[0])) {
    // 2D board (connect4)
    return (obj.board as unknown[][]).reduce((acc, row) => acc + row.filter(c => c !== null).length, 0);
  }
  // Flat board (tictactoe)
  return (obj.board as unknown[]).filter(c => c !== null).length;
}

const SEAT_LABELS: Record<string, string[]> = {
  tictactoe: ['X', 'O'],
  connect4:  ['Red', 'Yellow'],
};

function Seats({
  room, currentUserId, onKick,
}: {
  room: Room;
  currentUserId: string;
  /** Provided only when the viewer is the host. Renders a small × button on
      every occupied non-self seat. Host can boot AFK or unwanted joiners
      before the game starts. */
  onKick?: (playerId: string) => void;
}) {
  const labels = SEAT_LABELS[room.game_type];
  const seated = [...room.room_players].sort((a, b) => a.seat - b.seat);
  const slots = Array.from({ length: room.max_players }, (_, i) => seated.find(p => p.seat === i));
  // A centered row of seats (wraps if there are many). 2-player rooms split the
  // width; 3+ use fixed-width tiles centered as a group.
  return (
    <div className="mb-4 flex flex-wrap justify-center gap-2">
      {slots.map((p, i) => {
        const canKick = !!onKick && !!p && p.player_id !== currentUserId;
        return (
          <div key={i} className={`relative rounded-lg border px-3 py-2 text-sm ${room.max_players <= 2 ? 'flex-1' : 'w-40'} ${
            p ? 'border-neutral-700 bg-neutral-900' : 'border-dashed border-neutral-800 text-neutral-500'
          }`}>
            <div className="text-xs text-neutral-500">
              Seat {i + 1}{labels?.[i] ? ` (${labels[i]})` : ''}
            </div>
            <div className={`truncate ${p?.player_id === currentUserId ? 'font-semibold text-emerald-400' : ''}`}>
              {p?.profiles?.username || 'Waiting…'}
            </div>
            {canKick && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Kick ${p!.profiles?.username ?? 'this player'} from the room?`)) {
                    onKick!(p!.player_id);
                  }
                }}
                title="Kick this player (host only — pre-game only)"
                aria-label={`Kick ${p!.profiles?.username ?? 'player'}`}
                className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-rose-700/40 bg-neutral-950 text-xs text-rose-300 transition hover:border-rose-500 hover:bg-rose-500/20"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "How to play" panel shown in a room's waiting lobby — theme → objective →
 *  rules for the room's game. Mirrors the lobby tile's hover guide so players
 *  can read the rules while waiting for the game to start. */
function GameGuidePanel({ gameId, gameName }: { gameId: string; gameName: string }) {
  const guide = GAME_GUIDES[gameId];
  if (!guide) return null;
  return (
    <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">How to play</span>
        <span className="text-sm font-semibold text-neutral-200">{gameName}</span>
      </div>
      <p className="mb-3 text-sm leading-snug text-neutral-300">{guide.theme}</p>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Objective</div>
      <p className="mb-3 text-sm leading-snug text-neutral-300">{guide.objective}</p>

      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Rules</div>
      <ul className="space-y-1.5">
        {guide.rules.map((r, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug text-neutral-300">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-600" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── RoomChatPanel ────────────────────────────────────────────────────────────
// In-game chat widget with a Game / Global toggle.
// • Game tab  — room-scoped messages (existing chat_messages table).
// • Global tab — site-wide general_chat_messages via GeneralChat (embedded mode).
// • New-message glow on whichever tab is NOT active when a message arrives.
// • Timestamps on every message (small, right-aligned).

const CHAT_GAP_MS = 15 * 60 * 1000;

function formatMsgTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

function ChatTimeDivider({ iso }: { iso: string }) {
  const label = formatMsgTime(iso);
  if (!label) return null;
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex-1 border-t border-neutral-800" />
      <span className="text-[10px] tabular-nums text-neutral-600 select-none">{label}</span>
      <div className="flex-1 border-t border-neutral-800" />
    </div>
  );
}

function RoomChatPanel({
  roomId, currentUserId, currentUsername, currentUserAccent,
  messages, draft, setDraft, imSeated, onSend,
}: {
  roomId: string;
  currentUserId: string;
  currentUsername: string;
  currentUserAccent?: string | null;
  messages: ChatMsg[];
  draft: string;
  setDraft: (v: string) => void;
  imSeated: boolean;
  onSend: (v: string) => void;
}) {
  const [tab, setTab] = useState<'game' | 'global'>('game');
  const [gameUnread, setGameUnread] = useState(false);
  const [globalUnread, setGlobalUnread] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Clear unread badge when switching to that tab.
  const switchTab = (t: 'game' | 'global') => {
    setTab(t);
    if (t === 'game') setGameUnread(false);
    if (t === 'global') setGlobalUnread(false);
  };

  // Game chat unread: watch messages length while on global tab.
  const prevGameLen = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevGameLen.current && tab === 'global') {
      setGameUnread(true);
    }
    prevGameLen.current = messages.length;
  }, [messages.length, tab]);

  // Auto-scroll game tab.
  useEffect(() => {
    if (tab === 'game' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, tab]);

  const tabBtn = (t: 'game' | 'global', label: string, unread: boolean) => (
    <button
      type="button"
      onClick={() => switchTab(t)}
      className={`relative flex-1 rounded-md py-1 text-xs font-medium transition ${
        tab === t
          ? 'bg-neutral-800 text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-300'
      }`}
    >
      {label}
      {unread && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.7)]" />
      )}
    </button>
  );

  return (
    <aside className={`flex h-80 flex-col rounded-xl border bg-neutral-900 lg:h-[340px] transition-all duration-300 ${
      // Outer border glows emerald when either tab has unread messages.
      (gameUnread && tab === 'global') || (globalUnread && tab === 'game')
        ? 'border-emerald-500/60 shadow-[0_0_10px_2px_rgba(52,211,153,0.25)]'
        : 'border-neutral-800'
    }`}>
      {/* Header: tab toggle */}
      <div className="flex items-center gap-1 border-b border-neutral-800 px-2 py-1.5">
        <div className="flex flex-1 gap-1 rounded-lg bg-neutral-950/60 p-0.5">
          {tabBtn('game', 'Game', gameUnread && tab === 'global')}
          {tabBtn('global', 'Global', globalUnread && tab === 'game')}
        </div>
      </div>

      {/* Game chat */}
      {tab === 'game' && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 text-sm">
            {messages.length === 0 && <p className="text-neutral-500">No messages yet.</p>}
            {messages.map((m, i) => {
              const accent = safeAccent(m.profiles?.accent_color ?? (m.sender_id === currentUserId ? currentUserAccent : null));
              const prev = messages[i - 1];
              const showDivider = !prev || (new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > CHAT_GAP_MS);
              return (
                <div key={m.id}>
                  {showDivider && <ChatTimeDivider iso={m.created_at} />}
                  <div className="flex items-baseline gap-1.5 min-w-0 py-0.5">
                    <span className="font-medium shrink-0" style={{ color: accent }}>
                      {m.profiles?.username || '???'}:
                    </span>
                    <span className="text-neutral-200 break-words min-w-0">{m.body}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <form
            className="flex gap-2 border-t border-neutral-800 p-2"
            onSubmit={(e) => { e.preventDefault(); const v = draft; if (!v.trim()) return; onSend(v); }}
          >
            <input
              value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={imSeated ? `Message as ${currentUsername}` : 'Join the room to chat'}
              disabled={!imSeated}
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
            />
            <button type="submit" disabled={!imSeated || !draft.trim()}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50">
              Send
            </button>
          </form>
        </>
      )}

      {/* Global chat — embedded, no outer border */}
      {tab === 'global' && (
        <GeneralChat
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentUserAccent={currentUserAccent}
          embedded
          active={tab === 'global'}
          onUnread={() => setGlobalUnread(true)}
        />
      )}
    </aside>
  );
}

