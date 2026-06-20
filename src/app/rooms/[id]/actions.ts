'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { GAMES, getProjectedState } from '@/lib/games/registry';
import { applyMove as applyMoveTTT, initialState as tttInitial, type TTTState } from '@/lib/games/tictactoe';
import { applyMove as applyMoveC4, initialState as c4Initial, type C4State } from '@/lib/games/connect4';
import { applyMove as applyMoveCK, initialState as ckInitial, type CheckersState } from '@/lib/games/checkers';
import { applyMove as applyMoveBS, initialState as bsInitial, type BSState, type BSPayload } from '@/lib/games/battleship';
import {
  initialState as bgInitial,
  addPlayer as bgAddPlayer,
  startGame as bgStartGame,
  nextRound as bgNextRound,
  setGameMode as bgSetGameMode,
  submitWord as bgSubmitWord,
  finalize as bgFinalize,
  msRemaining as bgMsRemaining,
  type BoggleState,
  type BoggleGameMode,
} from '@/lib/games/boggle';
import { isWord as bgIsWord } from '@/lib/games/boggleDictionary';
import {
  addPlayer as lsAddPlayer,
  initialState as lsInitialState,
  startRace as lsStartRace,
  rollDice as lsRollDice,
  takeAction as lsTakeAction,
  MOVEMENT_DIE_FACES,
  type LSState,
  type ActionPayload,
} from '@/lib/games/longshot';
import {
  initialState as ldInitial,
  addPlayer as ldAddPlayer,
  startGame as ldStartGame,
  placeBid as ldPlaceBid,
  callLiar as ldCallLiar,
  startNextRound as ldStartNextRound,
  type LDState,
} from '@/lib/games/liarsdice';
import {
  initialState as yzInitial,
  addPlayer as yzAddPlayer,
  startGame as yzStartGame,
  roll as yzRoll,
  toggleHold as yzToggleHold,
  commitScore as yzCommitScore,
  type YState,
  type Category as YCategory,
} from '@/lib/games/yahtzee';
import {
  applyMove as applyMoveRPS,
  initialState as rpsInitial,
  type RPSState,
  type RPSChoice,
} from '@/lib/games/rps';
import {
  applyMove as applyMoveSD,
  seatJoinerAndStart as sdSeatJoinerAndStart,
  createInitialStateForHost as sdCreateInitialStateForHost,
  trimLog as sdTrimLog,
  type SDState,
  type ResolvedTarget as SDResolvedTarget,
  type CardId as SDCardId,
} from '@/lib/games/spellduel';
import {
  applyAction as applyActionLG,
  startGame as lgStartGame,
  applyLobbyConfig as applyLobbyConfigLG,
  type LegendaryAction,
  type LegendaryLobbyAction,
  type LegendaryState,
} from '@/lib/games/legendary';
import {
  applyAction as applyActionHQ,
  type HQAction,
  type HQState,
  type HeroClass as HQHeroClass,
  type Coord as HQCoord,
} from '@/lib/games/heroquest';
import {
  applyAction as applyActionHS,
  attackDiceRequirements as hsAttackDiceRequirements,
  fireLineDefenders as hsFireLineDefenders,
  grenadeDefenders as hsGrenadeDefenders,
  wildSwingDefenders as hsWildSwingDefenders,
  effectiveDefenseDice as hsEffectiveDefenseDice,
  moveConsequences as hsMoveConsequences,
  getActiveCardUid as hsGetActiveCardUid,
  HS_GLYPHS,
  COMBAT_DIE_FACES as HS_COMBAT_DIE_FACES,
  type HSAction,
  type HSState,
  type Figure as HSFigure,
  type CombatFace as HSCombatFace,
  type InitiativeAttempt as HSInitiativeAttempt,
  type OrderMarkerValue as HSOrderMarkerValue,
  type HSChoiceResolution,
  type HSMode,
} from '@/lib/games/heroscape';

/**
 * Push a "room changed" event over Supabase Realtime broadcast so every connected client
 * refetches immediately. This is more reliable than relying on postgres_changes alone,
 * which can lag or silently drop with RLS in some Supabase configurations.
 */
/**
 * The single SELECT shape every "read a room" caller uses (page.tsx initial
 * render, RoomClient's refresh, etc.). Kept in one place so it's impossible
 * for the projection wrapper to drift from the columns the client expects.
 */
const ROOM_SELECT =
  'id, game_type, status, host_id, state, max_players, rematch_votes, abandon_votes, turn_started_at, time_per_player, room_players(player_id, seat, profiles(username, accent_color))';

/**
 * Fetch a room and return the state PROJECTED for the calling user.
 *
 * Closes the network-layer info leak: previously RoomClient ran the SELECT
 * directly through the client-side supabase, so the raw bytes (including
 * opponent's hand cards) hit the browser before any scrubbing. Now the
 * fetch + projection happen server-side and the projected state is what
 * crosses the wire.
 *
 * Returns the full row (including non-state columns); only the `state`
 * field is projected.
 */
export async function fetchRoom(roomId: string): Promise<unknown> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: room, error } = await supabase.from('rooms').select(ROOM_SELECT).eq('id', roomId).single();
  if (error || !room) throw new Error('Room not found');
  const projectedState = getProjectedState(room.game_type, room.state, user?.id ?? null);
  return { ...room, state: projectedState };
}

async function notifyRoom(roomId: string) {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{
          topic: `room-${roomId}`,
          event: 'room-changed',
          payload: { at: Date.now() },
          private: false,
        }],
      }),
    });
  } catch {
    // Best-effort — postgres_changes will still cover it eventually.
  }
}

export async function joinRoom(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state, max_players, room_players(player_id, seat)')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');

  if ((room.room_players as { player_id: string }[]).some(p => p.player_id === user.id)) return;
  if (room.status !== 'waiting') throw new Error('Room is not accepting players');
  if (room.room_players.length >= room.max_players) throw new Error('Room is full');

  const usedSeats = new Set((room.room_players as { seat: number }[]).map(p => p.seat));
  let seat = 0;
  while (usedSeats.has(seat)) seat++;

  const { error: insErr } = await supabase
    .from('room_players')
    .insert({ room_id: roomId, player_id: user.id, seat });
  if (insErr) throw new Error(insErr.message);

  // Spellduel doesn't fit the generic addPlayer shape (state.players is an
  // object keyed by seat, not an array) — fill seat B + flip to 'playing'
  // through the engine's two-arg helper.
  if (room.game_type === 'spellduel') {
    const { data: profile } = await supabase
      .from('profiles').select('username, accent_color').eq('id', user.id).single();
    const next = sdSeatJoinerAndStart((room.state || {}) as SDState, {
      userId: user.id,
      username: profile?.username ?? 'player',
      accent_color: profile?.accent_color as string | undefined,
    });
    await supabase
      .from('rooms')
      .update({ state: next, status: 'playing' })
      .eq('id', roomId);
    await notifyRoom(roomId);
    revalidatePath(`/rooms/${roomId}`);
    return;
  }

  // Multi-player games register the joiner in their state.players[]; dispatch
  // via the GameDef so adding a new multi-player game means registering
  // `addPlayer` on its registry entry — no edit to this action required.
  const addPlayerFn = GAMES[room.game_type]?.addPlayer;
  if (addPlayerFn) {
    const { data: profile } = await supabase
      .from('profiles').select('username, accent_color').eq('id', user.id).single();
    const username = profile?.username ?? 'player';
    const accent = (profile?.accent_color as string | undefined);
    const newState = addPlayerFn((room.state || {}), user.id, username, seat, accent);
    await supabase.from('rooms').update({ state: newState }).eq('id', roomId);
  } else {
    // Tic-Tac-Toe / Connect Four / Checkers / Battleship: auto-start when 2nd player joins.
    // For TTT/C4/Checkers we coin-flip who plays the first-move color (X/R/R) so the host
    // doesn't get an automatic advantage. Battleship keeps its own post-Ready coin flip.
    const state = (room.state || {}) as Record<string, unknown> & { seats?: Record<string, string> };
    const seats = { ...(state.seats || {}) };
    if (seat === 1) {
      const hostId = seats.X ?? seats.R ?? seats.A ?? '';
      const joinerId = user.id;
      const swap = Math.random() < 0.5;
      const firstId  = swap ? joinerId : hostId;
      const secondId = swap ? hostId   : joinerId;
      if (room.game_type === 'tictactoe') { seats.X = firstId; seats.O = secondId; }
      if (room.game_type === 'connect4')  { seats.R = firstId; seats.Y = secondId; }
      if (room.game_type === 'checkers')  { seats.R = firstId; seats.B = secondId; }
      if (room.game_type === 'rps')       { seats.A = firstId; seats.B = secondId; }
      if (room.game_type === 'battleship' && !seats.B) seats.B = user.id; // BS has its own flip
    }
    await supabase
      .from('rooms')
      .update({ status: 'playing', state: { ...state, seats } })
      .eq('id', roomId);
  }

  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

/** Apply a player action (BET / BUY / HELMET / JERSEY / CONCESSION / PASS) during the action phase. */
export async function takeActionLS(roomId: string, payload: ActionPayload) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'longshot') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Race not in progress');

  const next = lsTakeAction((room.state || {}) as LSState, user.id, payload);
  if ('error' in next) throw new Error(next.error);

  const updates: { state: LSState; status?: string } = { state: next };
  if (next.phase === 'finished') updates.status = 'finished';

  await supabase.from('rooms').update(updates).eq('id', roomId);
  await recordHistoryIfFinished(supabase, roomId, 'longshot', next);
  await notifyRoom(roomId);
}

