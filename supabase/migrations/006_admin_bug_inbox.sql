-- =====================================================================
-- Migration: admin role + select policy so the admin can see bug_reports
-- in-app. Without this, RLS blocks reads (the table was insert-only) and
-- the realtime subscription delivers nothing.
-- Safe to re-run.
-- =====================================================================

-- ---------- Admin flag on profiles ----------
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ---------- Allow admins to SELECT all bug reports ----------
drop policy if exists "br_select_admin" on public.bug_reports;
create policy "br_select_admin" on public.bug_reports
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- ---------- Allow admins to UPDATE bug reports (for marking read) ----------
alter table public.bug_reports
  add column if not exists read_at timestamptz;

drop policy if exists "br_update_admin" on public.bug_reports;
create policy "br_update_admin" on public.bug_reports
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- ---------- Add to realtime (idempotent — already added in 004 for general_chat) ----------
do $$
begin
  begin
    alter publication supabase_realtime add table public.bug_reports;
  exception when duplicate_object then null;
  end;
end $$;
