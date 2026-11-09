import { param, query, queryOne, type Executor } from "./connection.js";
import { daysAgoIso, utcNowIso } from "../utils/models.js";

// ── Row types (column names mirror the PostgreSQL tables exactly) ──────

export interface JobRow {
    id: string;
    title: string;
    company: string;
    location: string | null;
    description: string | null;
    url: string | null;
    source: string | null;
    posted_date: string | null;
    discovered_at: string;
    tech_stack: string | null;
    experience_level: string | null;
    relevance_score: number | null;
    status: string | null;
    company_domain: string | null;
    salary: string | null;
    job_type: string | null;
    india_friendly: string | null;
    location_note: string | null;
    last_seen: string | null;
    mark_for_email: number | null;
    scored_profile_id: number | null;
}

export interface CompanyRow {
    id: string;
    name: string;
    domain: string | null;
    careers_url: string | null;
    ats_platform: string | null;
    ats_slug: string | null;
    founded_year: number | null;
    employee_count: string | null;
    tags: string | null;
    india_friendly: string | null;
    last_crawled: string | null;
    crawl_status: string | null;
    notes: string | null;
}

export interface OutreachRow {
    id: string;
    job_id: string;
    job_title: string | null;
    company: string | null;
    company_domain: string | null;
    contact_name: string | null;
    contact_position: string | null;
    contact_linkedin: string | null;
    dm_short: string | null;
    dm_long: string | null;
    status: string | null;
    messaged_at: string | null;
    replied_at: string | null;
    followed_up_at: string | null;
    created_at: string;
    notes: string | null;
    emailed_at: string | null;
    profile_id: number | null;
}

// Outreach rows returned with joined job fields.
export type OutreachJoined = OutreachRow & {
    job_url: string | null;
    relevance_score: number | null;
    tech_stack: string | null;
    location: string | null;
    salary: string | null;
    india_friendly: string | null;
};

export type OutreachUnemailed = OutreachRow & {
    relevance_score: number | null;
    job_url: string | null;
    job_description: string | null;
    tech_stack: string | null;
    salary: string | null;
    location: string | null;
    posted_date: string | null;
    india_friendly: string | null;
    mark_for_email: number | null;
};

export interface SearchQueryRow {
    id: number;
    query: string;
    country: string | null;
    date_posted: string | null;
    remote_jobs_only: number | null;
    enabled: number | null;
    created_at: string;
}

export interface EmailLogRow {
    id: number;
    sent_at: string;
    recipient: string;
    subject: string | null;
    items_count: number | null;
    outreach_ids: string | null;
    status: string | null;
    error: string | null;
}

export interface ProfileRow {
    id: number;
    name: string;
    description: string;
    config_json: string;
    created_at: string;
    updated_at: string;
    source: string;
}

// ── Jobs CRUD ─────────────────────────────────────────────────────────

export type JobInsert = Pick<
    JobRow,
    | "id"
    | "title"
    | "company"
    | "location"
    | "description"
    | "url"
    | "source"
    | "posted_date"
    | "discovered_at"
    | "tech_stack"
    | "experience_level"
    | "relevance_score"
    | "status"
    | "company_domain"
    | "salary"
    | "job_type"
    | "india_friendly"
    | "location_note"
> & {
    scored_profile_id?: number | null;
};

/**
 * Upsert a job. Returns "new" or "updated" (last_seen refreshed). Pass a
 * transaction client as `exec` to batch many inserts on one connection.
 */