/** Active player rolls both dice and resolves movement. Server-rolled for fairness. */
export async function rollDiceLS(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'longshot') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Race not in progress');

  const state = (room.state || {}) as LSState;
  const me = state.players.find(p => p.playerId === user.id);
  if (!me || me.seat !== state.activePlayerSeat) {
    throw new Error('Only the active player can roll the dice');
  }

  const horseDie = 1 + Math.floor(Math.random() * 8);                                // d8
  const movementDie = MOVEMENT_DIE_FACES[Math.floor(Math.random() * MOVEMENT_DIE_FACES.length)]; // weighted d6: 1, 2, 2, 2, 3, 3
  const next = lsRollDice(state, horseDie, movementDie);
  if ('error' in next) throw new Error(next.error);

  const updates: { state: LSState; status?: string } = { state: next };
  if (next.phase === 'finished') updates.status = 'finished';

  await supabase.from('rooms').update(updates).eq('id', roomId);
  await recordHistoryIfFinished(supabase, roomId, 'longshot', next);
  await notifyRoom(roomId);
}

/** Host flips a waiting Long Shot room to 'playing'. */
export async function startGame(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state, host_id, room_players(player_id)')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.host_id !== user.id) throw new Error('Only the host can start the game');
  if (room.status !== 'waiting') throw new Error('Game already started');
  const minPlayers = GAMES[room.game_type]?.minPlayers ?? 2;
  if (room.room_players.length < minPlayers) {
    throw new Error(`Need at least ${minPlayers} player${minPlayers === 1 ? '' : 's'}`);
  }

  if (room.game_type === 'longshot') {
    const next = lsStartRace((room.state || {}) as LSState);
    if ('error' in next) throw new Error(next.error);
    await supabase
      .from('rooms')
      .update({ status: 'playing', state: next })
      .eq('id', roomId);
  } else if (room.game_type === 'boggle') {
    const next = bgStartGame((room.state || {}) as BoggleState);
    if ('error' in next) throw new Error(next.error);
    await supabase
      .from('rooms')
      .update({ status: 'playing', state: next })
      .eq('id', roomId);
  } else if (room.game_type === 'liarsdice') {
    const next = ldStartGame((room.state || {}) as LDState);
    if ('error' in next) throw new Error(next.error);
    await supabase
      .from('rooms')
      .update({ status: 'playing', state: next })
      .eq('id', roomId);
  } else if (room.game_type === 'yahtzee') {
    const next = yzStartGame((room.state || {}) as YState);
    if ('error' in next) throw new Error(next.error);
    await supabase
      .from('rooms')
      .update({ status: 'playing', state: next })
      .eq('id', roomId);
  } else {
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', roomId);
  }

  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

/**
 * Submit a bug report from inside a room. Always inserts into `bug_reports`; if
 * `RESEND_API_KEY` and `BUG_REPORT_EMAIL` are set in env, ALSO emails the report
 * to that address. Returns `{ ok: true, ... }` on success, `{ ok: false, error: ... }`
 * on failure — server actions in production hide thrown errors, so we surface them
 * via the return value instead.
 */
export async function reportError(params: {
  roomId: string | null;
  description: string;
  userAgent?: string;
  url?: string;
}): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string }> {
  try {
    const { roomId, description, userAgent, url } = params;
    if (!description || description.trim().length === 0) {
      return { ok: false, error: 'Description is required' };
    }
    if (description.length > 2000) {
      return { ok: false, error: 'Description too long (max 2000 chars)' };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'Not signed in' };

    // Look up reporter username (best-effort)
    let reporterUsername: string | null = null;
    try {
      const { data: profile } = await supabase
        .from('profiles').select('username').eq('id', user.id).single();
      reporterUsername = profile?.username ?? null;
    } catch { /* ignore — best-effort */ }

    // Look up room's game type (best-effort)
    let gameType: string | null = null;
    if (roomId) {
      try {
        const { data: room } = await supabase
          .from('rooms').select('game_type').eq('id', roomId).single();
        gameType = (room as { game_type?: string } | null)?.game_type ?? null;
      } catch { /* ignore */ }
    }

    // Persist (required)
    const { error: insErr } = await supabase.from('bug_reports').insert({
      reporter_id: user.id,
      reporter_username: reporterUsername,
      room_id: roomId,
      game_type: gameType,
      description: description.trim(),
      user_agent: userAgent ?? null,
      url: url ?? null,
    });
    if (insErr) {
      console.error('[reportError] insert failed:', insErr);
      return {
        ok: false,
        error:
          insErr.message?.includes('does not exist') || insErr.code === '42P01'
            ? 'bug_reports table not found — please apply the SQL migration (005_bug_reports.sql) in Supabase.'
            : insErr.message ?? 'Database error',
      };
    }

    // Discord webhook (best-effort — only fires if DISCORD_BUG_WEBHOOK_URL is set)
    const discordUrl = process.env.DISCORD_BUG_WEBHOOK_URL;
    let delivered = false;
    if (discordUrl) {
      try {
        const res = await fetch(discordUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'Game Arena',
            embeds: [
              {
                title: `🐞 Bug report from ${reporterUsername ?? '(unknown)'}`,
                description: description.trim().slice(0, 4000),
                color: 0xef4444, // red
                fields: [
                  ...(gameType ? [{ name: 'Game', value: gameType, inline: true }] : []),
                  ...(roomId ? [{ name: 'Room', value: roomId.slice(0, 8), inline: true }] : []),
                  ...(url ? [{ name: 'URL', value: url.slice(0, 1000) }] : []),
                  ...(userAgent ? [{ name: 'User-Agent', value: userAgent.slice(0, 1000) }] : []),
                ],
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        });
        if (res.ok) delivered = true;
        else console.error('[reportError] discord webhook returned', res.status, await res.text().catch(() => ''));
      } catch (e) {
        console.error('[reportError] discord webhook failed:', e);
      }
    }

    return { ok: true, emailed: delivered };
  } catch (e) {
    console.error('[reportError] unexpected:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Host-only: remove a seated player from a room that's still in `waiting`
 * status. Used by the kick button in the Seats grid. No-op once the game
 * has started — for that case players have Resign / Propose Abandon.
 *
 * Removes the row from room_players AND, for engines that maintain their
 * own players array in state (Long Shot / Yahtzee / Liar's Dice / Boggle),
 * also calls each engine's removePlayer() so the lobby player count and
 * the engine state stay consistent.
 */
export async function kickPlayer(roomId: string, targetId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room } = await supabase
    .from('rooms')
    .select('id, game_type, status, host_id, state')
    .eq('id', roomId)
    .single();
  if (!room) throw new Error('Room not found');
  if (room.host_id !== user.id) throw new Error('Only the host can kick');
  if (room.status !== 'waiting') throw new Error('Can only kick before the game starts');
  if (targetId === user.id) throw new Error("You can't kick yourself — leave the room instead");

  await supabase.from('room_players').delete().eq('room_id', roomId).eq('player_id', targetId);

  // Engines that track their own players array need their state cleaned up too.
  // Dispatch via the registry so adding a new multi-player game doesn't require
  // touching this code path — just register removePlayer on the GameDef.
  const removePlayerFn = GAMES[room.game_type]?.removePlayer;
  if (removePlayerFn) {
    const nextState = removePlayerFn((room.state || {}), targetId);
    if (nextState !== room.state) {
      await supabase.from('rooms').update({ state: nextState }).eq('id', roomId);
    }
  }

  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

export async function leaveRoom(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase.from('room_players').delete().eq('room_id', roomId).eq('player_id', user.id);
  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

/**
 * Resign the current live match. Behavior:
 *   • 2-player games (TTT / C4 / Checkers / Battleship): opponent wins. We mutate
 *     the engine state to set `winner = opponent's color` and write a normal
 *     game_history row crediting the opponent with a win.
 *   • Multi-player games (Long Shot / Yahtzee / Liar's Dice / Boggle): not
 *     supported in v1 — use Propose Abandon instead. This action throws so the
 *     UI can hide the button cleanly.
 */
export async function resignGame(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room } = await supabase
    .from('rooms')
    .select('id, game_type, status, state, room_players(player_id, seat)')
    .eq('id', roomId)
    .single();
  if (!room) throw new Error('Room not found');
  if (room.status !== 'playing') throw new Error('Game is not in progress');

  type SeatMap = { X?: string; O?: string; R?: string; Y?: string; B?: string; A?: string };
  const stateAny = (room.state ?? {}) as { seats?: SeatMap; winner?: unknown };
  const seats = stateAny.seats ?? {};

  const opposite: Record<string, string> = { X: 'O', O: 'X', R: 'Y', Y: 'R', A: 'B', B: 'A' };
  // Checkers uses R/B (not R/Y). Battleship also uses A/B. Detect from the seat keys present.
  if (room.game_type === 'checkers') { opposite.R = 'B'; opposite.B = 'R'; }

  // Find which side the resigner is sitting on.
  let myKey: string | null = null;
  for (const k of Object.keys(seats)) {
    if (seats[k as keyof SeatMap] === user.id) { myKey = k; break; }
  }
  if (!myKey) throw new Error('You are not seated in this game');

  const oppKey = opposite[myKey];
  if (!oppKey || !seats[oppKey as keyof SeatMap]) {
    throw new Error('Resign is only supported for 2-player games right now. Use Propose Abandon instead.');
  }

  const nextState = { ...stateAny, winner: oppKey };

  await supabase
    .from('rooms')
    .update({ state: nextState, status: 'finished', rematch_votes: [], abandon_votes: [] })
    .eq('id', roomId);

  await recordHistoryIfFinished(supabase, roomId, room.game_type, nextState);

  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

/**
 * Toggle this user's "abandon" vote on the current live game. If everyone seated
 * has voted, the game ends with status='finished' but NO game_history row — so
 * no W/L is recorded for anyone. Cleared automatically if the game ends some
 * other way. Votes also clear if anyone makes a regular move (handled by the
 * existing per-action update paths via abandon_votes: []).
 */
export async function voteAbandon(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room } = await supabase
    .from('rooms')
    .select('id, status, abandon_votes, room_players(player_id)')
    .eq('id', roomId)
    .single();
  if (!room) throw new Error('Room not found');
  if (room.status !== 'playing') throw new Error('Game is not in progress');

  const seated = new Set((room.room_players as { player_id: string }[]).map(p => p.player_id));
  if (!seated.has(user.id)) throw new Error('You are not seated in this game');

  const votes = new Set((room.abandon_votes as string[]) || []);
  if (votes.has(user.id)) votes.delete(user.id);
  else votes.add(user.id);

  // If every seated player has now voted to abandon, end the game with no result.
  const allAgreed = seated.size > 0 && [...seated].every(id => votes.has(id));
  if (allAgreed) {
    await supabase
      .from('rooms')
      .update({ status: 'finished', abandon_votes: [], rematch_votes: [] })
      .eq('id', roomId);
  } else {
    await supabase
      .from('rooms')
      .update({ abandon_votes: Array.from(votes) })
      .eq('id', roomId);
  }

  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

// =====================================================================
// Unified move dispatch (registerGame Phase C)
// =====================================================================
//
// Boards used to call one of ~17 distinct server actions (makeMoveTTT,
// placeBidLD, submitWordBoggle, etc.). Now they all funnel through a single
// `gameMove(roomId, action)` entry point whose `action` is a discriminated
// union — TypeScript catches missing cases when we add a new game, and
// boards.tsx has a single import surface for "any game move ever."
//
// Internally we still delegate to the individual per-game actions (kept
// exported for now for backward compat / direct callers). Future cleanups
// can inline those bodies here and remove the wrappers.

// Reuses ActionPayload, BSPayload, BoggleGameMode, YCategory from the top-of-file imports.
export type GameAction =
  // Game lifecycle (multi-player engines that need an explicit host "Start")
  | { game: 'longshot';  kind: 'startGame' }
  | { game: 'boggle';    kind: 'startGame' }
  | { game: 'liarsdice'; kind: 'startGame' }
  | { game: 'yahtzee';   kind: 'startGame' }

  // 2-player abstract strategy (single move per turn)
  | { game: 'tictactoe';  kind: 'move'; cell: number }
  | { game: 'connect4';   kind: 'move'; col: number }
  | { game: 'checkers';   kind: 'move'; from: [number, number]; to: [number, number] }
  | { game: 'battleship'; kind: 'move'; payload: BSPayload }

  // Rock-Paper-Scissors (simultaneous reveal)
  | { game: 'rps'; kind: 'move'; choice: RPSChoice }

  // Spellduel — interactive card game
  | { game: 'spellduel'; kind: 'draft_pick'; cardId: SDCardId }
  | { game: 'spellduel'; kind: 'play'; cardIdx: number; targets?: SDResolvedTarget[] }
  | { game: 'spellduel'; kind: 'play_reaction'; cardIdx: number }
  | { game: 'spellduel'; kind: 'pass_reaction' }
  | { game: 'spellduel'; kind: 'end_turn' }

  // Legendary — Marvel co-op deck builder
  | { game: 'legendary'; kind: 'startGame' }
  // Lobby configuration (host-only, before startGame)
  | { game: 'legendary'; kind: 'set_mastermind'; mastermindId: string }
  | { game: 'legendary'; kind: 'set_scheme'; schemeId: string }
  | { game: 'legendary'; kind: 'set_hero_classes'; classNames: string[] }
  | { game: 'legendary'; kind: 'randomize_heroes' }
  | { game: 'legendary'; kind: 'set_villain_groups';  groupIds: string[] }
  | { game: 'legendary'; kind: 'set_henchman_groups'; groupIds: string[] }
  | { game: 'legendary'; kind: 'randomize_villains' }
  | { game: 'legendary'; kind: 'randomize_henchmen' }
  // In-game actions
  | { game: 'legendary'; kind: 'play_card'; instanceId: string }
  | { game: 'legendary'; kind: 'recruit_hero'; slot: number }
  | { game: 'legendary'; kind: 'recruit_sidekick' }
  | { game: 'legendary'; kind: 'recruit_officer' }
  | { game: 'legendary'; kind: 'fight_city'; slot: number }
  | { game: 'legendary'; kind: 'fight_mastermind' }
  | { game: 'legendary'; kind: 'resolve_choice'; instanceId: string }
  | { game: 'legendary'; kind: 'skip_choice' }
  | { game: 'legendary'; kind: 'accept_choice' }
  | { game: 'legendary'; kind: 'end_turn' }
  | { game: 'legendary'; kind: 'reveal_first_villain' }
  | { game: 'legendary'; kind: 'play_wound_healing' }
  | { game: 'legendary'; kind: 'undo' }

  // Long Shot
  | { game: 'longshot'; kind: 'roll' }
  | { game: 'longshot'; kind: 'action'; payload: ActionPayload }

  // Boggle
  | { game: 'boggle'; kind: 'setMode';    mode: BoggleGameMode }
  | { game: 'boggle'; kind: 'nextRound' }
  | { game: 'boggle'; kind: 'submitWord'; word: string }
  | { game: 'boggle'; kind: 'finalize' }

  // Liar's Dice
  | { game: 'liarsdice'; kind: 'bid';       quantity: number; face: number }
  | { game: 'liarsdice'; kind: 'callLiar' }
  | { game: 'liarsdice'; kind: 'nextRound' }

  // Yahtzee
  | { game: 'yahtzee'; kind: 'roll' }
  | { game: 'yahtzee'; kind: 'toggleHold';  idx: number }
  | { game: 'yahtzee'; kind: 'commitScore'; category: YCategory }

  // HeroQuest — coop dungeon crawler with automated Zargon
  | { game: 'heroquest'; kind: 'claim_hero'; seat: number }
  | { game: 'heroquest'; kind: 'set_class'; classKlass: HQHeroClass }
  | { game: 'heroquest'; kind: 'random_classes' }
  | { game: 'heroquest'; kind: 'start_game' }
  | { game: 'heroquest'; kind: 'roll_move' }
  | { game: 'heroquest'; kind: 'move_to'; at: HQCoord }
  | { game: 'heroquest'; kind: 'move_path'; path: HQCoord[] }
  | { game: 'heroquest'; kind: 'open_door'; doorId: string }
  | { game: 'heroquest'; kind: 'attack'; monsterId: string }
  | { game: 'heroquest'; kind: 'search_treasure' }
  | { game: 'heroquest'; kind: 'search_traps' }
  | { game: 'heroquest'; kind: 'search_secrets' }
  | { game: 'heroquest'; kind: 'disarm_trap'; trapId: string }
  | { game: 'heroquest'; kind: 'jump_trap'; trapId: string }
  | { game: 'heroquest'; kind: 'climb_pit' }
  | { game: 'heroquest'; kind: 'cast_spell'; spellId: string; targetMonsterId?: string; targetHeroIdx?: number; targetDoorId?: string }
  | { game: 'heroquest'; kind: 'use_potion'; potionId: string }
  | { game: 'heroquest'; kind: 'pass_potion'; potionId: string; toHeroSeat: number }
  | { game: 'heroquest'; kind: 'end_turn' }
  | { game: 'heroquest'; kind: 'zargon_step' }
  | { game: 'heroquest'; kind: 'death_save'; choice: 'potion' | 'spell' | 'decline' }
  | { game: 'heroquest'; kind: 'pick_spell_school'; school: 'air' | 'water' | 'fire' | 'earth' }
  | { game: 'heroquest'; kind: 'exit_dungeon'; confirm: boolean }
  | { game: 'heroquest'; kind: 'falling_block_move'; at: HQCoord }
  | { game: 'heroquest'; kind: 'buy_item'; heroSeat: number; itemId: string }
  | { game: 'heroquest'; kind: 'pass_item'; heroSeat: number; itemId: string; toHeroSeat: number }
  | { game: 'heroquest'; kind: 'pass_potion_intermission'; heroSeat: number; potionId: string; toHeroSeat: number }
  | { game: 'heroquest'; kind: 'sell_item'; heroSeat: number; itemId: string }
  | { game: 'heroquest'; kind: 'sell_potion'; heroSeat: number; potionId: string }
  | { game: 'heroquest'; kind: 'gift_gold'; fromSeat: number; toSeat: number; amount: number }
  | { game: 'heroquest'; kind: 'intermission_ready'; ready: boolean }

  // HeroScape — hex-battlefield skirmish (Master Game rounds). The client
  // sends intent only; makeMoveHS rolls every die server-side (d20 initiative,
  // attack/defense dice, falling dice, leaving-engagement swipes) and injects
  // the values into the pure engine. The host picks the battlefield at start.
  | { game: 'heroscape'; kind: 'start_game'; mapId?: string; pointBudget?: number; mode?: HSMode }
  | { game: 'heroscape'; kind: 'set_lobby_config'; mapId?: string; pointBudget?: number; mode?: HSMode; teams?: Record<number, number>; teamBudgets?: Record<number, number> }
  | { game: 'heroscape'; kind: 'place_markers'; assignments: { marker: HSOrderMarkerValue; cardUid: string }[] }
  | { game: 'heroscape'; kind: 'move_figure'; figureId: string; to: string }
  | { game: 'heroscape'; kind: 'undo_move' }
  | { game: 'heroscape'; kind: 'grapple_move'; figureId: string; to: string }
  | { game: 'heroscape'; kind: 'attack'; attackerId: string; targetId: string }
  | { game: 'heroscape'; kind: 'fire_line'; attackerId: string; dir: number }
  | { game: 'heroscape'; kind: 'orient_figure'; figureId: string; dir: number }
  | { game: 'heroscape'; kind: 'mind_shackle'; targetId: string }
  | { game: 'heroscape'; kind: 'chomp'; targetId: string }
  | { game: 'heroscape'; kind: 'grenade' }
  | { game: 'heroscape'; kind: 'grenade_throw'; targetId: string }
  | { game: 'heroscape'; kind: 'berserker_charge' }
  | { game: 'heroscape'; kind: 'water_clone' }
  // Big Heroes special powers (slice 8b) — the server rolls every die.
  | { game: 'heroscape'; kind: 'ice_shard'; attackerId: string; targetId: string }
  | { game: 'heroscape'; kind: 'queglix'; attackerId: string; targetId: string; dice: 1 | 2 | 3 }
  | { game: 'heroscape'; kind: 'wild_swing'; attackerId: string; targetId: string }
  | { game: 'heroscape'; kind: 'acid_breath'; attackerId: string; targetIds: string[] }
  | { game: 'heroscape'; kind: 'throw_figure'; attackerId: string; targetId: string; to: string }
  | { game: 'heroscape'; kind: 'carry_move'; figureId: string; to: string; passengerId: string; passengerTo: string }
  | { game: 'heroscape'; kind: 'the_drop' }
  | { game: 'heroscape'; kind: 'resolve_choice'; choice: HSChoiceResolution }
  | { game: 'heroscape'; kind: 'end_turn' }
  // Draft + placement (slice 5).
  | { game: 'heroscape'; kind: 'draft_card'; cardId: string }
  | { game: 'heroscape'; kind: 'draft_pass' }
  | { game: 'heroscape'; kind: 'place_figure'; figureId: string; to: string }
  | { game: 'heroscape'; kind: 'unplace_figure'; figureId: string }
  | { game: 'heroscape'; kind: 'placement_ready' };

/**
 * Single entry point for every in-game action. Boards call this through the
 * `boards.tsx` renderer instead of importing 17 different server actions.
 * Returns whatever the underlying action returns (most are void; submitWord
 * returns word-validation results).
 */
export async function gameMove(roomId: string, action: GameAction): Promise<unknown> {
  switch (action.game) {
    case 'tictactoe':
      if (action.kind === 'move') return makeMoveTTT(roomId, action.cell);
      break;
    case 'connect4':
      if (action.kind === 'move') return makeMoveC4(roomId, action.col);
      break;
    case 'checkers':
      if (action.kind === 'move') return makeMoveCheckers(roomId, action.from, action.to);
      break;
    case 'battleship':
      if (action.kind === 'move') return makeMoveBattleship(roomId, action.payload);
      break;
    case 'rps':
      if (action.kind === 'move') return makeMoveRPS(roomId, action.choice);
      break;
    case 'spellduel':
      if (action.kind === 'draft_pick')    return makeMoveSD(roomId, { kind: 'draft_pick', cardId: action.cardId });
      if (action.kind === 'play')          return makeMoveSD(roomId, { kind: 'play', cardIdx: action.cardIdx, targets: action.targets });
      if (action.kind === 'play_reaction') return makeMoveSD(roomId, { kind: 'play_reaction', cardIdx: action.cardIdx });
      if (action.kind === 'pass_reaction') return makeMoveSD(roomId, { kind: 'pass_reaction' });
      if (action.kind === 'end_turn')      return makeMoveSD(roomId, { kind: 'end_turn' });
      break;
    case 'legendary':
      if (action.kind === 'startGame')        return startGameLG(roomId);
      // Lobby config actions (host-only, before startGame)
      if (action.kind === 'set_mastermind')   return lobbyConfigLG(roomId, { kind: 'set_mastermind', mastermindId: action.mastermindId });
      if (action.kind === 'set_scheme')       return lobbyConfigLG(roomId, { kind: 'set_scheme', schemeId: action.schemeId });
      if (action.kind === 'set_hero_classes') return lobbyConfigLG(roomId, { kind: 'set_hero_classes', classNames: action.classNames });
      if (action.kind === 'randomize_heroes') return lobbyConfigLG(roomId, { kind: 'randomize_heroes' });
      if (action.kind === 'set_villain_groups')  return lobbyConfigLG(roomId, { kind: 'set_villain_groups',  groupIds: action.groupIds });
      if (action.kind === 'set_henchman_groups') return lobbyConfigLG(roomId, { kind: 'set_henchman_groups', groupIds: action.groupIds });
      if (action.kind === 'randomize_villains')  return lobbyConfigLG(roomId, { kind: 'randomize_villains' });
      if (action.kind === 'randomize_henchmen')  return lobbyConfigLG(roomId, { kind: 'randomize_henchmen' });
      // In-game actions
      if (action.kind === 'play_card')        return makeMoveLG(roomId, { kind: 'play_card', instanceId: action.instanceId });
      if (action.kind === 'recruit_hero')     return makeMoveLG(roomId, { kind: 'recruit_hero', slot: action.slot });
      if (action.kind === 'recruit_sidekick') return makeMoveLG(roomId, { kind: 'recruit_sidekick' });
      if (action.kind === 'recruit_officer')  return makeMoveLG(roomId, { kind: 'recruit_officer' });
      if (action.kind === 'fight_city')       return makeMoveLG(roomId, { kind: 'fight_city', slot: action.slot });
      if (action.kind === 'fight_mastermind') return makeMoveLG(roomId, { kind: 'fight_mastermind' });
      if (action.kind === 'resolve_choice')   return makeMoveLG(roomId, { kind: 'resolve_choice', instanceId: action.instanceId });
      if (action.kind === 'skip_choice')         return makeMoveLG(roomId, { kind: 'skip_choice' });
      if (action.kind === 'accept_choice')       return makeMoveLG(roomId, { kind: 'accept_choice' });
      if (action.kind === 'end_turn')            return makeMoveLG(roomId, { kind: 'end_turn' });
      if (action.kind === 'reveal_first_villain') return makeMoveLG(roomId, { kind: 'reveal_first_villain' });
      if (action.kind === 'play_wound_healing')   return makeMoveLG(roomId, { kind: 'play_wound_healing' });
      if (action.kind === 'undo')                 return makeMoveLG(roomId, { kind: 'undo' });
      break;
    case 'longshot':
      if (action.kind === 'startGame') return startGame(roomId);
      if (action.kind === 'roll')      return rollDiceLS(roomId);
      if (action.kind === 'action')    return takeActionLS(roomId, action.payload);
      break;
    case 'boggle':
      if (action.kind === 'startGame')  return startGame(roomId);
      if (action.kind === 'setMode')    return setBoggleMode(roomId, action.mode);
      if (action.kind === 'nextRound')  return startBoggleNextRound(roomId);
      if (action.kind === 'submitWord') return submitWordBoggle(roomId, action.word);
      if (action.kind === 'finalize')   return finalizeBoggleIfExpired(roomId);
      break;
    case 'liarsdice':
      if (action.kind === 'startGame') return startGame(roomId);
      if (action.kind === 'bid')       return placeBidLD(roomId, action.quantity, action.face);
      if (action.kind === 'callLiar')  return callLiarLD(roomId);
      if (action.kind === 'nextRound') return startNextRoundLD(roomId);
      break;
    case 'yahtzee':
      if (action.kind === 'startGame')   return startGame(roomId);
      if (action.kind === 'roll')        return rollDiceYZ(roomId);
      if (action.kind === 'toggleHold')  return toggleHoldYZ(roomId, action.idx);
      if (action.kind === 'commitScore') return commitScoreYZ(roomId, action.category);
      break;
    case 'heroquest': {
      // The HeroQuest engine speaks a single HQAction union; we just forward
      // every wire action to it after stripping the `game` discriminator.
      const { game: _g, ...rest } = action;
      return makeMoveHQ(roomId, rest as HQAction);
    }
    case 'heroscape': {
      const { game: _g, ...rest } = action;
      return makeMoveHS(roomId, rest as HSWireAction);
    }
  }
  throw new Error(`gameMove: unhandled action ${JSON.stringify(action)}`);
}

/**
 * Single unified path for writing a game_history row. Each game in registry.ts
 * implements `computeHistory(state)`; this function just dispatches.
 *   • Returns null from computeHistory → no insert (game still in progress)
 *   • Otherwise inserts one row with the winnerId + playerIds the game declares
 * Replaces the four bespoke `record*History*()` helpers we used to have.
 */
async function recordHistoryIfFinished(
  supabase: SupabaseClient,
  roomId: string,
  gameType: string,
  state: unknown,
) {
  const def = GAMES[gameType];
  if (!def?.computeHistory) return;
  const h = def.computeHistory(state);
  if (!h) return;
  const base = {
    room_id: roomId,
    game_type: gameType,
    winner_id: h.winnerId,
    player_ids: h.playerIds,
  };
  // Include analytics meta when the engine provides it (Legendary). Falls back
  // to a meta-less insert if the `meta` column hasn't been migrated yet, so
  // history recording never breaks for any game.
  if (h.meta) {
    const { error } = await supabase.from('game_history').insert({ ...base, meta: h.meta });
    if (error) await supabase.from('game_history').insert(base);
  } else {
    await supabase.from('game_history').insert(base);
  }
}

export async function makeMoveTTT(roomId: string, cell: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'tictactoe') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = applyMoveTTT(room.state as TTTState, cell, user.id);
  if ('error' in next) throw new Error(next.error);

  await supabase
    .from('rooms')
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [], abandon_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistoryIfFinished(supabase, roomId, 'tictactoe', next);
  await notifyRoom(roomId);
}

export async function makeMoveCheckers(roomId: string, from: [number, number], to: [number, number]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'checkers') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = applyMoveCK(room.state as CheckersState, from, to, user.id);
  if ('error' in next) throw new Error(next.error);

  await supabase
    .from('rooms')
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [], abandon_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistoryIfFinished(supabase, roomId, 'checkers', next);
  await notifyRoom(roomId);
}

/** Submit your RPS choice for the current round. The engine handles the
    "wait for both" handshake + reveal + scoring on its own. */
export async function makeMoveRPS(roomId: string, choice: RPSChoice) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'rps') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = applyMoveRPS(room.state as RPSState, { choice }, user.id);
  if ('error' in next) throw new Error(next.error);

  await supabase
    .from('rooms')
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [], abandon_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistoryIfFinished(supabase, roomId, 'rps', next);
  await notifyRoom(roomId);
}

/**
 * Submit a Spellduel move (play card by hand index, or end turn). The engine
 * resolves card effects + triggers atomically; we just persist the resulting
 * state and trim the log.
 */
export async function makeMoveSD(
  roomId: string,
  action:
    | { kind: 'draft_pick'; cardId: SDCardId }
    | { kind: 'play'; cardIdx: number; targets?: SDResolvedTarget[] }
    | { kind: 'play_reaction'; cardIdx: number }
    | { kind: 'pass_reaction' }
    | { kind: 'end_turn' },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'spellduel') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const result = applyMoveSD((room.state || {}) as SDState, action, user.id);
  if ('error' in result) throw new Error(result.error);

  const next = sdTrimLog(result);
  const updates: { state: SDState; status?: string; rematch_votes?: string[]; abandon_votes?: string[] } = {
    state: next,
    abandon_votes: [],
  };
  if (next.winner) {
    updates.status = 'finished';
    updates.rematch_votes = [];
  }
  await supabase.from('rooms').update(updates).eq('id', roomId);

  if (next.winner) await recordHistoryIfFinished(supabase, roomId, 'spellduel', next);
  await notifyRoom(roomId);
}

/**
 * Host-only: mutate the Legendary lobby configuration (mastermind / scheme /
 * hero classes) before the game starts. State is persisted and broadcast so
 * all players in the room see the changes live.
 */
export async function lobbyConfigLG(roomId: string, action: LegendaryLobbyAction) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type, host_id')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'legendary') throw new Error('Wrong game type');
  if (room.host_id !== user.id) throw new Error('Only the host can change game settings');

  const result = applyLobbyConfigLG((room.state || {}) as LegendaryState, action);
  if ('error' in result) throw new Error(result.error);

  await supabase.from('rooms').update({ state: result }).eq('id', roomId);
  await notifyRoom(roomId);
}

