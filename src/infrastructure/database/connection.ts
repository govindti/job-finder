import {
  Pool,
  type PoolClient,
  type PoolConfig,
} from "pg";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/app-error.js";

// PostgreSQL access layer. One `pg.Pool` is shared by the whole process and
// configured from a single DATABASE_URL, so Neon, Supabase and a local server
// all work without code changes:
//
//   postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/db?sslmode=require
//   postgresql://postgres.abcdefgh:pass@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
//
// Timestamps stay TEXT (ISO-8601, no `Z`) on purpose — the API payloads and the
// lexicographic ORDER BY comparisons depend on that exact shape.

/** Anything that can run a query: the pool itself or a checked-out client. */
export type Executor = Pool | PoolClient;

/** Narrow view used internally so the Pool/PoolClient overloads stay callable. */
interface SqlRunner {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

let pool: Pool | null = null;

function isLocalUrl(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(url);
}

/**
 * TLS decision: explicit PG_SSL wins; otherwise hosted providers (Neon,
 * Supabase, anything not on localhost) get TLS with a relaxed CA chain, which
 * is what their pooled endpoints present.
 */
function sslConfig(url: string): PoolConfig["ssl"] {
  if (env.PG_SSL === false) return undefined;
  if (env.PG_SSL === true) return { rejectUnauthorized: false };
  if (url.includes("sslmode=disable")) return undefined;
  if (isLocalUrl(url)) return undefined;
  return { rejectUnauthorized: false };
}

/** Open (once) and return the shared pool. */
export function getPool(): Pool {
  if (!pool) {
    const url = env.DATABASE_URL;
    if (!url) {
      throw new AppError("DATABASE_NOT_CONFIGURED");
    }
    pool = new Pool({
      connectionString: url,
      max: env.PG_POOL_MAX,
      connectionTimeoutMillis: env.PG_CONNECT_TIMEOUT_MS,
      ssl: sslConfig(url),
    });
    // An idle client erroring out (network blip, provider restart) must not take
    // the process down — the pool re-creates clients on demand.
    pool.on("error", () => {
      /* handled by the caller's retry / surfaced on next query */
    });
  }
  return pool;
}

/** Minimal result shape the repo layer consumes. */
export interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}

/**
 * Run a query against the shared pool (or an explicit client/transaction).
 *
 * The row type is deliberately unconstrained: `pg.QueryResultRow` is an
 * interface with an index signature, and the row interfaces in `repo.ts`
 * (plain interfaces) would not satisfy that constraint.
 */
export function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  exec: Executor = getPool(),
): Promise<Rows<T>> {
  const runner = exec as unknown as SqlRunner;
  return runner.query(text, params) as Promise<Rows<T>>;
}

/** Run a query and return the first row, or `undefined`. */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  exec: Executor = getPool(),
): Promise<T | undefined> {
  const res = await query<T>(text, params, exec);
  return res.rows[0];
}

/** Push a bind value and get its `$n` placeholder back. */
export function param(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

/**
 * Run `fn` inside BEGIN/COMMIT on a single pooled client. Rolls back when `fn`
 * throws and always releases the client.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the connection is already broken; the original error wins */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Drain the pool (called on SIGINT/SIGTERM and by scripts). */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  schemaReady = false;
  await p.end();
}

let schemaReady = false;

/**
 * Create tables, indexes and the legacy default search_queries rows. The
 * profile first-run seed is intentionally kept out of here (see
 * profile.ensureFirstRunSeed) to avoid a module cycle; the server calls both
 * in order.
 */
