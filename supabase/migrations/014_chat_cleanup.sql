-- 014_chat_cleanup.sql
--
-- Auto-deletes Global Chat messages older than 48 hours.
-- Two parts:
--   1. A reusable cleanup function you can also call manually.
--   2. A pg_cron job that runs it every hour (pg_cron ships with Supabase
--      on all plans; enable it once via the Extensions page in the dashboard
--      if the schedule step fails with "extension not found").

-- 1. Cleanup function
create or replace function public.cleanup_old_chat_messages()
returns void
language sql
security definer
as $$
  delete from public.general_chat_messages
  where created_at < now() - interval '48 hours';
$$;

-- 2. Hourly pg_cron schedule (runs at the top of every hour)
--    If pg_cron is not yet enabled, enable it first:
--    Dashboard → Database → Extensions → search "pg_cron" → Enable
select cron.schedule(
  'cleanup-global-chat',          -- job name (unique)
  '0 * * * *',                    -- every hour at :00
  $$ select public.cleanup_old_chat_messages(); $$
);
