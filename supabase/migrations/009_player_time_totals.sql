-- =====================================================================
-- Migration: per-player accumulated thinking time
-- Tracks total milliseconds each seated player has spent on their turns
-- in the current game, keyed by user UUID. Rendered in the MembersPanel
-- as a small "Xm Ys" badge beside every player (always visible, not just
-- the one with the live countdown).
--
-- Auto-maintained server-side by extending the turn-timer trigger from
-- migration 008. On every state change we derive the OLD active player
-- (using a SQL helper that mirrors src/lib/games/turnOrder.ts) and add
-- the elapsed wall-clock time since OLD.turn_started_at to their bucket.
-- No changes to engine code or server actions required.
-- Safe to re-run.
-- =====================================================================

alter table public.rooms
  add column if not exists time_per_player jsonb not null default '{}';

-- ----- Helper: compute active player UUID from (game_type, state) -----
-- Mirrors getTurnInfo() in src/lib/games/turnOrder.ts. Returns null when
-- the game has no single active player (Boggle simultaneous play, between
-- turns, game over, or unknown state shape).
create or replace function public.compute_active_player(p_game_type text, p_state jsonb)
returns uuid
language plpgsql
immutable
as $$
declare
  v_active_text text;
  v_turn_key    text;
  v_step        text;
  v_active_seat int;
begin
  if p_state is null then return null; end if;

  if p_game_type in ('tictactoe', 'connect4', 'checkers', 'battleship') then
    v_turn_key := p_state->>'turn';
    if v_turn_key is null then return null; end if;
    v_active_text := p_state->'seats'->>v_turn_key;

  elsif p_game_type in ('liarsdice', 'yahtzee') then
    if p_state->>'turnIndex' is null then return null; end if;
    v_active_text := p_state->'players'->(p_state->>'turnIndex')::int->>'playerId';

  elsif p_game_type = 'longshot' then
    v_step := p_state->>'step';
    if v_step = 'action' then
      v_active_seat := nullif(p_state->>'currentTurnSeat', 'null')::int;
    else
      v_active_seat := nullif(p_state->>'activePlayerSeat', 'null')::int;
    end if;
    if v_active_seat is null then return null; end if;
    select (p->>'playerId')::text into v_active_text
      from jsonb_array_elements(p_state->'players') p
     where (p->>'seat')::int = v_active_seat
     limit 1;
  end if;

  if v_active_text is null then return null; end if;
  begin
    return v_active_text::uuid;
  exception when others then
    return null;
  end;
end;
$$;

-- ----- Replace the trigger from migration 008 -----
-- Behavior:
--   1. On state change, derive who WAS active (from OLD.state).
--   2. Add (now - OLD.turn_started_at) milliseconds to their bucket in
--      NEW.time_per_player.
--   3. Reset turn_started_at = now() so the new turn's countdown starts
--      fresh (same as migration 008 did).
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

    NEW.turn_started_at := now();
  end if;
  return NEW;
end;
$$;

-- Trigger created in migration 008 already points at set_turn_started_at;
-- the CREATE OR REPLACE FUNCTION above is enough. Re-bind defensively in
-- case anyone ran a partial state of these migrations.
drop trigger if exists rooms_set_turn_started_at on public.rooms;
create trigger rooms_set_turn_started_at
  before update on public.rooms
  for each row
  execute function public.set_turn_started_at();
