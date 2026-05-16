// Backfill profile rows for any auth.users that don't have one.
// Safe to re-run.
import { Client } from 'pg';

const PROJECT_REF = 'gzklizonquevkdxcmpsl';
const PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!PASSWORD) { console.error('Set SUPABASE_DB_PASSWORD'); process.exit(1); }

const client = new Client({
  host: `db.${PROJECT_REF}.supabase.co`,
  port: 5432, user: 'postgres', password: PASSWORD,
  database: 'postgres', ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});

await client.connect();
try {
  const result = await client.query(`
    with missing as (
      select u.id, u.email
      from auth.users u
      left join public.profiles p on p.id = u.id
      where p.id is null
    ),
    inserted as (
      insert into public.profiles (id, username)
      select
        m.id,
        -- base name from email + short id suffix to guarantee uniqueness
        coalesce(
          nullif(lower(regexp_replace(split_part(m.email, '@', 1), '[^a-z0-9_]', '', 'g')), ''),
          'player'
        ) || '_' || substr(m.id::text, 1, 6)
      from missing m
      returning id, username
    )
    select id, username from inserted;
  `);
  console.log(`Backfilled ${result.rowCount} profile(s):`);
  for (const r of result.rows) console.log('  -', r.username, r.id);
} finally {
  await client.end();
}
