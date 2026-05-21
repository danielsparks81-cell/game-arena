-- =====================================================================
-- Migration: abandon-match votes
-- Adds a per-room set of player IDs who have voted to abandon a live game.
-- When every seated player has voted, the room finishes WITHOUT writing
-- a game_history row, so no W/L is recorded. Cleared on game end / start
-- of a new round just like rematch_votes.
-- Safe to re-run.
-- =====================================================================

alter table public.rooms
  add column if not exists abandon_votes uuid[] not null default '{}';
