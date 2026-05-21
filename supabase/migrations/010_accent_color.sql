-- =====================================================================
-- Migration: per-player accent color
-- A single hex string the player picks on their profile. Used for:
--   • their username in the MembersPanel "In game" + "Online" lists
--   • their username in the lobby's online players list
--   • their player row/badge in multi-player game boards (Long Shot,
--     Yahtzee, Liar's Dice, Boggle) so their identity carries across games
--
-- Defaults to emerald-500 for any existing or new profile that hasn't yet
-- opened the color picker on the profile page.
-- Safe to re-run.
-- =====================================================================

alter table public.profiles
  add column if not exists accent_color text not null default '#10b981';

-- Rebuild user_stats so it surfaces accent_color alongside the W/L/D
-- aggregates. Lets the lobby/profile UI color usernames in one trip.
drop view if exists public.user_stats;
create view public.user_stats
with (security_invoker = true)
as
select
  p.id           as user_id,
  p.username,
  p.accent_color,
  count(gh.*) filter (where gh.winner_id = p.id)                                as wins,
  count(gh.*) filter (where gh.winner_id is not null and gh.winner_id <> p.id) as losses,
  count(gh.*) filter (where gh.winner_id is null and gh.id is not null)         as draws,
  count(gh.*)                                                                   as games
from public.profiles p
left join public.game_history gh on p.id = any(gh.player_ids)
group by p.id, p.username, p.accent_color;

grant select on public.user_stats to authenticated;