export async function initSchema(): Promise<void> {
  if (schemaReady) return;
  const p = getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT DEFAULT 'Remote',
      description TEXT DEFAULT '',
      url TEXT DEFAULT '',
      source TEXT DEFAULT '',
      posted_date TEXT,
      discovered_at TEXT NOT NULL,
      tech_stack TEXT DEFAULT '',
      experience_level TEXT DEFAULT '',
      relevance_score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'new',
      company_domain TEXT DEFAULT '',
      salary TEXT DEFAULT '',
      job_type TEXT DEFAULT '',
      india_friendly TEXT DEFAULT 'unknown',
      location_note TEXT DEFAULT '',
      last_seen TEXT DEFAULT '',
      mark_for_email INTEGER DEFAULT 0,
      scored_profile_id INTEGER DEFAULT NULL
    )
  `);

  // Migration guards for databases created by an earlier schema version.
  await p.query(`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS india_friendly TEXT DEFAULT 'unknown';
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location_note TEXT DEFAULT '';
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_seen TEXT DEFAULT '';
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mark_for_email INTEGER DEFAULT 0;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scored_profile_id INTEGER DEFAULT NULL;
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT DEFAULT '',
      careers_url TEXT DEFAULT '',
      ats_platform TEXT DEFAULT 'unknown',
      ats_slug TEXT DEFAULT '',
      founded_year INTEGER DEFAULT 0,
      employee_count TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      india_friendly TEXT DEFAULT 'unknown',
      last_crawled TEXT DEFAULT '',
      crawl_status TEXT DEFAULT 'active',
      notes TEXT DEFAULT ''
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS outreach (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      job_title TEXT,
      company TEXT,
      company_domain TEXT,
      contact_name TEXT,
      contact_position TEXT,
      contact_linkedin TEXT,
      dm_short TEXT,
      dm_long TEXT,
      status TEXT DEFAULT 'pending',
      messaged_at TEXT DEFAULT '',
      replied_at TEXT DEFAULT '',
      followed_up_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      notes TEXT DEFAULT '',
      emailed_at TEXT DEFAULT '',
      profile_id INTEGER DEFAULT NULL
    )
  `);
  await p.query(`
    ALTER TABLE outreach ADD COLUMN IF NOT EXISTS emailed_at TEXT DEFAULT '';
    ALTER TABLE outreach ADD COLUMN IF NOT EXISTS profile_id INTEGER DEFAULT NULL;
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS email_log (
      id SERIAL PRIMARY KEY,
      sent_at TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT,
      items_count INTEGER DEFAULT 0,
      outreach_ids TEXT,
      status TEXT DEFAULT 'sent',
      error TEXT DEFAULT ''
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id SERIAL PRIMARY KEY,
      api_name TEXT NOT NULL,
      called_at TEXT NOT NULL,
      success INTEGER DEFAULT 1,
      notes TEXT DEFAULT ''
    )
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_api_usage_name ON api_usage(api_name, called_at)`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS search_queries (
      id SERIAL PRIMARY KEY,
      query TEXT NOT NULL,
      country TEXT DEFAULT 'IN',
      date_posted TEXT DEFAULT '3days',
      remote_jobs_only INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  // Seed default queries only when the table is empty (legacy table; the live
  // JSearch queries now live on the active profile).
  await p.query(
    `INSERT INTO search_queries (query, country, date_posted, remote_jobs_only, enabled, created_at)
     SELECT d.query, d.country, d.date_posted, d.remote_jobs_only, 1, $1
       FROM (VALUES
         ('python django backend developer', 'IN', '3days', 0),
         ('python backend engineer', 'IN', '3days', 0),
         ('django developer', 'IN', '3days', 0),
         ('fastapi developer', 'IN', 'week', 0),
         ('python backend remote', 'IN', 'week', 1),
         ('backend engineer python', 'US', 'week', 1)
       ) AS d(query, country, date_posted, remote_jobs_only)
      WHERE NOT EXISTS (SELECT 1 FROM search_queries)`,
    [nowIso()],
  );

  await p.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT DEFAULT 'custom'
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Indexes.
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_relevance ON jobs(relevance_score DESC);
    CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(status);
    CREATE INDEX IF NOT EXISTS idx_outreach_job ON outreach(job_id);
    CREATE INDEX IF NOT EXISTS idx_outreach_created ON outreach(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source ON jobs(source);
    CREATE INDEX IF NOT EXISTS idx_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_discovered ON jobs(discovered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_india ON jobs(india_friendly);
    CREATE INDEX IF NOT EXISTS idx_company_domain ON jobs(company_domain);
    CREATE INDEX IF NOT EXISTS idx_company_ats ON companies(ats_platform);
    CREATE INDEX IF NOT EXISTS idx_company_status ON companies(crawl_status);
    CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
  `);

  schemaReady = true;
}

export function isSchemaReady(): boolean {
  return schemaReady;
}

function nowIso(): string {
  return new Date().toISOString().replace("Z", "");
}
