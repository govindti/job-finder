# Job Finder

A job-hunting platform I built in JavaScript/TypeScript: a multi-source job
scraper with a scoring engine, MD5 dedupe, stale-job cleanup, a LinkedIn
outreach generator, a daily email digest, Google Sheets export, and a web
dashboard. The backend runs on Node 20 + Express + better-sqlite3 + node-cron,
and the UI is a Next.js app under `web/`.

## Stack

| Concern            | Choice                                        |
| ------------------ | --------------------------------------------- |
| Runtime            | Node 20+                                       |
| Language           | TypeScript (strict, ESM `NodeNext`)            |
| HTTP framework     | Express 4                                      |
| Validation         | `zod` (every external API response is validated) |
| Database           | `better-sqlite3` (synchronous, no ORM)         |
| Scheduler          | `node-cron` (timezone `Asia/Kolkata`)          |
| Email              | `nodemailer` (Gmail SMTP_SSL :465)             |
| HTTP client        | native `fetch` + `AbortController` (timeout + retry/backoff) |
| HTML parsing       | `cheerio`                                      |
| Config / presets   | `yaml`, `dotenv`                               |
| Logging            | `pino`                                          |
| Google Sheets      | `googleapis` (Sheets v4)                       |
| Frontend           | Next.js (`web/`)                               |

## Project layout

```
job-finder/
  src/
    config/       env.ts, logger.ts, settings.ts (legacy first-run defaults)
    db/           connection.ts (schema), repo.ts (CRUD), profile.ts,
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
  public/         static/ + templates/ (server-rendered dashboard)
  profiles/       *.yaml presets (backend_python, backend_go_node_remote, ...)
  web/            Next.js frontend (app router + shared components)
```

## Setup

```bash
cd job-finder
npm install
cp .env.example .env      # fill in the values you need (see below)
npm run dev               # tsx watch src/server.ts  → http://127.0.0.1:8000
```

`jobs.db` is created automatically on first run, the schema is migrated in, and
a legacy starter profile is seeded + activated.

### Environment

All variables live in `.env` (see `.env.example`):

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

## npm scripts

| Script               | Does                                             |
| -------------------- | ------------------------------------------------ |
| `npm run dev`        | Dev server with reload (`tsx watch`)             |
| `npm run build`      | Compile TS → `dist/`                               |
| `npm start`          | Run compiled output (`node dist/server.js`)      |
| `npm run typecheck`  | `tsc --noEmit` across the whole project          |

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

- `POST /api/companies/detect-ats` and `POST /api/companies/discover` are
  placeholders that return `{ "error": "not implemented" }`. The ATS
  platform/slug is still set when seeding or when adding/updating a company.
- The daily digest is scheduled with `node-cron` in the `Asia/Kolkata` timezone.
- The `profiles/backend_go_node_remote.yaml` preset targets Go / Node.js /
  TypeScript / PostgreSQL, ~1–2 YOE, remote-only, India-friendly (weights sum to 100).
