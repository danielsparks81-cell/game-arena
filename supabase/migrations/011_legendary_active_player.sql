-- =====================================================================
-- Migration: extend compute_active_player() to handle Legendary
--
-- Bug: the per-player cumulative-time badge in MembersPanel stayed at 0m
-- for Legendary games no matter how long the players took. Root cause:
-- compute_active_player() (defined in 009) had branches for every game
-- type EXCEPT 'legendary', so it returned null on every Legendary state
-- update. The turn-timer trigger then skipped the time-accumulation step
-- (line "if v_old_active is not null and OLD.turn_started_at is not null")
-- and just bumped turn_started_at without crediting any time.
--
-- LegendaryState shape:
--   state.players: PlayerState[] (PlayerState.playerId is the user UUID)
--   state.currentPlayerIdx: int
--
-- Safe to re-run.
-- =====================================================================

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

  elsif p_game_type = 'legendary' then
    -- Active player = state.players[state.currentPlayerIdx].playerId.
    if p_state->>'currentPlayerIdx' is null then return null; end if;
    v_active_text := p_state->'players'->(p_state->>'currentPlayerIdx')::int->>'playerId';
  end if;

  if v_active_text is null then return null; end if;
  begin
    return v_active_text::uuid;
  exception when others then
    return null;
  end;
end;
$$;
