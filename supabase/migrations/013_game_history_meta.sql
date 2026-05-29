-- 013_game_history_meta.sql
--
-- Adds a general-purpose `meta` JSONB column to game_history for per-game
-- analytics payloads. Legendary records {result, mastermind, scheme,
-- heroClasses[], playerCount} here so /legendary-stats can aggregate
-- win-rates per Mastermind / Scheme / Hero class by player count.
--
-- The server (recordHistoryIfFinished) writes meta when present and falls
-- back to a meta-less insert if this column is missing, so history recording
-- keeps working even before this migration is applied — but stats will be
-- empty until it is.

alter table public.game_history
  add column if not exists meta jsonb;

-- Helps the stats page filter quickly to Legendary rows that carry meta.
create index if not exists game_history_legendary_meta_idx
  on public.game_history (game_type)
  where meta is not null;