/**
 * Host-only: flip a Legendary room from 'waiting' (or 'playing' for the
 * setup screen) to a live game by calling the engine's startGame which
 * shuffles decks + deals opening hands.
 */
export async function startGameLG(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type, host_id')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'legendary') throw new Error('Wrong game type');
  if (room.host_id !== user.id) throw new Error('Only the host can start the game');

  const next = lgStartGame((room.state || {}) as LegendaryState);
  if ('error' in next) throw new Error(next.error);

  await supabase
    .from('rooms')
    .update({ state: next, status: 'playing' })
    .eq('id', roomId);
  await notifyRoom(roomId);
}

/**
 * Apply a Legendary game action (play_card / recruit_hero / fight_city /
 * fight_mastermind / end_turn). Server-authoritative; the engine validates
 * turn ownership + resource cost.
 */
export async function makeMoveLG(roomId: string, action: LegendaryAction) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'legendary') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const result = applyActionLG((room.state || {}) as LegendaryState, user.id, action);
  if ('error' in result) throw new Error(result.error);

  const updates: { state: LegendaryState; status?: string; rematch_votes?: string[]; abandon_votes?: string[] } = {
    state: result,
    abandon_votes: [],
  };
  if (result.phase === 'finished') {
    updates.status = 'finished';
    updates.rematch_votes = [];
  }
  await supabase.from('rooms').update(updates).eq('id', roomId);

  if (result.phase === 'finished') {
    await recordHistoryIfFinished(supabase, roomId, 'legendary', result);
  }
  await notifyRoom(roomId);
}

