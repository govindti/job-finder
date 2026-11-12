import fs from "node:fs";
import { Database } from "bun:sqlite";
import { closePool, initSchema, query, withTransaction } from "../src/infrastructure/database/connection.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";

// One-off importer: legacy SQLite `jobs.db` -> PostgreSQL (Neon / Supabase / local).
//
//   bun run db:import
//   LEGACY_DB_PATH=/path/to/jobs.db DATABASE_URL=postgresql://... bun run db:import
//
// Idempotent: rows that already exist (same primary key) are skipped, so it is
// safe to re-run. SERIAL sequences are re-synced afterwards so the next INSERT
// from the app does not collide with an imported id.

interface TableSpec {
    name: string;
    columns: string[];
    /** Tables with a SERIAL primary key need their sequence re-synced. */
    serial?: boolean;
}

const TABLES: TableSpec[] = [
    {
        name: "jobs",
        columns: [
            "id",
            "title",
            "company",
            "location",
            "description",
            "url",
            "source",
            "posted_date",
            "discovered_at",
            "tech_stack",
            "experience_level",
            "relevance_score",
            "status",
            "company_domain",
            "salary",
            "job_type",
            "india_friendly",
            "location_note",
            "last_seen",
            "mark_for_email",
            "scored_profile_id",
        ],
    },
    {
        name: "companies",
        columns: [
            "id",
            "name",
            "domain",
            "careers_url",
            "ats_platform",
            "ats_slug",
            "founded_year",
            "employee_count",
            "tags",
            "india_friendly",
            "last_crawled",
            "crawl_status",
            "notes",
        ],
    },
    {
        name: "outreach",
        columns: [
            "id",
            "job_id",
            "job_title",
            "company",
            "company_domain",
            "contact_name",
            "contact_position",
            "contact_linkedin",
            "dm_short",
            "dm_long",
            "status",
            "messaged_at",
            "replied_at",
            "followed_up_at",
            "created_at",
            "notes",
            "emailed_at",
            "profile_id",
        ],
    },
    {
        name: "email_log",
        columns: [
            "id",
            "sent_at",
            "recipient",
            "subject",
            "items_count",
            "outreach_ids",
            "status",
            "error",
        ],
        serial: true,
    },
    {
        name: "api_usage",
        columns: ["id", "api_name", "called_at", "success", "notes"],
        serial: true,
    },
    {
        name: "search_queries",
        columns: ["id", "query", "country", "date_posted", "remote_jobs_only", "enabled", "created_at"],
        serial: true,
    },
    {
        name: "profiles",
        columns: ["id", "name", "description", "config_json", "created_at", "updated_at", "source"],
        serial: true,
    },
    {
        name: "app_settings",
        columns: ["key", "value", "updated_at"],
    },
];

function sqliteHasTable(db: Database, table: string): boolean {
    return Boolean(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
    );
}

function sqliteColumns(db: Database, table: string): Set<string> {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
}

async function copyTable(
    src: Database,
    spec: TableSpec,
): Promise<{ inserted: number; skipped: number; missing: string[] }> {
    if (!sqliteHasTable(src, spec.name)) return { inserted: 0, skipped: 0, missing: [] };

    // Older SQLite files may lack columns added by later migrations — copy only
    // the intersection so the import still works.
    const available = sqliteColumns(src, spec.name);
    const columns = spec.columns.filter((c) => available.has(c));
    const missing = spec.columns.filter((c) => !available.has(c));

    const rows = src
        .prepare(`SELECT ${columns.join(", ")} FROM ${spec.name}`)
        .all() as Array<Record<string, unknown>>;
    if (!rows.length) return { inserted: 0, skipped: 0, missing };

    const placeholders = columns.map((_c, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${spec.name} (${columns.join(", ")}) VALUES (${placeholders})
                 ON CONFLICT DO NOTHING`;

    let inserted = 0;
    await withTransaction(async (client) => {
        for (const row of rows) {
            const values = columns.map((c) => row[c] ?? null);
            const res = await query(sql, values, client);
            inserted += res.rowCount ?? 0;
        }
    });
    return { inserted, skipped: rows.length - inserted, missing };
}

async function syncSequence(table: string): Promise<void> {
    await query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'),
                       GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1))`,
        [table],
    );
}

async function main(): Promise<void> {
    const sqlitePath = env.LEGACY_DB_PATH;
    if (!fs.existsSync(sqlitePath)) {
        logger.error(`SQLite file not found: ${sqlitePath}`);
        process.exit(1);
    }
    if (!env.DATABASE_URL) {
        logger.error("DATABASE_URL is not set — nothing to import into");
        process.exit(1);
    }

    logger.info(`Importing ${sqlitePath} -> PostgreSQL`);
    await initSchema();

    const src = new Database(sqlitePath, { readonly: true });
    try {
        for (const spec of TABLES) {
            const { inserted, skipped, missing } = await copyTable(src, spec);
            const note = missing.length ? ` (missing columns: ${missing.join(", ")})` : "";
            logger.info(
                `  ${spec.name}: ${inserted} inserted, ${skipped} skipped${note}`,
            );
            if (spec.serial) await syncSequence(spec.name);
        }
    } finally {
        src.close();
        await closePool();
    }
    logger.info("Import complete");
}

main().catch(async (err: unknown) => {
    logger.error(`Import failed: ${String(err)}`);
    await closePool().catch(() => undefined);
    process.exit(1);
});
