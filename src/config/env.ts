import path from "node:path";

// Bun loads .env (and .env.local / .env.[NODE_ENV]) automatically, so there is
// no dotenv bootstrap here — only path resolution.

// Repo layout: env.ts lives in job-finder/src/config/, so:
//   - project root for job-finder is three levels up (src/config -> src -> job-finder)
//   - the legacy SQLite file sits at job-finder/jobs.db (import source only)
export const JOB_FINDER_ROOT = path.resolve(import.meta.dir, "..", "..");

function envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isNaN(n) ? fallback : n;
}

function envStr(name: string, fallback = ""): string {
    const raw = process.env[name];
    return raw === undefined ? fallback : raw;
}

function envBool(name: string): boolean | null {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return null;
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export const env = {
    // PostgreSQL (Neon, Supabase, or any local server) — single connection string.
    DATABASE_URL: envStr("DATABASE_URL"),
    // null = auto-detect (TLS for hosted providers, plain for localhost).
    PG_SSL: envBool("PG_SSL"),
    PG_POOL_MAX: envInt("PG_POOL_MAX", 10),
    PG_CONNECT_TIMEOUT_MS: envInt("PG_CONNECT_TIMEOUT_MS", 10_000),

    // Legacy SQLite file — only read by scripts/import-sqlite.ts.
    LEGACY_DB_PATH: envStr("LEGACY_DB_PATH") || path.join(JOB_FINDER_ROOT, "jobs.db"),

    PROFILES_DIR: path.join(JOB_FINDER_ROOT, "profiles"),

    RAPIDAPI_KEY: envStr("RAPIDAPI_KEY"),
    HUNTER_API_KEY: envStr("HUNTER_API_KEY"),

    SENDER_EMAIL: envStr("SENDER_EMAIL"),
    SENDER_APP_PASSWORD: envStr("SENDER_APP_PASSWORD"),
    // Default recipient used when RECIPIENT_EMAIL is not set.
    RECIPIENT_EMAIL: envStr("RECIPIENT_EMAIL", "parmanandprajapati0009@gmail.com"),

    DAILY_EMAIL_HOUR: envInt("DAILY_EMAIL_HOUR", 9),
    DAILY_EMAIL_TIMEZONE: "Asia/Kolkata",
    DAILY_JOBS_COUNT: envInt("DAILY_JOBS_COUNT", 15),

    GOOGLE_SHEETS_CREDS: envStr("GOOGLE_SHEETS_CREDS", "credentials.json"),
    GOOGLE_SHEET_ID: envStr("GOOGLE_SHEET_ID"),

    HOST: envStr("HOST", "127.0.0.1"),
    PORT: envInt("PORT", 8000),
} as const;

// Credentials path may be relative; resolve it against the job-finder root so
// the existence check runs from the project root.
export function resolveCredsPath(): string {
    return path.isAbsolute(env.GOOGLE_SHEETS_CREDS)
        ? env.GOOGLE_SHEETS_CREDS
        : path.join(JOB_FINDER_ROOT, env.GOOGLE_SHEETS_CREDS);
}
