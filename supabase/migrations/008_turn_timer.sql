-- =====================================================================
-- Migration: per-turn timer
-- Adds a timestamp set whenever the room's game state mutates. The client
-- derives "seconds since this turn started" from this value and renders a
-- 60-second countdown next to the active player's hourglass. No enforcement
-- (this is a social nudge only; the server doesn't auto-forfeit at 0).
--
-- Auto-maintained via a BEFORE UPDATE trigger: anytime the `state` column
-- changes (`is distinct from`), turn_started_at is bumped to now(). This
-- means the timer resets on every move, in every game, with zero changes
-- to the engine or server-action code.
-- Safe to re-run.
-- =====================================================================

alter table public.rooms
  add column if not exists turn_started_at timestamptz;

create or replace function public.set_turn_started_at()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.state is distinct from OLD.state then
    NEW.turn_started_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists rooms_set_turn_started_at on public.rooms;
create trigger rooms_set_turn_started_at
  before update on public.rooms
  for each row
  execute function public.set_turn_started_at();

-- Backfill: stamp existing live rooms so their timer starts now rather than
-- showing "100+ seconds" for ongoing games as soon as the column appears.
update public.rooms
   set turn_started_at = now()
 where status = 'playing'
   and turn_started_at is null;
