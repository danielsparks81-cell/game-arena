-- =====================================================================
-- Game Arena schema
-- Paste this whole file into Supabase SQL Editor and click Run.
-- =====================================================================

-- ---------- profiles ----------
-- A profile row is auto-created for every signup via a trigger below.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  created_at  timestamptz not null default now()
);

-- Auto-insert a profile whenever a new auth user is created.
-- Username defaults to the part of the email before the @, with a numeric suffix on collision.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name text;
  candidate text;
  suffix    int := 0;
begin
  base_name := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_]', '', 'g'));
  if base_name is null or length(base_name) = 0 then
    base_name := 'player';
  end if;
  candidate := base_name;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := base_name || suffix::text;
  end loop;
  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- rooms ----------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  game_type   text not null,                        -- e.g. 'tictactoe'
  host_id     uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'waiting',      -- waiting | playing | finished
  state       jsonb not null default '{}'::jsonb,   -- game-specific state (board, turn, winner, etc.)
  max_players int  not null default 2,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists rooms_status_idx on public.rooms (status, created_at desc);

create or replace function public.touch_rooms_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists rooms_touch_updated_at on public.rooms;
create trigger rooms_touch_updated_at
  before update on public.rooms
  for each row execute function public.touch_rooms_updated_at();

-- ---------- room_players ----------
create table if not exists public.room_players (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  player_id  uuid not null references public.profiles(id) on delete cascade,
  seat       int  not null,
  joined_at  timestamptz not null default now(),
  primary key (room_id, player_id),
  unique (room_id, seat)
);

create index if not exists room_players_room_idx on public.room_players (room_id);

-- ---------- chat ----------
create table if not exists public.chat_messages (
  id          bigserial primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_room_idx on public.chat_messages (room_id, created_at);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles       enable row level security;
alter table public.rooms          enable row level security;
alter table public.room_players   enable row level security;
alter table public.chat_messages  enable row level security;

-- profiles: anyone signed in can read; users can only update their own.
drop policy if exists "profiles_select_all"      on public.profiles;
drop policy if exists "profiles_update_self"     on public.profiles;
create policy "profiles_select_all"   on public.profiles for select to authenticated using (true);
create policy "profiles_update_self"  on public.profiles for update to authenticated using (auth.uid() = id);

-- rooms: signed-in users can see & create; host (or any seated player) can update.
drop policy if exists "rooms_select_all"   on public.rooms;
drop policy if exists "rooms_insert_self"  on public.rooms;
drop policy if exists "rooms_update_seated" on public.rooms;
create policy "rooms_select_all"   on public.rooms for select to authenticated using (true);
create policy "rooms_insert_self"  on public.rooms for insert to authenticated with check (auth.uid() = host_id);
create policy "rooms_update_seated" on public.rooms for update to authenticated using (
  exists (select 1 from public.room_players rp where rp.room_id = rooms.id and rp.player_id = auth.uid())
);

-- room_players: signed-in users can see; users can only insert/delete themselves.
drop policy if exists "rp_select_all"   on public.room_players;
drop policy if exists "rp_insert_self"  on public.room_players;
drop policy if exists "rp_delete_self"  on public.room_players;
create policy "rp_select_all"   on public.room_players for select to authenticated using (true);
create policy "rp_insert_self"  on public.room_players for insert to authenticated with check (auth.uid() = player_id);
create policy "rp_delete_self"  on public.room_players for delete to authenticated using (auth.uid() = player_id);

-- chat: seated players in the room can read & post.
drop policy if exists "chat_select_seated" on public.chat_messages;
drop policy if exists "chat_insert_seated" on public.chat_messages;
create policy "chat_select_seated" on public.chat_messages for select to authenticated using (
  exists (select 1 from public.room_players rp where rp.room_id = chat_messages.room_id and rp.player_id = auth.uid())
);
create policy "chat_insert_seated" on public.chat_messages for insert to authenticated with check (
  auth.uid() = sender_id and
  exists (select 1 from public.room_players rp where rp.room_id = chat_messages.room_id and rp.player_id = auth.uid())
);

-- =====================================================================
-- Realtime
-- =====================================================================
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.chat_messages;
