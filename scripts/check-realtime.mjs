import { Client } from 'pg';

const PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!PASSWORD) { console.error('Set SUPABASE_DB_PASSWORD'); process.exit(1); }

const client = new Client({
  host: 'db.gzklizonquevkdxcmpsl.supabase.co',
  port: 5432, user: 'postgres', password: PASSWORD,
  database: 'postgres', ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});
await client.connect();

console.log('=== Tables in supabase_realtime publication ===');
const pub = await client.query(`
  select schemaname, tablename
  from pg_publication_tables
  where pubname = 'supabase_realtime'
  order by tablename;
`);
for (const r of pub.rows) console.log(`  - ${r.schemaname}.${r.tablename}`);

console.log('');
console.log('=== Replica identity for our tables ===');
const repl = await client.query(`
  select c.relname, c.relreplident,
    case c.relreplident
      when 'd' then 'default (primary key)'
      when 'n' then 'nothing'
      when 'f' then 'full'
      when 'i' then 'index'
    end as description
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('rooms','room_players','chat_messages','game_history','profiles')
  order by c.relname;
`);
for (const r of repl.rows) console.log(`  - ${r.relname}: ${r.relreplident} (${r.description})`);

await client.end();
