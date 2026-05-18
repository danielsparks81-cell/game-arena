'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
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
  calculateFinalScores as lsCalculateFinalScores,
  compareFinalScores as lsCompareFinalScores,
  MOVEMENT_DIE_FACES,
  type LSState,
  type ActionPayload,
} from '@/lib/games/longshot';

/**
 * Push a "room changed" event over Supabase Realtime broadcast so every connected client
 * refetches immediately. This is more reliable than relying on postgres_changes alone,
 * which can lag or silently drop with RLS in some Supabase configurations.
 */
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

  if (room.game_type === 'longshot') {
    // Long Shot: stay in 'waiting' until host clicks Start. Add player to game state.
    const { data: profile } = await supabase
      .from('profiles').select('username').eq('id', user.id).single();
    const username = profile?.username ?? 'player';
    const newState = lsAddPlayer((room.state || {}) as LSState, user.id, username, seat);
    await supabase.from('rooms').update({ state: newState }).eq('id', roomId);
  } else if (room.game_type === 'boggle') {
    // Boggle: same join model — wait in lobby for the host to roll the board
    const { data: profile } = await supabase
      .from('profiles').select('username').eq('id', user.id).single();
    const username = profile?.username ?? 'player';
    const newState = bgAddPlayer((room.state || {}) as BoggleState, user.id, username, seat);
    await supabase.from('rooms').update({ state: newState }).eq('id', roomId);
  } else {
    // Tic-Tac-Toe / Connect Four: auto-start when 2nd player joins.
    const state = (room.state || {}) as Record<string, unknown> & { seats?: Record<string, string> };
    const seats = { ...(state.seats || {}) };
    if (seat === 1) {
      if (room.game_type === 'tictactoe'  && !seats.O) seats.O = user.id;
      if (room.game_type === 'connect4'   && !seats.Y) seats.Y = user.id;
      if (room.game_type === 'checkers'   && !seats.B) seats.B = user.id;
      if (room.game_type === 'battleship' && !seats.B) seats.B = user.id;
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
  if (next.phase === 'finished') await recordLongShotHistory(supabase, roomId, next);
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
  if (next.phase === 'finished') await recordLongShotHistory(supabase, roomId, next);
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
  if (room.room_players.length < 2) throw new Error('Need at least 2 players');

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

export async function leaveRoom(roomId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  await supabase.from('room_players').delete().eq('room_id', roomId).eq('player_id', user.id);
  await notifyRoom(roomId);
  revalidatePath(`/rooms/${roomId}`);
}

/** Insert a game_history row when a game finishes. Idempotent: caller decides when. */
async function recordHistory(
  supabase: SupabaseClient,
  roomId: string,
  gameType: string,
  seats: Record<string, string>,
  winner: 'X' | 'O' | 'R' | 'Y' | 'A' | 'B' | 'draw',
) {
  const playerIds = Object.values(seats).filter(Boolean) as string[];
  const winnerId = winner === 'draw' ? null : seats[winner] ?? null;
  await supabase.from('game_history').insert({
    room_id: roomId,
    game_type: gameType,
    winner_id: winnerId,
    player_ids: playerIds,
  });
}

/**
 * Long Shot history record — winner = player with the highest final score.
 * On a tie at the top, winner_id is null (treated as a draw for W/L stats).
 */
async function recordLongShotHistory(
  supabase: SupabaseClient,
  roomId: string,
  state: LSState,
) {
  const scores = [...lsCalculateFinalScores(state)].sort(lsCompareFinalScores);
  if (scores.length === 0) return;
  // After total + best-podium tiebreaker, only consider it a true tie if the top two
  // are exactly equal on BOTH metrics.
  const isTie =
    scores.length > 1 &&
    scores[0].total === scores[1].total &&
    (scores[0].bestPodium ?? 4) === (scores[1].bestPodium ?? 4);
  await supabase.from('game_history').insert({
    room_id: roomId,
    game_type: 'longshot',
    winner_id: isTie ? null : scores[0].playerId,
    player_ids: scores.map(s => s.playerId),
  });
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
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistory(supabase, roomId, 'tictactoe', next.seats as Record<string, string>, next.winner);
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
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [] })
    .eq('id', roomId);

  if (next.winner) {
    const seats = next.seats as Record<string, string>;
    await recordHistory(supabase, roomId, 'checkers', seats, next.winner);
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
    .update({ state: finalized, status: roomStatus, rematch_votes: [] })
    .eq('id', roomId);

  // Record game history only once, when the multi-round game actually ends
  if (finalized.phase === 'finished') {
    const ranked = [...(finalized.finalResults ?? [])].sort((a, b) => b.total - a.total);
    if (ranked.length > 0) {
      const tie = ranked.length > 1 && ranked[0].total === ranked[1].total;
      await supabase.from('game_history').insert({
        room_id: roomId,
        game_type: 'boggle',
        winner_id: tie ? null : ranked[0].playerId,
        player_ids: ranked.map(r => r.playerId),
      });
    }
  }
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
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [] })
    .eq('id', roomId);

  if (next.winner) {
    const seats = next.seats as Record<string, string>;
    await recordHistory(supabase, roomId, 'battleship', seats, next.winner);
  }
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
    .update({ state: next, status: next.winner ? 'finished' : 'playing', rematch_votes: [] })
    .eq('id', roomId);

  if (next.winner) await recordHistory(supabase, roomId, 'connect4', next.seats as Record<string, string>, next.winner);
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

  // For TTT/Connect4 only seats 0 and 1 are game seats; for Long Shot every seated
  // player counts (up to 8).
  const allSeated = room.room_players as { player_id: string; seat: number }[];
  const seated = room.game_type === 'longshot'
    ? allSeated
    : allSeated.filter(p => p.seat === 0 || p.seat === 1);
  if (!seated.some(p => p.player_id === user.id)) throw new Error('Not a seated player');

  const votes = new Set((room.rematch_votes as string[]) || []);
  votes.add(user.id);

  const everyone = seated.length >= 2 && seated.every(p => votes.has(p.player_id));

  if (!everyone) {
    await supabase.from('rooms').update({ rematch_votes: Array.from(votes) }).eq('id', roomId);
    return { restarted: false };
  }

  // Reset the board.
  let newState: TTTState | C4State | CheckersState | BSState | BoggleState | LSState;
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
  } else if (room.game_type === 'longshot') {
    // Reset to a fresh Long Shot game with the same seated players. startRace re-randomizes
    // the starting seat, the concession grid, and the pre-marked bets/concessions, so each
    // rematch plays differently even with the same lineup.
    const oldState = (room.state || {}) as LSState;
    let lsState = lsInitialState();
    for (const p of [...oldState.players].sort((a, b) => a.seat - b.seat)) {
      lsState = lsAddPlayer(lsState, p.playerId, p.username, p.seat);
    }
    const started = lsStartRace(lsState);
    if ('error' in started) throw new Error(started.error);
    newState = started;
  } else if (room.game_type === 'boggle') {
    // Reset Boggle to lobby phase with same seated players + a fresh roll on next Start
    const oldState = (room.state || {}) as BoggleState;
    let bgState = bgInitial();
    for (const p of [...oldState.players].sort((a, b) => a.seat - b.seat)) {
      bgState = bgAddPlayer(bgState, p.playerId, p.username, p.seat);
    }
    const started = bgStartGame(bgState);
    if ('error' in started) throw new Error(started.error);
    newState = started;
  } else {
    throw new Error('Unsupported game type');
  }

  await supabase
    .from('rooms')
    .update({ state: newState, status: 'playing', rematch_votes: [] })
    .eq('id', roomId);

  await notifyRoom(roomId);
  return { restarted: true };
}
