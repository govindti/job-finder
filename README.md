# Job Finder

A job-hunting platform I built in JavaScript/TypeScript: a multi-source job
scraper with a scoring engine, MD5 dedupe, stale-job cleanup, a LinkedIn
outreach generator, a daily email digest, Google Sheets export, and a web
dashboard. The backend runs on Bun with Express + PostgreSQL (`pg`) + node-cron
(no `Bun.serve` — the HTTP server is still Express on `node:http`), and the UI
is a Next.js app under `web/`, also launched through Bun.

## Stack

| Concern            | Choice                                        |
| ------------------ | --------------------------------------------- |
| Runtime            | Bun 1.2+ (package manager + runtime)          |
| Language           | TypeScript (strict, ESM `NodeNext`)            |
| HTTP framework     | Express 4 on `node:http` (not `Bun.serve`)     |
| Validation         | `zod` (every external API response is validated) |
| Database           | PostgreSQL via `pg` (Neon, Supabase, or local), raw SQL, no ORM |
| Scheduler          | `node-cron` (timezone `Asia/Kolkata`)          |
| Email              | `nodemailer` (Gmail SMTP_SSL :465)             |
| HTTP client        | native `fetch` + `AbortController` (timeout + retry/backoff) |
| HTML parsing       | `cheerio`                                      |
| Config / presets   | `yaml` + Bun's built-in `.env` loading         |
| Logging            | `pino`                                          |
| Google Sheets      | `googleapis` (Sheets v4)                       |
| Frontend           | Next.js (`web/`), launched with `bun --bun`    |

## Project layout

```
job-finder/
  src/
    config/       env.ts, logger.ts, settings.ts (legacy first-run defaults)
    db/           connection.ts (pg pool + schema), repo.ts (CRUD), profile.ts,
                  company_seed.ts, mega_companies.ts
    schemas/      profile.ts (config shape), external.ts (source payloads),
                  api.ts (request bodies)
    sources/      base.ts (JobSource) + 7 fetchers + ats-types + collector.ts
    scoring/      scorer.ts
    outreach/     hunter.ts (LinkedIn URLs + DM templates)
    email/        emailer.ts (digest + pipeline), sheets.ts (Sheets export)
    scheduler/    index.ts (node-cron daily digest)
    routes/       jobs, companies, outreach, email, export, profiles + index
    utils/        http, models, hash, round (shared helpers)
    server.ts     Express bootstrap
  scripts/        import-sqlite.ts (one-off SQLite → PostgreSQL copy)
  public/         static/ + templates/ (server-rendered dashboard)
  profiles/       *.yaml presets (backend_python, backend_go_node_remote, ...)
  web/            Next.js frontend (app router + shared components)
```

## Setup

```bash
cd job-finder
bun install               # writes bun.lock (no package-lock.json)
cp .env.example .env      # fill in DATABASE_URL and the rest (see below)
bun run dev               # bun --watch src/server.ts + next dev → http://127.0.0.1:8000
```

Point `DATABASE_URL` at any PostgreSQL server — the schema (tables, indexes, the
legacy default search queries) is created on first boot, and a legacy starter
profile is seeded + activated. No migration tool is needed: startup is
idempotent and includes `ADD COLUMN IF NOT EXISTS` guards for older databases.

Coming from the SQLite version? Copy the old data once with:

```bash
bun run db:import        # reads jobs.db, skips rows that already exist
```

### Environment

All variables live in `.env` (see `.env.example`):

- `DATABASE_URL` — **required**. Neon / Supabase / local connection string, e.g.
  `postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
  or `postgresql://postgres:postgres@localhost:5432/job_finder`. Use the pooled
  endpoint (Neon `-pooler`, Supabase `:6543`) on serverless providers.
- `PG_SSL` (`true`/`false`) — optional; TLS is auto-detected when unset (on for
  hosted providers, off for localhost). `PG_POOL_MAX` (10) and
  `PG_CONNECT_TIMEOUT_MS` (10000) tune the pool.
- `RAPIDAPI_KEY` — enables the JSearch source (free tier 200/month).
- `SENDER_EMAIL`, `SENDER_APP_PASSWORD`, `RECIPIENT_EMAIL` — Gmail daily digest.
  Use a Gmail **App Password**, not your login password. The scheduler only runs
  when `SENDER_EMAIL` is set.
- `DAILY_EMAIL_HOUR` (default 9) — IST hour for the digest. The timezone is fixed
  to `Asia/Kolkata`.
- `GOOGLE_SHEETS_CREDS` (default `credentials.json`), `GOOGLE_SHEET_ID` — Sheets export.
- `HUNTER_API_KEY` — optional; surfaces in `/api/hunter/status`.
- `HOST` (127.0.0.1), `PORT` (8000), `LOG_LEVEL` (info).

Relative credential paths are resolved against the `job-finder/` root.

## bun scripts