/**
 * Apply a HeroQuest game action. Server-authoritative — the engine validates
 * turn ownership, action types, line-of-sight, etc. We mirror Legendary's
 * shape so finish detection + history recording stay uniform.
 *
 * Special-case: HeroQuest has no separate "start game" server action; the
 * engine's `start_game` action is dispatched by any player in the room
 * (host-only check happens here for the start path).
 */
export async function makeMoveHQ(roomId: string, action: HQAction) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type, host_id')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'heroquest') throw new Error('Wrong game type');

  if (action.kind === 'start_game') {
    if (room.host_id !== user.id) throw new Error('Only the host can start the quest');
  } else if (
    action.kind !== 'set_class' &&
    action.kind !== 'random_classes' &&
    action.kind !== 'claim_hero'
  ) {
    if (room.status !== 'playing') throw new Error('Quest not in progress');
  }

  const prev = (room.state || {}) as HQState;
  const result = applyActionHQ(prev, user.id, action);
  if (!result.ok) throw new Error(result.error);
  const next = result.state;

  const updates: { state: HQState; status?: string; rematch_votes?: string[]; abandon_votes?: string[] } = {
    state: next,
    abandon_votes: [],
  };
  if (action.kind === 'start_game') {
    updates.status = 'playing';
  }
  if (next.phase === 'finished') {
    // Zargon victory: mark room finished.
    updates.status = 'finished';
    updates.rematch_votes = [];
  }
  await supabase.from('rooms').update(updates).eq('id', roomId);

  // Record game history on any conclusive outcome:
  //   • Zargon wins         → phase becomes 'finished'
  //   • Heroes win a quest  → phase becomes 'intermission' (from a non-intermission state)
  // We gate the hero-win case on the PHASE TRANSITION so that follow-up
  // intermission actions (buy, pass, ready) don't insert duplicate history rows.
  const freshHeroWin = next.phase === 'intermission'
    && next.winner === 'heroes'
    && prev.phase !== 'intermission';
  if (next.phase === 'finished' || freshHeroWin) {
    await recordHistoryIfFinished(supabase, roomId, 'heroquest', next);
  }
  await notifyRoom(roomId);
}

