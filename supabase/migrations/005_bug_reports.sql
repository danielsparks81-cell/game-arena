-- =====================================================================
-- Migration: bug reports captured from in-room "report error" button.
-- Each row records the reporter, the room/game context, and the description.
-- Safe to re-run.
-- =====================================================================

create table if not exists public.bug_reports (
  id                bigserial primary key,
  reporter_id       uuid references public.profiles(id) on delete set null,
  reporter_username text,
  room_id           uuid references public.rooms(id) on delete set null,
  game_type         text,
  description       text not null check (length(description) between 1 and 2000),
  user_agent        text,
  url               text,
  created_at        timestamptz not null default now()
);

create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);

-- ---------- RLS ----------
alter table public.bug_reports enable row level security;

drop policy if exists "br_insert_self" on public.bug_reports;

-- Any signed-in user can submit a report, but only with themselves as reporter_id.
create policy "br_insert_self" on public.bug_reports
  for insert to authenticated
  with check (auth.uid() = reporter_id);

-- (No select policy — reports are inspected via the dashboard / service role only.)
