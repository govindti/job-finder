# Job Finder

A job-hunting platform I built in JavaScript/TypeScript: a multi-source job
scraper with a scoring engine, MD5 dedupe, stale-job cleanup, a LinkedIn
outreach generator, a daily email digest, Google Sheets export, and a web
dashboard. The backend uses native `Bun.serve` HTTP routing, PostgreSQL (`pg`),
and built-in `Bun.cron` scheduling. The UI is a Next.js app under `web/`, also
launched through Bun. Next.js is the only UI; the Bun server is API-only.

## Stack

| Concern            | Choice                                        |
| ------------------ | --------------------------------------------- |
| Runtime            | Bun 1.4.3+ (package manager + runtime)        |
| Language           | TypeScript (strict, ESM `NodeNext`)            |
| HTTP server        | Native `Bun.serve` routes + Web Request/Response |
| Validation         | `zod` (request bodies and job-source payloads) |
| Database           | PostgreSQL via `pg` (Neon, Supabase, or local), raw SQL, no ORM |
| Scheduler          | Built-in `Bun.cron` (timezone `Asia/Kolkata`)  |
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
    app/          routes.ts (domain route composition)
    config/       Environment and logging
    common/       errors/ (browser-safe contract + server handler), http/, utils/
    infrastructure/
      database/   pg pool, transactions, schema bootstrap
      http/       Outbound timeout/retry client
    modules/
      jobs/       Job queries, statuses, scoring, batch storage, rescoring, cleanup
      companies/  Company management, crawl status, seed datasets, statistics
      profiles/   Profile CRUD, active cache, config, YAML presets, search queries
      collection/ Board/ATS adapters, collection and company crawls, JSearch usage
      outreach/   LinkedIn templates, generation, batch tracking, Hunter status
      email/      Digest HTML/text rendering, delivery and delivery logs
      exports/    Google Sheets adapter and export use case
      automation/ Cross-domain workflows and the native cron lifecycle
    server.ts     Bun.serve startup and graceful shutdown
  scripts/        import-sqlite.ts (one-off SQLite → PostgreSQL copy)
  tests/          HTTP, services, frontend API client, architecture, and cron tests
  profiles/       *.yaml presets (backend_python, backend_go_node_remote, ...)
  web/            Next.js frontend (app router + shared components)
```

Each domain has `<domain>.routes.ts`, `.controller.ts`, `.dto.ts`, and `.service.ts`;
persistence domains also have `.repository.ts`. Types, providers, datasets, and
renderers live alongside the domain that owns them. Routes only declare handlers;
controllers parse DTOs and serialize successes; services own use cases and throw
application errors; repositories own SQL. Cross-domain calls go through services
and types, never another domain's repository. Automation composes domain services
without reverse dependencies. This is a modular monolith, with no NestJS or DI framework.

## Setup

```bash
cd job-finder
bun install               # writes bun.lock (no package-lock.json)
cp .env.example .env      # fill in DATABASE_URL and the rest (see below)
bun run dev               # API :8000 + Next.js UI → http://localhost:3000
```

Use Bun **1.4.3 or newer** for native cron callbacks with timezone support.
The Next.js UI runs at **http://localhost:3000** (`/`, `/outreach`, `/profile`)
and proxies `/api` to the backend at **http://127.0.0.1:8000**. The backend no
longer serves HTML pages or public static assets; former UI URLs return JSON 404s.

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
| `bun run typecheck`     | Backend, scripts, tests, and frontend TypeScript checks |
| `bun test tests`        | Regression tests with mocked integrations; no real writes |
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

All 50 API method/path operations remain under `/api`. The UI routes are served
only by Next.js.

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

### Error contract

Every application-generated failure is serialized by one handler, with an HTTP
status matching `status_code` and exactly these fields:

```json
{ "err_code": "JOB_NOT_FOUND", "status_code": 404, "err_mess": "Job not found" }
```

Stable codes and envelope types live in `src/common/errors/error-codes.ts`, which
is browser-safe. Server-side `AppError` owns status/message metadata and optional
internal causes; unexpected failures return a generic message while causes are
logged server-side. No failed mutation is intentionally reported as HTTP 200.

| Failure | HTTP status |
| --- | --- |
| Malformed JSON / unreadable request | 400 |
| DTO or preset validation | 422 |
| Missing resource or route | 404 |
| Unsupported method (`Allow` header included) | 405 |
| Active-profile deletion / no active profile / resource conflict | 409 |
| Request body over 100 KiB | 413 |
| Unimplemented discovery | 501 |
| Upstream integration failure | 502 |
| Missing integration configuration | 503 |
| Unexpected exception | 500 |

`web/lib/api.ts` throws a typed `ApiError`; centralized code-to-message formatting
is in `web/lib/api-error.ts`. Unknown codes use the safe server message, while
network, non-JSON/proxy, and invalid-envelope failures use local safe fallbacks.
YAML profile downloads use the same client. Email-log error fields remain
historical log data, not API failure envelopes.

Empty lists, unconfigured integration status responses, no-items-to-send results,
and best-effort collection statistics remain successes. A manual pipeline email
failure returns an error but does not roll back earlier collection work.

## Notes

- Runtime is Bun: `bun install` (with `bun.lock`) replaces npm, `bun --watch`
  replaces `tsx`, and `.env` is loaded by Bun itself — no `dotenv` bootstrap.
- The database is PostgreSQL through `pg` with raw SQL (`$1` placeholders, no
  ORM). `src/infrastructure/database/connection.ts` owns one shared `pg.Pool` configured from
  `DATABASE_URL`; `withTransaction()` wraps multi-statement work (batch job
  inserts, rescore-all). Native async route handlers return `Response` objects;
  rejected promises reach the shared `Bun.serve` error handler.
- Timestamps are stored as ISO-8601 `TEXT` (no `Z`) rather than `timestamptz`, so
  the API payloads and the lexicographic ordering used for batches stay exactly
  as they were. `COUNT(*)`/`AVG()` are cast to `int`/`float8` because `pg`
  returns bigint and numeric as strings.
- HTTP runs directly on `Bun.serve`, with no Express dependency or adapter.
  Native method maps live in domain modules and are composed by `src/app/routes.ts`.
  Shared guards handle unknown routes, unsupported methods, and bodyless HEAD responses.
- Request bodies are capped at 100 KiB by a bounded streaming reader, with an
  early Content-Length check, actual byte counting, cancellation, and cached bytes
  for DTO parsing. Bun's native limit is `Infinity` only because its native 413
  bypasses the JSON serializer; the application guard enforces the real limit,
  including chunked bodies. Malformed HTTP or proxy failures may occur outside
  application handling. HTTP idle timeouts remain disabled for long-running work.
- `node:fs`, `node:path` and `node:crypto` imports are kept on purpose — Bun
  implements them natively.
- `POST /api/companies/detect-ats` and `POST /api/companies/discover` are
  placeholders that return `NOT_IMPLEMENTED` with HTTP 501. The ATS
  platform/slug is still set when seeding or when adding/updating a company.
- The daily digest uses `Bun.cron(expression, callback, { tz: "Asia/Kolkata" })`.
  It runs only while the API process is alive and installs no OS-level tasks.
  The callback returns its pipeline promise so scheduled runs cannot overlap.
  Shutdown stops cron, drains pending requests and the running digest, then
  closes the database pool. Only one API instance should run the scheduler.
- The `profiles/backend_go_node_remote.yaml` preset targets Go / Node.js /
  TypeScript / PostgreSQL, ~1–2 YOE, remote-only, India-friendly (weights sum to 100).
