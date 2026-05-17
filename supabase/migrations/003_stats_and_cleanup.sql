-- =====================================================================
-- Migration: per-user stats view + stale-room cleanup
-- Safe to re-run.
-- =====================================================================

-- ---------- user_stats view ----------
-- Aggregates W/L/D per profile from game_history.
-- security_invoker = true means the caller's RLS applies (game_history is
-- readable by any authenticated user, so this works for everyone).
drop view if exists public.user_stats;
create view public.user_stats
with (security_invoker = true)
as
select
  p.id        as user_id,
  p.username,
  count(gh.*) filter (where gh.winner_id = p.id)                                as wins,
  count(gh.*) filter (where gh.winner_id is not null and gh.winner_id <> p.id) as losses,
  count(gh.*) filter (where gh.winner_id is null and gh.id is not null)         as draws,
  count(gh.*)                                                                   as games
from public.profiles p
left join public.game_history gh on p.id = any(gh.player_ids)
group by p.id, p.username;

grant select on public.user_stats to authenticated;

-- ---------- cleanup_stale_rooms() ----------
-- Marks waiting/playing rooms as finished if they haven't been touched in 15 min.
-- security definer because most callers can't update rooms they're not seated in.
create or replace function public.cleanup_stale_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with updated as (
    update public.rooms
       set status = 'finished'
     where status in ('waiting', 'playing')
       and updated_at < now() - interval '15 minutes'
    returning 1
  )
  select count(*) into affected from updated;
  return affected;
end;
$$;

grant execute on function public.cleanup_stale_rooms() to authenticated;
