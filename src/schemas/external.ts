import { z } from "zod";

// Zod schemas for the *external* API responses each source consumes. These are
// deliberately permissive (`.catch()` / optional fields) because third-party
// payloads are outside our control — the requirement is that every external
// response is validated/normalised through a schema rather than trusted raw.

const nullableStr = (v: unknown): string =>
    typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

// ── JSearch ───────────────────────────────────────────────────────────
export const jsearchItemSchema = z
    .object({
        job_title: z.string().catch(""),
        employer_name: z.string().catch(""),
        job_city: z.string().catch(""),
        job_state: z.string().catch(""),
        job_country: z.string().catch(""),
        job_is_remote: z.boolean().catch(false),
        job_min_salary: z.number().nullable().catch(null),
        job_max_salary: z.number().nullable().catch(null),
        job_salary_period: z.string().nullable().catch(null),
        job_apply_link: z.string().catch(""),
        job_google_link: z.string().catch(""),
        employer_website: z.string().catch(""),
        job_description: z.string().catch(""),
        job_posted_at_datetime_utc: z.string().catch(""),
        job_posted_at: z.string().catch(""),
        job_employment_type: z.string().catch("FULLTIME"),
    })
    .passthrough();

export const jsearchResponseSchema = z
    .object({ data: z.array(jsearchItemSchema).catch([]) })
    .passthrough();

// ── Remotive ──────────────────────────────────────────────────────────
export const remotiveItemSchema = z
    .object({
        title: z.string().catch(""),
        company_name: z.string().catch(""),
        candidate_required_location: z.string().catch("Anywhere"),
        description: z.string().catch(""),
        url: z.string().catch(""),
        publication_date: z.string().catch(""),
        salary: z.unknown().transform(nullableStr),
        job_type: z.unknown().transform(nullableStr),
    })
    .passthrough();

export const remotiveResponseSchema = z
    .object({ jobs: z.array(remotiveItemSchema).catch([]) })
    .passthrough();

// ── RemoteOK (array; first element is metadata) ───────────────────────
export const remoteokItemSchema = z
    .object({
        position: z.string().catch(""),
        company: z.string().catch(""),
        location: z.unknown().transform(nullableStr),
        description: z.string().catch(""),
        url: z.string().catch(""),
        id: z.union([z.number(), z.string()]).catch(0),
        date: z.string().catch(""),
        salary_min: z.number().nullable().catch(null),
        salary_max: z.number().nullable().catch(null),
        tags: z.array(z.string()).catch([]),
    })
    .passthrough();

// ── Arbeitnow ─────────────────────────────────────────────────────────
export const arbeitnowItemSchema = z
    .object({
        title: z.string().catch(""),
        company_name: z.string().catch(""),
        location: z.string().catch("Remote"),
        description: z.string().catch(""),
        url: z.string().catch(""),
        created_at: z.union([z.number(), z.string()]).catch(0),
        tags: z.array(z.string()).catch([]),
        remote: z.boolean().catch(false),
    })
    .passthrough();

export const arbeitnowResponseSchema = z
    .object({ data: z.array(arbeitnowItemSchema).catch([]) })
    .passthrough();

// ── Greenhouse ────────────────────────────────────────────────────────
export const greenhouseItemSchema = z
    .object({
        title: z.string().catch(""),
        location: z
            .union([z.object({ name: z.string().catch("") }).passthrough(), z.string()])
            .catch(""),
        content: z.string().catch(""),
        absolute_url: z.string().catch(""),
        updated_at: z.string().catch(""),
    })
    .passthrough();

export const greenhouseResponseSchema = z
    .object({ jobs: z.array(greenhouseItemSchema).catch([]) })
    .passthrough();

// ── Lever (response is a top-level array) ─────────────────────────────
export const leverItemSchema = z
    .object({
        text: z.string().catch(""),
        createdAt: z.number().nullable().catch(null),
        categories: z
            .object({ location: z.string().catch("") })
            .passthrough()
            .nullable()
            .catch(null),
        descriptionPlain: z.string().catch(""),
        description: z.string().catch(""),
        hostedUrl: z.string().catch(""),
    })
    .passthrough();

export const leverResponseSchema = z.array(leverItemSchema).catch([]);

// ── Ashby ─────────────────────────────────────────────────────────────
export const ashbyItemSchema = z
    .object({
        title: z.string().catch(""),
        location: z
            .union([z.object({ name: z.string().catch("") }).passthrough(), z.string()])
            .catch(""),
        compensation: z
            .object({ summaryComponents: z.array(z.string()).catch([]) })
            .passthrough()
            .nullable()
            .catch(null),
        descriptionHtml: z.string().catch(""),
        descriptionPlain: z.string().catch(""),
        externalLink: z.string().catch(""),
        jobUrl: z.string().catch(""),
        publishedDate: z.string().catch(""),
    })
    .passthrough();

export const ashbyResponseSchema = z
    .object({ jobs: z.array(ashbyItemSchema).catch([]) })
    .passthrough();
