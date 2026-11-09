import Database from "better-sqlite3";
import { env } from "../config/env.js";

let db: Database.Database | null = null;

/** Open (once) and return the shared connection. */
export function getDb(): Database.Database {
  if (!db) {
    db = new Database(env.DB_PATH);
    db.pragma("journal_mode = WAL");
  }
  return db;
}

let schemaReady = false;

/**
 * Create tables, indexes and the legacy default search_queries rows. The
 * profile first-run seed is intentionally kept out of here (see
 * profile.ensureFirstRunSeed) to avoid a module cycle; the server calls both
 * in order.
 */
export function initSchema(): void {
  const d = getDb();

  d.exec(`
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
      location_note TEXT DEFAULT ''
    )
  `);

  // Migration guards for pre-existing DBs (added columns are skipped if present).
  addColumnIfMissing(d, "jobs", "india_friendly", "TEXT DEFAULT 'unknown'");
  addColumnIfMissing(d, "jobs", "location_note", "TEXT DEFAULT ''");
  addColumnIfMissing(d, "jobs", "last_seen", "TEXT DEFAULT ''");
  addColumnIfMissing(d, "jobs", "mark_for_email", "INTEGER DEFAULT 0");
  addColumnIfMissing(d, "jobs", "scored_profile_id", "INTEGER DEFAULT NULL");

  d.exec(`
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

  d.exec(`
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
      emailed_at TEXT DEFAULT ''
    )
  `);
  addColumnIfMissing(d, "outreach", "emailed_at", "TEXT DEFAULT ''");
  addColumnIfMissing(d, "outreach", "profile_id", "INTEGER DEFAULT NULL");

  d.exec(`
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT,
      items_count INTEGER DEFAULT 0,
      outreach_ids TEXT,
      status TEXT DEFAULT 'sent',
      error TEXT DEFAULT ''
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_name TEXT NOT NULL,
      called_at TEXT NOT NULL,
      success INTEGER DEFAULT 1,
      notes TEXT DEFAULT ''
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_api_usage_name ON api_usage(api_name, called_at)`);

  d.exec(`
    CREATE TABLE IF NOT EXISTS search_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  const count = d.prepare("SELECT COUNT(*) AS c FROM search_queries").get() as { c: number };
  if (count.c === 0) {
    const ts = nowIso();
    const defaults: Array<[string, string, string, number]> = [
      ["python django backend developer", "IN", "3days", 0],
      ["python backend engineer", "IN", "3days", 0],
      ["django developer", "IN", "3days", 0],
      ["fastapi developer", "IN", "week", 0],
      ["python backend remote", "IN", "week", 1],
      ["backend engineer python", "US", "week", 1],
    ];
    const ins = d.prepare(
      "INSERT INTO search_queries (query, country, date_posted, remote_jobs_only, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
    );
    for (const q of defaults) ins.run(q[0], q[1], q[2], q[3], ts);
  }

  d.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT DEFAULT 'custom'
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Indexes.
  d.exec(`
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

function addColumnIfMissing(
  d: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function nowIso(): string {
  return new Date().toISOString().replace("Z", "");
}
