-- =====================================================================
-- Migration: game history + rematch votes
-- Safe to re-run.
-- =====================================================================

-- Rematch votes on rooms (set of player IDs who want to rematch)
alter table public.rooms
  add column if not exists rematch_votes uuid[] not null default '{}';

-- Game history: one row per finished game
create table if not exists public.game_history (
  id          bigserial primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  game_type   text not null,
  winner_id   uuid references public.profiles(id) on delete set null, -- null = draw
  player_ids  uuid[] not null,
  finished_at timestamptz not null default now()
);

create index if not exists game_history_player_idx  on public.game_history using gin (player_ids);
create index if not exists game_history_winner_idx  on public.game_history (winner_id);
create index if not exists game_history_finished_idx on public.game_history (finished_at desc);

-- RLS
alter table public.game_history enable row level security;

drop policy if exists "gh_select_all"  on public.game_history;
drop policy if exists "gh_insert_self" on public.game_history;

-- Anyone signed in can read history (we'll filter client-side per profile).
create policy "gh_select_all"  on public.game_history
  for select to authenticated using (true);

-- A player can only insert a row that includes themselves.
create policy "gh_insert_self" on public.game_history
  for insert to authenticated
  with check (auth.uid() = any(player_ids));

-- Add to realtime publication so we can react to new history rows live.
do $$
begin
  begin
    alter publication supabase_realtime add table public.game_history;
  exception when duplicate_object then null;
  end;
end $$;