export async function insertJob(job: JobInsert, exec?: Executor): Promise<"new" | "updated"> {
    const now = utcNowIso();
    const existing = await queryOne<{ id: string }>(
        "SELECT id FROM jobs WHERE id = $1",
        [job.id],
        exec,
    );
    if (existing) {
        await query("UPDATE jobs SET last_seen = $1 WHERE id = $2", [now, job.id], exec);
        return "updated";
    }
    const params: unknown[] = [];
    const values = [
        job.id,
        job.title,
        job.company,
        job.location,
        job.description,
        job.url,
        job.source,
        job.posted_date,
        job.discovered_at,
        job.tech_stack,
        job.experience_level,
        job.relevance_score,
        job.status,
        job.company_domain,
        job.salary,
        job.job_type,
        job.india_friendly,
        job.location_note,
        now,
        job.scored_profile_id ?? null,
    ];
    const placeholders = values.map((v) => param(params, v));
    await query(
        `INSERT INTO jobs (id, title, company, location, description, url,
        source, posted_date, discovered_at, tech_stack, experience_level,
        relevance_score, status, company_domain, salary, job_type,
        india_friendly, location_note, last_seen, scored_profile_id)
      VALUES (${placeholders.join(", ")})`,
        params,
        exec,
    );
    return "new";
}

/** Delete jobs not re-seen within `days`, protecting non-active statuses and marked jobs. */
export async function cleanupOldJobs(days = 14): Promise<number> {
    const cutoff = daysAgoIso(days);
    const res = await query(
        `DELETE FROM jobs
        WHERE (last_seen < $1 OR last_seen = '' OR last_seen IS NULL)
          AND status IN ('new', 'reviewed', 'stale')
          AND (mark_for_email = 0 OR mark_for_email IS NULL)`,
        [cutoff],
    );
    return res.rowCount ?? 0;
}

export async function toggleMarkForEmail(jobId: string): Promise<boolean> {
    const row = await queryOne<{ m: number | null }>(
        "SELECT mark_for_email AS m FROM jobs WHERE id = $1",
        [jobId],
    );
    const newState = row && row.m ? 0 : 1;
    await query("UPDATE jobs SET mark_for_email = $1 WHERE id = $2", [newState, jobId]);
    return newState === 1;
}

export async function getMarkedJobs(limit = 50): Promise<JobRow[]> {
    const res = await query<JobRow>(
        "SELECT * FROM jobs WHERE mark_for_email = 1 ORDER BY relevance_score DESC LIMIT $1",
        [limit],
    );
    return res.rows;
}

export interface JobFilters {
    source?: string | null;
    status?: string | null;
    min_score?: number;
    search?: string | null;
    location?: string | null;
    tech?: string | null;
    india_friendly?: string | null;
    company_domain?: string | null;
    seen_after?: string | null;
    limit?: number;
    offset?: number;
}