| Script                  | Does                                                |
| ----------------------- | --------------------------------------------------- |
| `bun run dev`           | API with reload (`bun --watch`) + Next dev server   |
| `bun run dev:api`       | API only (`bun --watch src/server.ts`)              |
| `bun run dev:web`       | Next dev server only (`bun --bun next dev`)         |
| `bun run build`         | Typecheck, compile TS → `dist/`, build `web/`        |
| `bun start`             | Run compiled output (`bun dist/server.js`) + Next    |
| `bun run start:api`     | API only (`bun dist/server.js`)                      |
| `bun run typecheck`     | `tsc --noEmit` across the whole project             |
| `bun run db:import`     | One-off copy of `jobs.db` (SQLite) → PostgreSQL     |
| `bun install`           | Install / update deps and `bun.lock`                 |

## Data flow

1. **Collection** (`/api/collect`, the scheduler, or a company crawl) runs two
   tracks: job boards (Remotive, RemoteOK, Arbeitnow, JSearch) in parallel, and
   per-company ATS crawls (Greenhouse, Lever, Ashby, HTML) at bounded
   concurrency (5). Each source is error-isolated with per-request timeouts and
   retry/backoff.
2. Every job is **scored** against the active profile (title / tech / experience
   / signal weights), filtered by `min_score_to_store`, and **deduped** by an
   MD5 fingerprint of `company|title|location` (`last_seen` refreshed on repeat).
3. **Cleanup** deletes jobs not re-seen in 14 days (protecting non-active
   statuses and email-marked rows).
4. **Outreach** generation builds LinkedIn people-search URLs + short/long DMs
   from the profile templates for the top-scoring jobs.
5. The **daily digest** emails the newest unemailed outreach items and marks them
   emailed; **Sheets export** writes filtered jobs to a Google Sheet.

## API

`GET /` (dashboard), `GET /outreach`, `GET /profile` serve the HTML UI. Under
`/api`:

- **Jobs**: `GET /jobs`, `GET /jobs/{id}`, `PATCH /jobs/{id}/status`,
  `POST /jobs/{id}/mark-for-email`, `GET /jobs/marked`, `GET /stats`,
  `GET /sources`, `POST /collect?generate_outreach=`.
- **Companies**: `GET /companies`, `POST /companies`, `PATCH|DELETE
  /companies/{id}`, `POST /companies/{id}/activate`, `GET /companies/stats`,
  `POST /companies/seed`, `POST /companies/mega-seed`,
  `POST /companies/{id}/crawl`, `POST /companies/crawl`.
- **Outreach**: `GET /outreach`, `GET /outreach/stats`,
  `POST /outreach/bulk-delete`, `POST /outreach/refresh`,
  `POST /outreach/generate`, `PATCH /outreach/{id}/status`,
  `PATCH /outreach/{id}/notes`.
- **Email / pipeline**: `POST /email/send-now?dry_run=`,
  `POST /email/run-pipeline?send=`, `POST /run-now?dryRun=` (`dryRun=true`
  collects + generates outreach but skips sending), `GET /email/status`.
- **Search queries** (on the active profile): `GET|POST /search-queries`,
  `PATCH|DELETE /search-queries/{qid}`.
- **Profiles**: `GET /profiles`, `GET /profiles/active`, `GET|PUT|DELETE
  /profiles/{id}`, `POST /profiles`, `POST /profiles/{id}/activate`,
  `POST /profiles/{id}/duplicate`, `POST /profiles/import`, `GET
  /profiles/{id}/export`, `POST /profiles/rescore-all?delete_below_min=`.
- **Sheets**: `POST /export/sheets`, `GET /export/sheets/status`.
- **Status**: `GET /jsearch/status`, `GET /hunter/status`.

Errors return a `{ detail: "..." }` body with an appropriate HTTP status for
validation/not-found cases, while a few handlers return `{ error: "..." }` at
HTTP 200 (job-not-found, company-not-found, sheets errors).

## Notes

- Runtime is Bun: `bun install` (with `bun.lock`) replaces npm, `bun --watch`
  replaces `tsx`, and `.env` is loaded by Bun itself — no `dotenv` bootstrap.
- The database is PostgreSQL through `pg` with raw SQL (`$1` placeholders, no
  ORM). `src/db/connection.ts` owns one shared `pg.Pool` configured from
  `DATABASE_URL`; `withTransaction()` wraps multi-statement work (batch job
  inserts, rescore-all). Every DB function is async, so route handlers are
  wrapped in `asyncHandler()` — Express 4 does not forward rejected promises by
  itself.
- Timestamps are stored as ISO-8601 `TEXT` (no `Z`) rather than `timestamptz`, so
  the API payloads and the lexicographic ordering used for batches stay exactly
  as they were. `COUNT(*)`/`AVG()` are cast to `int`/`float8` because `pg`
  returns bigint and numeric as strings.
- Express still owns the HTTP server (`app.listen` on `node:http`); nothing is
  served through `Bun.serve`.
- `node:fs`, `node:path` and `node:crypto` imports are kept on purpose — Bun
  implements them natively.
- `POST /api/companies/detect-ats` and `POST /api/companies/discover` are
  placeholders that return `{ "error": "not implemented" }`. The ATS
  platform/slug is still set when seeding or when adding/updating a company.
- The daily digest is scheduled with `node-cron` in the `Asia/Kolkata` timezone.
- The `profiles/backend_go_node_remote.yaml` preset targets Go / Node.js /
  TypeScript / PostgreSQL, ~1–2 YOE, remote-only, India-friendly (weights sum to 100).