/** HeroScape wire actions — what the board sends. Dice are deliberately NOT
 *  part of this type: makeMoveHS rolls them server-side and injects them into
 *  the engine's HSAction so a client can never choose its own dice. There is
 *  no roll_initiative on the wire at all — the server triggers it itself when
 *  the final player locks in their order markers. */
type HSWireAction =
  | { kind: 'start_game'; mapId?: string; pointBudget?: number; mode?: HSMode }
  | { kind: 'set_lobby_config'; mapId?: string; pointBudget?: number; mode?: HSMode; teams?: Record<number, number>; teamBudgets?: Record<number, number> }
  | { kind: 'place_markers'; assignments: { marker: HSOrderMarkerValue; cardUid: string }[] }
  | { kind: 'move_figure'; figureId: string; to: string }
  // UNDO the last move this turn (repeatable, server-synced). No dice — passed
  // through verbatim; the engine validates (active seat, no attack yet) + restores
  // the pre-move snapshot.
  | { kind: 'undo_move' }
  // Sgt. Drake GRAPPLE GUN (slice 7): a one-space replacement move. Like
  // move_figure, the leaving-engagement swipe / fall dice are rolled server-side
  // (the engine recomputes the need and re-validates).
  | { kind: 'grapple_move'; figureId: string; to: string }
  | { kind: 'attack'; attackerId: string; targetId: string }
  // Mimring FIRE LINE (slice 8): the attack/defense dice are NOT on the wire —
  // the server rolls 4 attack dice once + each affected figure's defense.
  | { kind: 'fire_line'; attackerId: string; dir: number }
  // Player-chosen ORIENTATION (figure-presentation slice) — no dice; passed
  // through verbatim. Swings a 2-hex figure's trailing hex / sets 1-hex facing.
  | { kind: 'orient_figure'; figureId: string; dir: number }
  // Ne-Gok-Sa MIND SHACKLE (slice 8): the d20 is NOT on the wire — the server
  // rolls it; the board sends only the chosen adjacent-enemy target.
  | { kind: 'mind_shackle'; targetId: string }
  // Grimnak CHOMP (slice 8): the d20 is NOT on the wire — the server rolls it
  // (only consulted for Hero targets); the board sends the chosen adjacent enemy.
  | { kind: 'chomp'; targetId: string }
  // Airborne GRENADE SPECIAL ATTACK (slice 8): `grenade` initiates (no dice);
  // each `grenade_throw` carries only the chosen Range-5 target — the server
  // rolls the 2 attack dice + each affected figure's defense.
  | { kind: 'grenade' }
  | { kind: 'grenade_throw'; targetId: string }
  // Special powers (slice 4): the d20(s) are NOT on the wire — makeMoveHS rolls
  // them server-side and injects the values into the engine action.
  | { kind: 'berserker_charge' }
  | { kind: 'water_clone' }
  // Big Heroes special powers (slice 8b): the dice are NOT on the wire — the
  // server rolls the attack/defense combat dice (Ice Shard / Queglix / Wild
  // Swing), the d20s (Acid Breath per target; Throw's reposition + damage), and
  // Carry's move-consequence dice. The board sends only the player's choices.
  | { kind: 'ice_shard'; attackerId: string; targetId: string }
  | { kind: 'queglix'; attackerId: string; targetId: string; dice: 1 | 2 | 3 }
  | { kind: 'wild_swing'; attackerId: string; targetId: string }
  | { kind: 'acid_breath'; attackerId: string; targetIds: string[] }
  | { kind: 'throw_figure'; attackerId: string; targetId: string; to: string }
  | { kind: 'carry_move'; figureId: string; to: string; passengerId: string; passengerTo: string }
  // Airborne Elite THE DROP (slice 8): the d20 is rolled server-side; the board
  // sends only the chosen landing hexes (one per reserve Airborne figure).
  | { kind: 'the_drop' }
  | { kind: 'resolve_choice'; choice: HSChoiceResolution }
  | { kind: 'end_turn' }
  // Draft + placement (slice 5). No draft_roll on the wire — the server rolls the
  // draft order itself when entering the draft (mirrors initiative).
  | { kind: 'draft_card'; cardId: string }
  | { kind: 'draft_pass' }
  | { kind: 'place_figure'; figureId: string; to: string }
  | { kind: 'unplace_figure'; figureId: string }
  | { kind: 'placement_ready' };