export async function getJobs(f: JobFilters = {}): Promise<JobRow[]> {
    const params: unknown[] = [];
    const where: string[] = [`relevance_score >= ${param(params, f.min_score ?? 0)}`];

    // ILIKE keeps the case-insensitive matching SQLite's LIKE gave us.
    if (f.source) where.push(`source ILIKE ${param(params, `%${f.source}%`)}`);
    if (f.status) where.push(`status = ${param(params, f.status)}`);
    if (f.search) {
        const s = param(params, `%${f.search}%`);
        where.push(`(title ILIKE ${s} OR company ILIKE ${s} OR description ILIKE ${s})`);
    }
    if (f.location) where.push(`location ILIKE ${param(params, `%${f.location}%`)}`);
    if (f.tech) where.push(`tech_stack ILIKE ${param(params, `%${f.tech}%`)}`);
    if (f.india_friendly) {
        if (f.india_friendly === "yes") where.push("india_friendly = 'yes'");
        else if (f.india_friendly === "no") where.push("india_friendly = 'no'");
        else if (f.india_friendly === "maybe") where.push("india_friendly IN ('yes', 'maybe')");
    }
    if (f.company_domain) where.push(`company_domain = ${param(params, f.company_domain)}`);
    if (f.seen_after) where.push(`last_seen >= ${param(params, f.seen_after)}`);

    const limit = param(params, f.limit ?? 100);
    const offset = param(params, f.offset ?? 0);
    const res = await query<JobRow>(
        `SELECT * FROM jobs WHERE ${where.join(" AND ")}
         ORDER BY relevance_score DESC, discovered_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
    );
    return res.rows;
}

export async function getJobById(jobId: string): Promise<JobRow | undefined> {
    return queryOne<JobRow>("SELECT * FROM jobs WHERE id = $1", [jobId]);
}

export async function updateJobStatus(jobId: string, status: string): Promise<void> {
    await query("UPDATE jobs SET status = $1 WHERE id = $2", [status, jobId]);
}

export interface JobStats {
    total: number;
    by_source: Record<string, number>;
    by_status: Record<string, number>;
    by_india: Record<string, number>;
    avg_score: number;
}

export async function getStats(): Promise<JobStats> {
    const totalRow = await queryOne<{ c: number }>("SELECT COUNT(*)::int AS c FROM jobs");
    const bySource = await query<{ source: string | null; count: number }>(
        "SELECT source, COUNT(*)::int AS count FROM jobs GROUP BY source",
    );
    const byStatus = await query<{ status: string | null; count: number }>(
        "SELECT status, COUNT(*)::int AS count FROM jobs GROUP BY status",
    );
    const byIndia = await query<{ india_friendly: string | null; count: number }>(
        "SELECT india_friendly, COUNT(*)::int AS count FROM jobs GROUP BY india_friendly",
    );
    const avgRow = await queryOne<{ a: number | null }>(
        "SELECT AVG(relevance_score)::float8 AS a FROM jobs WHERE relevance_score > 0",
    );
    const avg = avgRow?.a ?? null;
    return {
        total: totalRow?.c ?? 0,
        by_source: groupCount(bySource.rows, "source"),
        by_status: groupCount(byStatus.rows, "status"),
        by_india: groupCount(byIndia.rows, "india_friendly"),
        avg_score: avg ? Math.round(avg * 10) / 10 : 0,
    };
}

export async function getSources(): Promise<string[]> {
    const rows = await query<{ source: string }>(
        "SELECT DISTINCT source FROM jobs WHERE source IS NOT NULL ORDER BY source",
    );
    return rows.rows.map((r) => r.source);
}

function groupCount(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) {
        const k = (r[key] ?? "") as string;
        out[k] = r.count as number;
    }
    return out;
}

// ── Companies CRUD ────────────────────────────────────────────────────

export type CompanyInsert = CompanyRow;

export async function upsertCompany(c: CompanyInsert): Promise<boolean> {
    try {
        await query(
            `INSERT INTO companies
            (id, name, domain, careers_url, ats_platform, ats_slug,
             founded_year, employee_count, tags, india_friendly,
             last_crawled, crawl_status, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             domain = EXCLUDED.domain,
             careers_url = EXCLUDED.careers_url,
             ats_platform = EXCLUDED.ats_platform,
             ats_slug = EXCLUDED.ats_slug,
             founded_year = EXCLUDED.founded_year,
             employee_count = EXCLUDED.employee_count,
             tags = EXCLUDED.tags,
             india_friendly = EXCLUDED.india_friendly,
             last_crawled = EXCLUDED.last_crawled,
             crawl_status = EXCLUDED.crawl_status,
             notes = EXCLUDED.notes`,
            [
                c.id,
                c.name,
                c.domain,
                c.careers_url,
                c.ats_platform,
                c.ats_slug,
                c.founded_year,
                c.employee_count,
                c.tags,
                c.india_friendly,
                c.last_crawled,
                c.crawl_status,
                c.notes,
            ],
        );
        return true;
    } catch {
        return false;
    }
}

export interface CompanyFilters {
    ats_platform?: string | null;
    crawl_status?: string | null;
    india_friendly?: string | null;
    search?: string | null;
    limit?: number;
    offset?: number;
}

export async function getCompanies(f: CompanyFilters = {}): Promise<CompanyRow[]> {
    const params: unknown[] = [];
    const where: string[] = ["1=1"];
    if (f.ats_platform) where.push(`ats_platform = ${param(params, f.ats_platform)}`);
    if (f.crawl_status) where.push(`crawl_status = ${param(params, f.crawl_status)}`);
    if (f.india_friendly) where.push(`india_friendly = ${param(params, f.india_friendly)}`);
    if (f.search) {
        const s = param(params, `%${f.search}%`);
        where.push(`(name ILIKE ${s} OR domain ILIKE ${s} OR tags ILIKE ${s})`);
    }
    const limit = param(params, f.limit ?? 200);
    const offset = param(params, f.offset ?? 0);
    const res = await query<CompanyRow>(
        `SELECT * FROM companies WHERE ${where.join(" AND ")}
         ORDER BY name ASC LIMIT ${limit} OFFSET ${offset}`,
        params,
    );
    return res.rows;
}

export async function getCompanyById(companyId: string): Promise<CompanyRow | undefined> {
    return queryOne<CompanyRow>("SELECT * FROM companies WHERE id = $1", [companyId]);
}

export async function updateCompanyCrawlStatus(
    companyId: string,
    status: string,
    lastCrawled = "",
): Promise<void> {
    if (lastCrawled) {
        await query("UPDATE companies SET crawl_status = $1, last_crawled = $2 WHERE id = $3", [
            status,
            lastCrawled,
            companyId,
        ]);
    } else {
        await query("UPDATE companies SET crawl_status = $1 WHERE id = $2", [status, companyId]);
    }
}

export interface CompanyStats {
    total: number;
    by_platform: Record<string, number>;
    by_status: Record<string, number>;
    by_india: Record<string, number>;
}

export async function getCompanyStats(): Promise<CompanyStats> {
    const totalRow = await queryOne<{ c: number }>("SELECT COUNT(*)::int AS c FROM companies");
    const byPlatform = await query<{ ats_platform: string | null; count: number }>(
        "SELECT ats_platform, COUNT(*)::int AS count FROM companies GROUP BY ats_platform",
    );
    const byStatus = await query<{ crawl_status: string | null; count: number }>(
        "SELECT crawl_status, COUNT(*)::int AS count FROM companies GROUP BY crawl_status",
    );
    const byIndia = await query<{ india_friendly: string | null; count: number }>(
        "SELECT india_friendly, COUNT(*)::int AS count FROM companies GROUP BY india_friendly",
    );
    return {
        total: totalRow?.c ?? 0,
        by_platform: groupCount(byPlatform.rows, "ats_platform"),
        by_status: groupCount(byStatus.rows, "crawl_status"),
        by_india: groupCount(byIndia.rows, "india_friendly"),
    };
}

// ── Outreach CRUD ─────────────────────────────────────────────────────

export async function insertOutreach(item: OutreachRow): Promise<boolean> {
    try {
        await query(
            `INSERT INTO outreach
            (id, job_id, job_title, company, company_domain, contact_name,
             contact_position, contact_linkedin, dm_short, dm_long, status,
             messaged_at, replied_at, followed_up_at, created_at, notes, emailed_at, profile_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (id) DO UPDATE SET
             job_id = EXCLUDED.job_id,
             job_title = EXCLUDED.job_title,
             company = EXCLUDED.company,
             company_domain = EXCLUDED.company_domain,
             contact_name = EXCLUDED.contact_name,
             contact_position = EXCLUDED.contact_position,
             contact_linkedin = EXCLUDED.contact_linkedin,
             dm_short = EXCLUDED.dm_short,
             dm_long = EXCLUDED.dm_long,
             status = EXCLUDED.status,
             messaged_at = EXCLUDED.messaged_at,
             replied_at = EXCLUDED.replied_at,
             followed_up_at = EXCLUDED.followed_up_at,
             created_at = EXCLUDED.created_at,
             notes = EXCLUDED.notes,
             emailed_at = EXCLUDED.emailed_at,
             profile_id = EXCLUDED.profile_id`,
            [
                item.id,
                item.job_id,
                item.job_title,
                item.company,
                item.company_domain,
                item.contact_name,
                item.contact_position,
                item.contact_linkedin,
                item.dm_short,
                item.dm_long,
                item.status,
                item.messaged_at,
                item.replied_at,
                item.followed_up_at,
                item.created_at,
                item.notes,
                item.emailed_at,
                item.profile_id,
            ],
        );
        return true;
    } catch {
        return false;
    }
}

export interface OutreachFilters {
    status?: string | null;
    search?: string | null;
    batch?: "new" | "old" | null;
    limit?: number;
    offset?: number;
}

export async function getOutreach(f: OutreachFilters = {}): Promise<OutreachJoined[]> {
    const params: unknown[] = [];
    const where: string[] = ["1=1"];
    if (f.status) where.push(`o.status = ${param(params, f.status)}`);
    if (f.search) {
        const s = param(params, `%${f.search}%`);
        where.push(`(o.company ILIKE ${s} OR o.job_title ILIKE ${s} OR o.contact_name ILIKE ${s})`);
    }
    if (f.batch === "new" || f.batch === "old") {
        const batchAt = await getLastOutreachBatchAt();
        if (batchAt) {
            const op = f.batch === "new" ? ">=" : "<";
            where.push(`o.created_at ${op} ${param(params, batchAt)}`);
        } else if (f.batch === "new") {
            where.push("FALSE");
        }
    }
    const limit = param(params, f.limit ?? 100);
    const offset = param(params, f.offset ?? 0);
    const res = await query<OutreachJoined>(
        `SELECT o.*, j.url as job_url, j.relevance_score, j.tech_stack,
                j.location, j.salary, j.india_friendly
         FROM outreach o
         LEFT JOIN jobs j ON j.id = o.job_id
         WHERE ${where.join(" AND ")}
         ORDER BY o.created_at DESC, j.relevance_score DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
    );
    return res.rows;
}

export async function deleteOutreachBulk(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const res = await query("DELETE FROM outreach WHERE id = ANY($1::text[])", [ids]);
    return res.rowCount ?? 0;
}

export async function deleteAllOutreach(): Promise<number> {
    const res = await query("DELETE FROM outreach");
    return res.rowCount ?? 0;
}

export async function setLastOutreachBatchAt(ts: string): Promise<void> {
    await query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('last_outreach_batch_at', $1, $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [ts],
    );
}

export async function getLastOutreachBatchAt(): Promise<string | null> {
    const row = await queryOne<{ value: string }>(
        "SELECT value FROM app_settings WHERE key = 'last_outreach_batch_at'",
    );
    return row ? row.value : null;
}

export async function updateOutreachStatus(
    outreachId: string,
    status: string,
    field?: string,
): Promise<void> {
    const ts = utcNowIso();
    if (field === "messaged") {
        await query("UPDATE outreach SET status=$1, messaged_at=$2 WHERE id=$3", [
            status,
            ts,
            outreachId,
        ]);
    } else if (field === "replied") {
        await query("UPDATE outreach SET status=$1, replied_at=$2 WHERE id=$3", [
            status,
            ts,
            outreachId,
        ]);
    } else if (field === "followed_up") {
        await query("UPDATE outreach SET status=$1, followed_up_at=$2 WHERE id=$3", [
            status,
            ts,
            outreachId,
        ]);
    } else {
        await query("UPDATE outreach SET status=$1 WHERE id=$2", [status, outreachId]);
    }
}

export async function updateOutreachNotes(outreachId: string, notes: string): Promise<void> {
    await query("UPDATE outreach SET notes = $1 WHERE id = $2", [notes, outreachId]);
}

export async function outreachExistsForJob(jobId: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
        "SELECT id FROM outreach WHERE job_id = $1 LIMIT 1",
        [jobId],
    );
    return Boolean(row);
}

export async function getOutreachStats(): Promise<{
    total: number;
    by_status: Record<string, number>;
}> {
    const totalRow = await queryOne<{ c: number }>("SELECT COUNT(*)::int AS c FROM outreach");
    const byStatus = await query<{ status: string | null; count: number }>(
        "SELECT status, COUNT(*)::int AS count FROM outreach GROUP BY status",
    );
    return { total: totalRow?.c ?? 0, by_status: groupCount(byStatus.rows, "status") };
}

export async function getUnemailedOutreach(
    limit = 15,
    onlyMarked = false,
): Promise<OutreachUnemailed[]> {
    let where = "(o.emailed_at = '' OR o.emailed_at IS NULL) AND o.status = 'pending'";
    if (onlyMarked) where += " AND j.mark_for_email = 1";
    const res = await query<OutreachUnemailed>(
        `SELECT o.*, j.relevance_score, j.url AS job_url, j.description AS job_description,
              j.tech_stack, j.salary, j.location, j.posted_date, j.india_friendly,
              j.mark_for_email
        FROM outreach o
        LEFT JOIN jobs j ON j.id = o.job_id
        WHERE ${where}
        ORDER BY j.mark_for_email DESC, j.relevance_score DESC, o.created_at DESC
        LIMIT $1`,
        [limit],
    );
    return res.rows;
}

export async function markOutreachEmailed(outreachIds: string[]): Promise<void> {
    if (!outreachIds.length) return;
    await query(
        `UPDATE outreach SET emailed_at = $1,
        status = CASE WHEN status = 'pending' THEN 'emailed' ELSE status END
      WHERE id = ANY($2::text[])`,
        [utcNowIso(), outreachIds],
    );
}

export async function logEmail(
    recipient: string,
    subject: string,
    itemsCount: number,
    outreachIds: string[],
    status = "sent",
    error = "",
): Promise<void> {
    await query(
        `INSERT INTO email_log (sent_at, recipient, subject, items_count, outreach_ids, status, error)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [utcNowIso(), recipient, subject, itemsCount, outreachIds.join(","), status, error],
    );
}

export async function getEmailLogs(limit = 30): Promise<EmailLogRow[]> {
    const res = await query<EmailLogRow>(
        "SELECT * FROM email_log ORDER BY sent_at DESC LIMIT $1",
        [limit],
    );
    return res.rows;
}

// ── Search queries (legacy table) ─────────────────────────────────────

export async function getSearchQueries(enabledOnly = false): Promise<SearchQueryRow[]> {
    const where = enabledOnly ? "WHERE enabled = 1 " : "";
    const res = await query<SearchQueryRow>(`SELECT * FROM search_queries ${where}ORDER BY id`);
    return res.rows;
}

export async function addSearchQuery(
    query: string,
    country = "IN",
    datePosted = "3days",
    remoteJobsOnly = false,
): Promise<number> {
    const row = await queryOne<{ id: number }>(
        `INSERT INTO search_queries (query, country, date_posted, remote_jobs_only, enabled, created_at)
         VALUES ($1, $2, $3, $4, 1, $5) RETURNING id`,
        [query, country, datePosted, remoteJobsOnly ? 1 : 0, utcNowIso()],
    );
    return row?.id ?? 0;
}

export async function deleteSearchQuery(qid: number): Promise<void> {
    await query("DELETE FROM search_queries WHERE id = $1", [qid]);
}

// ── API usage tracking ────────────────────────────────────────────────

export async function logApiCall(apiName: string, success = true, notes = ""): Promise<void> {
    await query(
        "INSERT INTO api_usage (api_name, called_at, success, notes) VALUES ($1, $2, $3, $4)",
        [apiName, utcNowIso(), success ? 1 : 0, notes],
    );
}

export async function getApiUsage(
    apiName: string,
): Promise<{ month: number; today: number; total: number }> {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1)).toISOString().replace("Z", "");
    const todayStart = new Date(Date.UTC(y, m, now.getUTCDate())).toISOString().replace("Z", "");
    const month = await queryOne<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM api_usage WHERE api_name=$1 AND called_at >= $2",
        [apiName, monthStart],
    );
    const today = await queryOne<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM api_usage WHERE api_name=$1 AND called_at >= $2",
        [apiName, todayStart],
    );
    const total = await queryOne<{ c: number }>(
        "SELECT COUNT(*)::int AS c FROM api_usage WHERE api_name=$1",
        [apiName],
    );
    return { month: month?.c ?? 0, today: today?.c ?? 0, total: total?.c ?? 0 };
}
