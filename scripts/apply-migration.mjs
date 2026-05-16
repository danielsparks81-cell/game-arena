// Apply any *.sql file from supabase/migrations/ by name.
// Usage: node scripts/apply-migration.mjs 002_history_and_rematch.sql
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fileArg = process.argv[2];
if (!fileArg) { console.error('Usage: node apply-migration.mjs <filename.sql>'); process.exit(1); }
const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', fileArg), 'utf8');

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
  console.log(`Applying ${fileArg}...`);
  await client.query(sql);
  console.log('✅ Migration applied.');
} catch (e) {
  console.error('Error:', e.message);
  process.exit(2);
} finally {
  await client.end();
}