/** d20 attempts until tie-free: ALL seats re-roll on any tie for highest
 *  (for 2 players that matches "the tying players re-roll", p. 9). Capped —
 *  20 consecutive ties means something is deeply wrong with Math.random. */
const HS_INITIATIVE_MAX_ATTEMPTS = 20;

/**
 * Apply a HeroScape action. Server-authoritative: the pure engine validates
 * marker placement, turn ownership, the revealed-card rule, movement
 * legality, range, and line of sight. ALL randomness happens here —
 *   • place_markers (final player): the d20 initiative, ties re-rolled
 *   • attack: the attacker's attack dice + the defender's defense dice
 * — and the values are passed into the engine (Long Shot's rollDiceLS pattern).
 */
export async function makeMoveHS(roomId: string, action: HSWireAction) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type, host_id')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'heroscape') throw new Error('Wrong game type');

  if (action.kind === 'start_game' || action.kind === 'set_lobby_config') {
    // Both happen in the waiting lobby and are host-only.
    if (room.host_id !== user.id) throw new Error('Only the host can change the battle settings');
  } else if (room.status !== 'playing') {
    throw new Error('Battle not in progress');
  }

  const state = (room.state || {}) as HSState;
  const rollDie = (): HSCombatFace =>
    HS_COMBAT_DIE_FACES[Math.floor(Math.random() * HS_COMBAT_DIE_FACES.length)];
  const rollDice = (n: number): HSCombatFace[] => Array.from({ length: n }, rollDie);
  const d20 = () => 1 + Math.floor(Math.random() * 20);

  let engineAction: HSAction;
  if (action.kind === 'attack') {
    // Roll exactly the required Attack/Defense dice counts (printed stat +
    // height advantage — the engine's single-source helper). Unknown figure
    // ids get empty rolls — the engine then rejects with its own clearer error.
    const req = hsAttackDiceRequirements(state, action.attackerId, action.targetId);
    engineAction = {
      kind: 'attack',
      attackerId: action.attackerId,
      targetId: action.targetId,
      attackRoll: rollDice(req?.attack ?? 0),
      defenseRoll: rollDice(req?.defense ?? 0),
    };
  } else if (action.kind === 'fire_line') {
    // Mimring FIRE LINE SPECIAL ATTACK — roll 4 attack dice ONCE and each
    // affected figure's defense SEPARATELY. Defenders come from the engine's
    // single-source helper (printed defense + auras, no height); the engine
    // re-derives the affected set and validates the dice shapes.
    const defenders = hsFireLineDefenders(state, action.attackerId, action.dir);
    engineAction = {
      kind: 'fire_line',
      attackerId: action.attackerId,
      dir: action.dir,
      attackRoll: rollDice(4),
      defenseRolls: defenders.map(d => ({ figureId: d.figureId, roll: rollDice(d.defense) })),
    };
  } else if (action.kind === 'grenade_throw') {
    // Airborne GRENADE — the CURRENT Elite (head of the pending throw queue)
    // lobs at the chosen target. The server rolls 2 attack dice ONCE + each
    // affected figure's defense; the engine re-derives the affected set + the
    // dice need (printed defense + auras, no height) and validates the shapes.
    const pc = state.pendingChoice;
    const throwerId = pc && pc.kind === 'grenade_throw' ? pc.throwers[0] : '';
    const defenders = hsGrenadeDefenders(state, throwerId, action.targetId);
    engineAction = {
      kind: 'grenade_throw',
      targetId: action.targetId,
      attackRoll: rollDice(2),
      defenseRolls: defenders.map(d => ({ figureId: d.figureId, roll: rollDice(d.defense) })),
    };
  } else if (action.kind === 'move_figure') {
    // The server computes the move's NEED from the engine's pure helper, then
    // rolls exactly those dice and passes them in (the engine re-validates the
    // shapes). A fall: combat dice, or a d20 for an Extreme fall. Leaving
    // engagement: one attack die per abandoned enemy. An unknown figure id
    // yields no consequences and the engine rejects the move on its own.
    const mover: HSFigure | undefined = state.figures?.find(f => f.id === action.figureId);
    const cons = mover
      ? hsMoveConsequences(state, mover, action.to)
      : { tier: 'none' as const, fallDice: 0, abandonedEnemyIds: [] as string[] };
    engineAction = {
      kind: 'move_figure',
      figureId: action.figureId,
      to: action.to,
      ...(cons.tier === 'extreme'
        ? { extremeFallD20: d20() }
        : cons.fallDice > 0
          ? { fallRoll: rollDice(cons.fallDice) }
          : {}),
      ...(cons.abandonedEnemyIds.length > 0
        ? {
            leaveRolls: cons.abandonedEnemyIds.map(enemyFigureId => ({
              enemyFigureId,
              roll: rollDie(),
            })),
          }
        : {}),
    };
  } else if (action.kind === 'grapple_move') {
    // Sgt. Drake GRAPPLE GUN (slice 7): the same server-roll seam as move_figure.
    // moveConsequences is pure start-vs-end geometry, so it yields the right fall
    // band + abandoned-enemy set for the one-space grapple destination too; the
    // engine re-validates the dice shapes (and the one-space/climb-cap legality).
    const mover: HSFigure | undefined = state.figures?.find(f => f.id === action.figureId);
    const cons = mover
      ? hsMoveConsequences(state, mover, action.to)
      : { tier: 'none' as const, fallDice: 0, abandonedEnemyIds: [] as string[] };
    engineAction = {
      kind: 'grapple_move',
      figureId: action.figureId,
      to: action.to,
      ...(cons.tier === 'extreme'
        ? { extremeFallD20: d20() }
        : cons.fallDice > 0
          ? { fallRoll: rollDice(cons.fallDice) }
          : {}),
      ...(cons.abandonedEnemyIds.length > 0
        ? {
            leaveRolls: cons.abandonedEnemyIds.map(enemyFigureId => ({
              enemyFigureId,
              roll: rollDie(),
            })),
          }
        : {}),
    };
  } else if (action.kind === 'berserker_charge') {
    // Tarn BERSERKER CHARGE — the server rolls the single d20; the engine
    // validates timing + threshold and (on 15+) opens the optional re-move.
    engineAction = { kind: 'berserker_charge', d20: d20() };
  } else if (action.kind === 'mind_shackle') {
    // Ne-Gok-Sa MIND SHACKLE — the server rolls the single d20; the engine
    // validates the adjacent-enemy target + timing and, on a natural 20, seizes
    // the target's whole Army Card.
    engineAction = { kind: 'mind_shackle', targetId: action.targetId, d20: d20() };
  } else if (action.kind === 'chomp') {
    // Grimnak CHOMP — the server rolls the d20 (used only if the target is a
    // Hero; a Squad figure is destroyed automatically). The engine validates the
    // adjacent-enemy + medium/small-size + timing.
    engineAction = { kind: 'chomp', targetId: action.targetId, d20: d20() };
  } else if (action.kind === 'water_clone') {
    // Marro WATER CLONE — roll one d20 per LIVING Marro Warrior of the active
    // card; the engine validates the set + per-Warrior threshold and collects
    // the placement choices.
    const activeUid = hsGetActiveCardUid(state);
    const livingMarro = (state.figures ?? []).filter(
      f => f.cardUid === activeUid && f.at != null,
    );
    engineAction = {
      kind: 'water_clone',
      rolls: livingMarro.map(f => ({ marroFigureId: f.id, d20: d20() })),
    };
  } else if (action.kind === 'ice_shard') {
    // Nilfheim ICE SHARD BREATH — one of up to 3 shots. Roll 4 attack dice + the
    // target's effective defense (printed + auras, no height — a special attack).
    const tgt = state.figures?.find(f => f.id === action.targetId);
    const atk = state.figures?.find(f => f.id === action.attackerId);
    const defDice = tgt && atk ? Math.max(0, hsEffectiveDefenseDice(state, tgt, atk).dice) : 0;
    engineAction = {
      kind: 'ice_shard',
      attackerId: action.attackerId,
      targetId: action.targetId,
      attackRoll: rollDice(4),
      defenseRoll: rollDice(defDice),
    };
  } else if (action.kind === 'queglix') {
    // Major Q9 QUEGLIX GUN — a `dice`-die shot from the 9-die pool. Roll `dice`
    // attack dice + the target's effective defense.
    const tgt = state.figures?.find(f => f.id === action.targetId);
    const atk = state.figures?.find(f => f.id === action.attackerId);
    const defDice = tgt && atk ? Math.max(0, hsEffectiveDefenseDice(state, tgt, atk).dice) : 0;
    engineAction = {
      kind: 'queglix',
      attackerId: action.attackerId,
      targetId: action.targetId,
      dice: action.dice,
      attackRoll: rollDice(action.dice),
      defenseRoll: rollDice(defDice),
    };
  } else if (action.kind === 'wild_swing') {
    // Jotun WILD SWING — roll 4 attack dice ONCE + each affected figure's defense
    // SEPARATELY (target + figures adjacent to it, minus Jotun). The engine
    // re-derives the affected set and validates the shapes.
    const defenders = hsWildSwingDefenders(state, action.attackerId, action.targetId);
    engineAction = {
      kind: 'wild_swing',
      attackerId: action.attackerId,
      targetId: action.targetId,
      attackRoll: rollDice(4),
      defenseRolls: defenders.map(d => ({ figureId: d.figureId, roll: rollDice(d.defense) })),
    };
  } else if (action.kind === 'acid_breath') {
    // Braxas POISONOUS ACID BREATH — one d20 per chosen figure (Squad 8+, Hero
    // 17+ destroy). The engine re-validates the legal target set + thresholds.
    engineAction = {
      kind: 'acid_breath',
      attackerId: action.attackerId,
      rolls: action.targetIds.map(targetId => ({ targetId, d20: d20() })),
    };
  } else if (action.kind === 'throw_figure') {
    // Jotun THROW — the server rolls the throw d20 (14+ succeeds) and the damage
    // d20 (11+ → 2 wounds). The engine applies the landing/level/water rules.
    engineAction = {
      kind: 'throw_figure',
      attackerId: action.attackerId,
      targetId: action.targetId,
      to: action.to,
      throwD20: d20(),
      damageD20: d20(),
    };
  } else if (action.kind === 'carry_move') {
    // Theracus CARRY — his flight uses the SAME move-consequence seam as
    // move_figure (a flyer never falls, but a takeoff-while-engaged can be swiped);
    // the passenger is then placed adjacent to his new position (no dice).
    const mover: HSFigure | undefined = state.figures?.find(f => f.id === action.figureId);
    const cons = mover
      ? hsMoveConsequences(state, mover, action.to)
      : { tier: 'none' as const, fallDice: 0, abandonedEnemyIds: [] as string[] };
    engineAction = {
      kind: 'carry_move',
      figureId: action.figureId,
      to: action.to,
      passengerId: action.passengerId,
      passengerTo: action.passengerTo,
      ...(cons.tier === 'extreme'
        ? { extremeFallD20: d20() }
        : cons.fallDice > 0
          ? { fallRoll: rollDice(cons.fallDice) }
          : {}),
      ...(cons.abandonedEnemyIds.length > 0
        ? { leaveRolls: cons.abandonedEnemyIds.map(enemyFigureId => ({ enemyFigureId, roll: rollDie() })) }
        : {}),
    };
  } else if (action.kind === 'the_drop') {
    // Airborne Elite THE DROP — ROLL only: the server rolls the d20 (global). On
    // 13+ the engine opens an `airborne_drop` pending choice; the landings then
    // arrive as a separate resolve_choice once the player has seen the roll.
    engineAction = { kind: 'the_drop', d20: d20() };
  } else if (action.kind === 'resolve_choice') {
    engineAction = { kind: 'resolve_choice', choice: action.choice };
  } else if (action.kind === 'start_game') {
    engineAction = { kind: 'start_game', mapId: action.mapId, pointBudget: action.pointBudget, mode: action.mode };
  } else {
    // place_markers / draft_card / draft_pass / place_figure / unplace_figure /
    // placement_ready — no server-rolled dice; pass through verbatim.
    engineAction = action;
  }

  let next = applyActionHS(state, user.id, engineAction);
  if ('error' in next) throw new Error(next.error);

  // The LAST lock-in triggers initiative in the same request: roll a d20 per
  // seat, re-roll everyone on any tie for highest, and apply the tie-free
  // sequence through the engine. The engine re-validates everything (ready
  // gate, attempt shapes, the tie discipline), so a bug here fails loudly
  // instead of corrupting the round.
  if (
    action.kind === 'place_markers' &&
    next.subPhase === 'place_markers' &&
    next.markersReady.length === next.players.length
  ) {
    // Glyph of Dagmar (slice 4): +8 to its controller's initiative. Determine
    // control from the post-placement state (a living figure of that seat on a
    // power-side-up Dagmar glyph), then carry raw+bonus so the engine re-checks.
    const afterPlace: HSState = next;
    const dagmarBonus = (seat: number): number => {
      const controls = (afterPlace.glyphs ?? []).some(
        g =>
          g.id === 'dagmar' &&
          g.faceUp &&
          HS_GLYPHS.dagmar.active &&
          (afterPlace.figures ?? []).some(f => f.at === g.at && f.ownerSeat === seat),
      );
      return controls ? 8 : 0;
    };
    // Re-roll everyone on any tie for highest (Dagmar's +8 carries into re-rolls).
    const attempts: HSInitiativeAttempt[] = [];
    for (let i = 0; i < HS_INITIATIVE_MAX_ATTEMPTS; i++) {
      const attempt = next.players.map(p => {
        const raw = d20();
        const bonus = dagmarBonus(p.seat);
        return bonus > 0
          ? { seat: p.seat, roll: raw + bonus, raw, bonus }
          : { seat: p.seat, roll: raw };
      });
      attempts.push(attempt);
      const max = Math.max(...attempt.map(a => a.roll));
      if (attempt.filter(a => a.roll === max).length === 1) break;
    }
    const last = attempts[attempts.length - 1];
    const lastMax = Math.max(...last.map(a => a.roll));
    if (last.filter(a => a.roll === lastMax).length !== 1) {
      throw new Error('Initiative would not resolve after 20 attempts — try again');
    }
    const rolled = applyActionHS(next, user.id, { kind: 'roll_initiative', attempts });
    if ('error' in rolled) throw new Error(rolled.error);
    next = rolled;
  }

  // Entering the DRAFT (slice 5): roll the draft order in the same request —
  // both seats roll a plain d20, re-roll everyone on any tie for highest (capped
  // at 20). The engine re-validates the tie discipline and sets the pick order.
  if (action.kind === 'start_game' && next.phase === 'draft' && (next.draft?.order.length ?? 0) === 0) {
    const attempts: HSInitiativeAttempt[] = [];
    for (let i = 0; i < HS_INITIATIVE_MAX_ATTEMPTS; i++) {
      const attempt = next.players.map(p => ({ seat: p.seat, roll: d20() }));
      attempts.push(attempt);
      const max = Math.max(...attempt.map(a => a.roll));
      if (attempt.filter(a => a.roll === max).length === 1) break;
    }
    const last = attempts[attempts.length - 1];
    const lastMax = Math.max(...last.map(a => a.roll));
    if (last.filter(a => a.roll === lastMax).length !== 1) {
      throw new Error('Draft order would not resolve after 20 attempts — try again');
    }
    const rolled = applyActionHS(next, user.id, { kind: 'draft_roll', attempts });
    if ('error' in rolled) throw new Error(rolled.error);
    next = rolled;
  }

  const updates: { state: HSState; status?: string; rematch_votes?: string[]; abandon_votes?: string[] } = {
    state: next,
    abandon_votes: [],
  };
  if (action.kind === 'start_game') updates.status = 'playing';
  if (next.phase === 'finished') {
    updates.status = 'finished';
    updates.rematch_votes = [];
  }
  await supabase.from('rooms').update(updates).eq('id', roomId);

  if (next.phase === 'finished') {
    await recordHistoryIfFinished(supabase, roomId, 'heroscape', next);
  }
  await notifyRoom(roomId);
}

