-- =====================================================================
-- Migration: only accrue per-player time while the game is PLAYING
--
-- Bug: the per-player cumulative-time badge counted lobby/setup time. The
-- turn-timer trigger (008/009) accrues `now() - turn_started_at` to the OLD
-- active player on EVERY state change, with no room-status guard. Two ways
-- that leaked lobby time into the counter:
--   1. State mutations during the waiting lobby (game-specific setup that
--      changes `state`) accrued time to whatever compute_active_player()
--      resolved from the lobby state.
--   2. The waiting -> playing transition itself changes `state`; with
--      turn_started_at having been stamped during the lobby, ALL the
--      pre-game wait got dumped onto the first active player on move one.
--
-- Fix: only accrue time when the room was ALREADY 'playing' before this
-- update (OLD.status = 'playing'). turn_started_at is still reset on every
-- state change, so when the game begins (waiting -> playing) the first
-- turn's clock starts fresh at game start — exactly "start the count when
-- the game begins". The live countdown in MembersPanel already gates on
-- status = 'playing', so no client change is needed.
--
-- Safe to re-run.
-- =====================================================================

create or replace function public.set_turn_started_at()
returns trigger
language plpgsql
security definer
as $$
declare
  v_old_active  uuid;
  v_elapsed_ms  bigint;
  v_current_ms  bigint;
begin
  if NEW.state is distinct from OLD.state then
    -- Only credit thinking time for turns taken while the game was actually
    -- in progress. Lobby/setup state changes (OLD.status <> 'playing') and the
    -- waiting -> playing kickoff never accrue, so lobby time is excluded.
    if OLD.status = 'playing' then
      v_old_active := public.compute_active_player(NEW.game_type, OLD.state);

      if v_old_active is not null and OLD.turn_started_at is not null then
        v_elapsed_ms := (extract(epoch from (now() - OLD.turn_started_at)) * 1000)::bigint;
        v_current_ms := coalesce(
          (coalesce(OLD.time_per_player, '{}'::jsonb)->>v_old_active::text)::bigint,
          0
        );
        NEW.time_per_player := jsonb_set(
          coalesce(OLD.time_per_player, '{}'::jsonb),
          ARRAY[v_old_active::text],
          to_jsonb(v_current_ms + v_elapsed_ms)
        );
      end if;
    end if;

    -- Always (re)start the turn clock on a state change. At the waiting ->
    -- playing kickoff this stamps game-start, so the first real turn is timed
    -- from when the game begins, not from room creation.
    NEW.turn_started_at := now();
  end if;
  return NEW;
end;
$$;

-- The trigger from 008/009 already points at set_turn_started_at(); replacing
-- the function above is enough. Re-bind defensively.
drop trigger if exists rooms_set_turn_started_at on public.rooms;
create trigger rooms_set_turn_started_at
  before update on public.rooms
  for each row
  execute function public.set_turn_started_at();
