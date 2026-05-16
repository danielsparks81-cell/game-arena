// One-off: connect to Supabase Postgres and apply supabase/schema.sql.
// Tries direct connection first; falls back to known pooler regions if direct fails.
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

const PROJECT_REF = 'gzklizonquevkdxcmpsl';
const PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!PASSWORD) {
  console.error('Set SUPABASE_DB_PASSWORD env var first.');
  process.exit(1);
}

const candidates = [
  // Direct connection (works if your network has IPv6)
  { label: 'direct', host: `db.${PROJECT_REF}.supabase.co`, port: 5432, user: 'postgres' },
  // Pooler endpoints (IPv4) — try common regions
  { label: 'pooler us-east-1', host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler us-east-2', host: 'aws-0-us-east-2.pooler.supabase.com', port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler us-west-1', host: 'aws-0-us-west-1.pooler.supabase.com', port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler eu-west-1', host: 'aws-0-eu-west-1.pooler.supabase.com', port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler eu-central-1', host: 'aws-0-eu-central-1.pooler.supabase.com', port: 5432, user: `postgres.${PROJECT_REF}` },
  { label: 'pooler ap-southeast-1', host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432, user: `postgres.${PROJECT_REF}` },
];

async function tryConnect(cfg) {
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

let client = null;
let usedLabel = '';
for (const cfg of candidates) {
  process.stdout.write(`Trying ${cfg.label} (${cfg.host})... `);
  try {
    client = await tryConnect(cfg);
    usedLabel = cfg.label;
    console.log('CONNECTED');
    break;
  } catch (e) {
    console.log('FAIL — ' + (e.code || e.message));
  }
}

if (!client) {
  console.error('\nCould not connect to your Supabase Postgres via any known endpoint.');
  process.exit(2);
}

try {
  console.log(`\nApplying schema via ${usedLabel}...`);
  await client.query(sql);
  console.log('✅ Schema applied successfully.');

  const { rows } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public'
    order by table_name;
  `);
  console.log('\nTables in public schema:');
  for (const r of rows) console.log('  -', r.table_name);
} catch (e) {
  console.error('Error executing schema:', e.message);
  process.exit(3);
} finally {
  await client.end();
}