/** Host-only: change the Boggle game mode while still in the lobby. */
export async function setBoggleMode(roomId: string, mode: BoggleGameMode) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type, host_id')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'boggle') throw new Error('Wrong game type');
  if (room.host_id !== user.id) throw new Error('Only the host can change the mode');

  const next = bgSetGameMode((room.state || {}) as BoggleState, mode);
  if ('error' in next) throw new Error(next.error);

  await supabase.from('rooms').update({ state: next }).eq('id', roomId);
  await notifyRoom(roomId);
}

/** Host-only: start the next Boggle round from the between-rounds break. */
export async function startBoggleNextRound(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type, host_id')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'boggle') throw new Error('Wrong game type');
  if (room.host_id !== user.id) throw new Error('Only the host can start the next round');

  const next = bgNextRound((room.state || {}) as BoggleState);
  if ('error' in next) throw new Error(next.error);

  await supabase.from('rooms').update({ state: next }).eq('id', roomId);
  await notifyRoom(roomId);
}

/**
 * Submit a Boggle word. Validates time, adjacency (engine), then the dictionary
 * (server-only Set lookup). Returns a structured result so the UI can show why
 * a word was rejected instead of throwing a generic production error.
 */
export async function submitWordBoggle(
  roomId: string,
  word: string,
): Promise<{ ok: true; word: string } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'Not signed in' };

    const { data: room, error } = await supabase
      .from('rooms')
      .select('id, state, status, game_type')
      .eq('id', roomId)
      .single();
    if (error || !room) return { ok: false, error: 'Room not found' };
    if (room.game_type !== 'boggle') return { ok: false, error: 'Wrong game type' };
    if (room.status !== 'playing')   return { ok: false, error: 'Round not in progress' };

    const state = (room.state || {}) as BoggleState;

    // Engine-side checks (time, length, adjacency, dupes)
    const next = bgSubmitWord(state, user.id, word);
    if ('error' in next) return { ok: false, error: next.error };

    // Dictionary check — only after the engine accepts the word
    const upper = word.trim().toUpperCase();
    const valid = await bgIsWord(upper);
    if (!valid) return { ok: false, error: `"${upper}" is not in the dictionary` };

    await supabase.from('rooms').update({ state: next }).eq('id', roomId);
    await notifyRoom(roomId);
    return { ok: true, word: upper };
  } catch (e) {
    console.error('[submitWordBoggle]', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Called by clients when the round timer hits 0. The first caller wins the race
 * to finalize; subsequent callers no-op because phase is already 'finished'.
 * Records game history with the winner (highest total; null on tie).
 */
export async function finalizeBoggleIfExpired(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: room } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (!room || room.game_type !== 'boggle') return;
  if (room.status === 'finished') return;

  const state = (room.state || {}) as BoggleState;
  if (bgMsRemaining(state) > 0) return; // not actually expired yet

  const finalized = bgFinalize(state);
  // Multi-round modes go to 'between-rounds' first; only the final round flips
  // the room status to 'finished'.
  const roomStatus = finalized.phase === 'finished' ? 'finished' : 'playing';
  await supabase
    .from('rooms')
    .update({ state: finalized, status: roomStatus, rematch_votes: [], abandon_votes: [] })
    .eq('id', roomId);

  // Record game history only once, when the multi-round game actually ends
  await recordHistoryIfFinished(supabase, roomId, 'boggle', finalized);
  await notifyRoom(roomId);
}

export async function makeMoveBattleship(roomId: string, payload: BSPayload) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'battleship') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = applyMoveBS(room.state as BSState, user.id, payload);
  if ('error' in next) throw new Error(next.error);

  await supabase
    .from('rooms')
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [], abandon_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistoryIfFinished(supabase, roomId, 'battleship', next);
  await notifyRoom(roomId);
}

