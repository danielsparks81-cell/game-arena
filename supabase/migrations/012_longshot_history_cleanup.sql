-- 012_longshot_history_cleanup.sql
--
-- One-off cleanup for the Long Shot history bug.
--
-- Before the fix in registry.ts, Long Shot's computeHistory returned a winner
-- for ANY in-progress state, and the server calls recordHistoryIfFinished
-- after every roll AND every action — so a game_history row was inserted on
-- every move of a race. That inflated players' W/L records with dozens of
-- phantom wins/losses per game.
--
-- This deletes the phantom rows, keeping only the LAST history row per Long
-- Shot room (the highest bigserial id = the final standings written closest
-- to race end). Legit one-row-per-completed-race history is preserved; only
-- the per-move duplicates are removed.
--
-- Safe to run more than once (idempotent: after the first run there is at most
-- one longshot row per room, so the self-join matches nothing).
--
-- NOTE: this only affects game_type = 'longshot'. Other games never had the
-- bug (their computeHistory gates on phase==='finished').

delete from public.game_history a
using public.game_history b
where a.game_type = 'longshot'
  and b.game_type = 'longshot'
  and a.room_id  = b.room_id
  and a.id < b.id;
