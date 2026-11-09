import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo layout: env.ts lives in job-finder/src/config/, so:
//   - project root for job-finder is three levels up (src/config -> src -> job-finder)
//   - DB sits at job-finder/jobs.db at the project root
export const JOB_FINDER_ROOT = path.resolve(__dirname, "..", "..");

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

export const env = {
    DB_PATH: path.join(JOB_FINDER_ROOT, "jobs.db"),
    PROFILES_DIR: path.join(JOB_FINDER_ROOT, "profiles"),
    PUBLIC_DIR: path.join(JOB_FINDER_ROOT, "public"),

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