export async function makeMoveC4(roomId: string, col: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'connect4') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = applyMoveC4(room.state as C4State, col, user.id);
  if ('error' in next) throw new Error(next.error);

  await supabase
    .from('rooms')
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [], abandon_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistoryIfFinished(supabase, roomId, 'connect4', next);
  await notifyRoom(roomId);
}

// =====================================================================
// Liar's Dice actions
// =====================================================================

export async function placeBidLD(roomId: string, quantity: number, face: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'liarsdice') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = ldPlaceBid((room.state || {}) as LDState, user.id, quantity, face);
  if ('error' in next) throw new Error(next.error);

  await supabase.from('rooms').update({ state: next }).eq('id', roomId);
  await notifyRoom(roomId);
}

export async function callLiarLD(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'liarsdice') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = ldCallLiar((room.state || {}) as LDState, user.id);
  if ('error' in next) throw new Error(next.error);

  const updates: { state: LDState; status?: string; rematch_votes?: string[]; abandon_votes?: string[] } = {
    state: next,
    abandon_votes: [],
  };
  if (next.phase === 'finished') {
    updates.status = 'finished';
    updates.rematch_votes = [];
  }
  await supabase.from('rooms').update(updates).eq('id', roomId);
  await recordHistoryIfFinished(supabase, roomId, 'liarsdice', next);
  await notifyRoom(roomId);
}

/** Anyone may advance from between-rounds; the engine just rerolls and resets the bid. */
export async function startNextRoundLD(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type, room_players(player_id)')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'liarsdice') throw new Error('Wrong game type');
  if (!(room.room_players as { player_id: string }[]).some(p => p.player_id === user.id)) {
    throw new Error('Not a seated player');
  }

  const next = ldStartNextRound((room.state || {}) as LDState);
  if ('error' in next) throw new Error(next.error);

  await supabase.from('rooms').update({ state: next }).eq('id', roomId);
  await notifyRoom(roomId);
}

// =====================================================================
// Yahtzee actions
// =====================================================================

export async function rollDiceYZ(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'yahtzee') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = yzRoll((room.state || {}) as YState, user.id);
  if ('error' in next) throw new Error(next.error);

  await supabase.from('rooms').update({ state: next }).eq('id', roomId);
  await notifyRoom(roomId);
}

export async function toggleHoldYZ(roomId: string, dieIdx: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'yahtzee') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = yzToggleHold((room.state || {}) as YState, user.id, dieIdx);
  if ('error' in next) throw new Error(next.error);

  await supabase.from('rooms').update({ state: next }).eq('id', roomId);
  await notifyRoom(roomId);
}

export async function commitScoreYZ(roomId: string, category: YCategory) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, state, status, game_type')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.game_type !== 'yahtzee') throw new Error('Wrong game type');
  if (room.status !== 'playing') throw new Error('Game not in progress');

  const next = yzCommitScore((room.state || {}) as YState, user.id, category);
  if ('error' in next) throw new Error(next.error);

  const updates: { state: YState; status?: string; rematch_votes?: string[]; abandon_votes?: string[] } = {
    state: next,
    abandon_votes: [],
  };
  if (next.phase === 'finished') {
    updates.status = 'finished';
    updates.rematch_votes = [];
  }
  await supabase.from('rooms').update(updates).eq('id', roomId);
  await recordHistoryIfFinished(supabase, roomId, 'yahtzee', next);
  await notifyRoom(roomId);
}

export async function sendChat(roomId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase.from('chat_messages').insert({
    room_id: roomId, sender_id: user.id, body: trimmed.slice(0, 500),
  });
  await notifyRoom(roomId);
}

/**
 * Vote for a rematch. When all seated players have voted, reset the board with swapped seats
 * and put the room back into `playing` status.
 */
export async function proposeRematch(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: room, error } = await supabase
    .from('rooms')
    .select('id, game_type, status, state, rematch_votes, room_players(player_id, seat)')
    .eq('id', roomId)
    .single();
  if (error || !room) throw new Error('Room not found');
  if (room.status !== 'finished') throw new Error('Game is not finished');

  // For TTT/Connect4 only seats 0 and 1 are game seats; multi-player games count
  // every seated player.
  const allSeated = room.room_players as { player_id: string; seat: number }[];
  const multiPlayer = room.game_type === 'longshot' || room.game_type === 'boggle' || room.game_type === 'liarsdice' || room.game_type === 'yahtzee';
  const seated = multiPlayer
    ? allSeated
    : allSeated.filter(p => p.seat === 0 || p.seat === 1);
  if (!seated.some(p => p.player_id === user.id)) throw new Error('Not a seated player');

  const votes = new Set((room.rematch_votes as string[]) || []);
  votes.add(user.id);

  // Solo games (e.g. 1-player Yahtzee) can rematch as soon as the lone player votes.
  const minVoters = (GAMES[room.game_type]?.minPlayers ?? 2);
  const everyone = seated.length >= minVoters && seated.every(p => votes.has(p.player_id));

  if (!everyone) {
    await supabase.from('rooms').update({ rematch_votes: Array.from(votes) }).eq('id', roomId);
    return { restarted: false };
  }

  // Reset the board.
  let newState: TTTState | C4State | CheckersState | BSState | BoggleState | LSState | LDState | YState | RPSState | SDState;
  if (room.game_type === 'tictactoe') {
    const oldSeats = ((room.state || {}) as { seats?: Record<string, string> }).seats ?? {};
    newState = { ...tttInitial(), seats: { X: oldSeats.O ?? '', O: oldSeats.X ?? '' } };
  } else if (room.game_type === 'connect4') {
    const oldSeats = ((room.state || {}) as { seats?: Record<string, string> }).seats ?? {};
    newState = { ...c4Initial(), seats: { R: oldSeats.Y ?? '', Y: oldSeats.R ?? '' } };
  } else if (room.game_type === 'checkers') {
    const oldSeats = ((room.state || {}) as { seats?: Record<string, string> }).seats ?? {};
    newState = { ...ckInitial(), seats: { R: oldSeats.B ?? '', B: oldSeats.R ?? '' } };
  } else if (room.game_type === 'battleship') {
    const oldSeats = ((room.state || {}) as { seats?: Record<string, string> }).seats ?? {};
    newState = { ...bsInitial(), seats: { A: oldSeats.B ?? '', B: oldSeats.A ?? '' } };
  } else if (room.game_type === 'rps') {
    // Rematch: swap seats so the player who had A last game gets B this time.
    const oldSeats = ((room.state || {}) as { seats?: Record<string, string> }).seats ?? {};
    newState = { ...rpsInitial(), seats: { A: oldSeats.B ?? '', B: oldSeats.A ?? '' } };
  } else if (room.game_type === 'spellduel') {
    // Rebuild a fresh duel with swapped seats. Pull username+accent from the
    // old state's players (already populated by createInitialStateForHost +
    // seatJoinerAndStart, so no extra DB roundtrip needed).
    const oldState = (room.state || {}) as SDState;
    const playerA = oldState.players.A;
    const playerB = oldState.players.B;
    const host = sdCreateInitialStateForHost({
      userId: playerB.playerId,
      username: playerB.username,
      accent_color: playerB.accent_color,
    });
    newState = sdSeatJoinerAndStart(host, {
      userId: playerA.playerId,
      username: playerA.username,
      accent_color: playerA.accent_color,
    });
  } else if (room.game_type === 'longshot') {
    // Reset to a fresh Long Shot game with the same seated players. startRace re-randomizes
    // the starting seat, the concession grid, and the pre-marked bets/concessions, so each
    // rematch plays differently even with the same lineup. Accent colors carry over.
    const oldState = (room.state || {}) as LSState;
    let lsState = lsInitialState();
    for (const p of [...oldState.players].sort((a, b) => a.seat - b.seat)) {
      lsState = lsAddPlayer(lsState, p.playerId, p.username, p.seat, p.accent_color);
    }
    const started = lsStartRace(lsState);
    if ('error' in started) throw new Error(started.error);
    newState = started;
  } else if (room.game_type === 'boggle') {
    const oldState = (room.state || {}) as BoggleState;
    let bgState = bgInitial();
    for (const p of [...oldState.players].sort((a, b) => a.seat - b.seat)) {
      bgState = bgAddPlayer(bgState, p.playerId, p.username, p.seat, p.accent_color);
    }
    const started = bgStartGame(bgState);
    if ('error' in started) throw new Error(started.error);
    newState = started;
  } else if (room.game_type === 'liarsdice') {
    const oldState = (room.state || {}) as LDState;
    let ldState = ldInitial();
    for (const p of [...oldState.players].sort((a, b) => a.seat - b.seat)) {
      ldState = ldAddPlayer(ldState, p.playerId, p.username, p.seat, p.accent_color);
    }
    const started = ldStartGame(ldState);
    if ('error' in started) throw new Error(started.error);
    newState = started;
  } else if (room.game_type === 'yahtzee') {
    const oldState = (room.state || {}) as YState;
    let yzState = yzInitial();
    for (const p of [...oldState.players].sort((a, b) => a.seat - b.seat)) {
      yzState = yzAddPlayer(yzState, p.playerId, p.username, p.seat, p.accent_color);
    }
    const started = yzStartGame(yzState);
    if ('error' in started) throw new Error(started.error);
    newState = started;
  } else {
    throw new Error('Unsupported game type');
  }

  await supabase
    .from('rooms')
    .update({ state: newState, status: 'playing', rematch_votes: [], abandon_votes: [] })
    .eq('id', roomId);

  await notifyRoom(roomId);
  return { restarted: true };
}
