-- =====================================================================
-- Migration: general lobby chat
-- A site-wide chat visible to every signed-in user (rendered below the
-- members panel on the lobby page). Safe to re-run.
-- =====================================================================

create table if not exists public.general_chat_messages (
  id          bigserial primary key,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index if not exists general_chat_messages_created_idx
  on public.general_chat_messages (created_at desc);

-- ---------- RLS ----------
alter table public.general_chat_messages enable row level security;

drop policy if exists "gc_select_all"  on public.general_chat_messages;
drop policy if exists "gc_insert_self" on public.general_chat_messages;

-- Any signed-in user can read general chat.
create policy "gc_select_all" on public.general_chat_messages
  for select to authenticated using (true);

-- A user can only insert their own messages.
create policy "gc_insert_self" on public.general_chat_messages
  for insert to authenticated
  with check (auth.uid() = sender_id);

-- ---------- Realtime ----------
do $$
begin
  begin
    alter publication supabase_realtime add table public.general_chat_messages;
  exception when duplicate_object then null;
  end;
end $$;
