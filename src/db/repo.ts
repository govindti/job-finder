import { getDb } from "./connection.js";
import { daysAgoIso, utcNowIso } from "../utils/models.js";

// ── Row types (column names mirror the SQLite tables exactly) ─────────

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

/** Upsert a job. Returns "new" or "updated" (last_seen refreshed). */
export function insertJob(job: JobInsert): "new" | "updated" {
    const d = getDb();
    const now = utcNowIso();
    const existing = d.prepare("SELECT id FROM jobs WHERE id = ?").get(job.id);
    if (existing) {
        d.prepare("UPDATE jobs SET last_seen = ? WHERE id = ?").run(now, job.id);
        return "updated";
    }
    d.prepare(
        `INSERT INTO jobs (id, title, company, location, description, url,
        source, posted_date, discovered_at, tech_stack, experience_level,
        relevance_score, status, company_domain, salary, job_type,
        india_friendly, location_note, last_seen, scored_profile_id)
      VALUES (@id, @title, @company, @location, @description, @url,
        @source, @posted_date, @discovered_at, @tech_stack, @experience_level,
        @relevance_score, @status, @company_domain, @salary, @job_type,
        @india_friendly, @location_note, @last_seen, @scored_profile_id)`,
    ).run({ ...job, last_seen: now, scored_profile_id: job.scored_profile_id ?? null });
    return "new";
}

/** Delete jobs not re-seen within `days`, protecting non-active statuses and marked jobs. */
export function cleanupOldJobs(days = 14): number {
    const d = getDb();
    const cutoff = daysAgoIso(days);
    const info = d
        .prepare(
            `DELETE FROM jobs
        WHERE (last_seen < @cutoff OR last_seen = '' OR last_seen IS NULL)
          AND status IN ('new', 'reviewed', 'stale')
          AND (mark_for_email = 0 OR mark_for_email IS NULL)`,
        )
        .run({ cutoff });
    return info.changes;
}

export function toggleMarkForEmail(jobId: string): boolean {
    const d = getDb();
    const row = d.prepare("SELECT mark_for_email AS m FROM jobs WHERE id = ?").get(jobId) as
        | { m: number | null }
        | undefined;
    const newState = row && row.m ? 0 : 1;
    d.prepare("UPDATE jobs SET mark_for_email = ? WHERE id = ?").run(newState, jobId);
    return newState === 1;
}

export function getMarkedJobs(limit = 50): JobRow[] {
    return getDb()
        .prepare("SELECT * FROM jobs WHERE mark_for_email = 1 ORDER BY relevance_score DESC LIMIT ?")
        .all(limit) as JobRow[];
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

export function getJobs(f: JobFilters = {}): JobRow[] {
    const d = getDb();
    const minScore = f.min_score ?? 0;
    const limit = f.limit ?? 100;
    const offset = f.offset ?? 0;

    let query = "SELECT * FROM jobs WHERE relevance_score >= ?";
    const params: unknown[] = [minScore];

    if (f.source) {
        query += " AND source LIKE ?";
        params.push(`%${f.source}%`);
    }
    if (f.status) {
        query += " AND status = ?";
        params.push(f.status);
    }
    if (f.search) {
        query += " AND (title LIKE ? OR company LIKE ? OR description LIKE ?)";
        const s = `%${f.search}%`;
        params.push(s, s, s);
    }
    if (f.location) {
        query += " AND location LIKE ?";
        params.push(`%${f.location}%`);
    }
    if (f.tech) {
        query += " AND tech_stack LIKE ?";
        params.push(`%${f.tech}%`);
    }
    if (f.india_friendly) {
        if (f.india_friendly === "yes") query += " AND india_friendly = 'yes'";
        else if (f.india_friendly === "no") query += " AND india_friendly = 'no'";
        else if (f.india_friendly === "maybe") query += " AND india_friendly IN ('yes', 'maybe')";
    }
    if (f.company_domain) {
        query += " AND company_domain = ?";
        params.push(f.company_domain);
    }
    if (f.seen_after) {
        query += " AND last_seen >= ?";
        params.push(f.seen_after);
    }

    query += " ORDER BY relevance_score DESC, discovered_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return d.prepare(query).all(...params) as JobRow[];
}

export function getJobById(jobId: string): JobRow | undefined {
    return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
}

export function updateJobStatus(jobId: string, status: string): void {
    getDb().prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, jobId);
}

export interface JobStats {
    total: number;
    by_source: Record<string, number>;
    by_status: Record<string, number>;
    by_india: Record<string, number>;
    avg_score: number;
}

export function getStats(): JobStats {
    const d = getDb();
    const total = (d.prepare("SELECT COUNT(*) AS c FROM jobs").get() as { c: number }).c;
    const bySource = d.prepare("SELECT source, COUNT(*) AS count FROM jobs GROUP BY source").all() as Array<{
        source: string | null;
        count: number;
    }>;
    const byStatus = d.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status").all() as Array<{
        status: string | null;
        count: number;
    }>;
    const byIndia = d
        .prepare("SELECT india_friendly, COUNT(*) AS count FROM jobs GROUP BY india_friendly")
        .all() as Array<{ india_friendly: string | null; count: number }>;
    const avg = (d
        .prepare("SELECT AVG(relevance_score) AS a FROM jobs WHERE relevance_score > 0")
        .get() as { a: number | null }).a;
    return {
        total,
        by_source: groupCount(bySource, "source"),
        by_status: groupCount(byStatus, "status"),
        by_india: groupCount(byIndia, "india_friendly"),
        avg_score: avg ? Math.round(avg * 10) / 10 : 0,
    };
}

export function getSources(): string[] {
    const rows = getDb().prepare("SELECT DISTINCT source FROM jobs ORDER BY source").all() as Array<{
        source: string;
    }>;
    return rows.map((r) => r.source);
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

export function upsertCompany(c: CompanyInsert): boolean {
    try {
        getDb()
            .prepare(
                `INSERT OR REPLACE INTO companies
            (id, name, domain, careers_url, ats_platform, ats_slug,
             founded_year, employee_count, tags, india_friendly,
             last_crawled, crawl_status, notes)
          VALUES (@id, @name, @domain, @careers_url, @ats_platform, @ats_slug,
             @founded_year, @employee_count, @tags, @india_friendly,
             @last_crawled, @crawl_status, @notes)`,
            )
            .run(c);
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

export function getCompanies(f: CompanyFilters = {}): CompanyRow[] {
    const d = getDb();
    let query = "SELECT * FROM companies WHERE 1=1";
    const params: unknown[] = [];
    if (f.ats_platform) {
        query += " AND ats_platform = ?";
        params.push(f.ats_platform);
    }
    if (f.crawl_status) {
        query += " AND crawl_status = ?";
        params.push(f.crawl_status);
    }
    if (f.india_friendly) {
        query += " AND india_friendly = ?";
        params.push(f.india_friendly);
    }
    if (f.search) {
        query += " AND (name LIKE ? OR domain LIKE ? OR tags LIKE ?)";
        const s = `%${f.search}%`;
        params.push(s, s, s);
    }
    query += " ORDER BY name ASC LIMIT ? OFFSET ?";
    params.push(f.limit ?? 200, f.offset ?? 0);
    return d.prepare(query).all(...params) as CompanyRow[];
}

export function getCompanyById(companyId: string): CompanyRow | undefined {
    return getDb().prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as
        | CompanyRow
        | undefined;
}

export function updateCompanyCrawlStatus(companyId: string, status: string, lastCrawled = ""): void {
    const d = getDb();
    if (lastCrawled) {
        d.prepare("UPDATE companies SET crawl_status = ?, last_crawled = ? WHERE id = ?").run(
            status,
            lastCrawled,
            companyId,
        );
    } else {
        d.prepare("UPDATE companies SET crawl_status = ? WHERE id = ?").run(status, companyId);
    }
}

export interface CompanyStats {
    total: number;
    by_platform: Record<string, number>;
    by_status: Record<string, number>;
    by_india: Record<string, number>;
}

export function getCompanyStats(): CompanyStats {
    const d = getDb();
    const total = (d.prepare("SELECT COUNT(*) AS c FROM companies").get() as { c: number }).c;
    const byPlatform = d
        .prepare("SELECT ats_platform, COUNT(*) AS count FROM companies GROUP BY ats_platform")
        .all() as Array<{ ats_platform: string | null; count: number }>;
    const byStatus = d
        .prepare("SELECT crawl_status, COUNT(*) AS count FROM companies GROUP BY crawl_status")
        .all() as Array<{ crawl_status: string | null; count: number }>;
    const byIndia = d
        .prepare("SELECT india_friendly, COUNT(*) AS count FROM companies GROUP BY india_friendly")
        .all() as Array<{ india_friendly: string | null; count: number }>;
    return {
        total,
        by_platform: groupCount(byPlatform, "ats_platform"),
        by_status: groupCount(byStatus, "crawl_status"),
        by_india: groupCount(byIndia, "india_friendly"),
    };
}

// ── Outreach CRUD ─────────────────────────────────────────────────────

export function insertOutreach(item: OutreachRow): boolean {
    try {
        getDb()
            .prepare(
                `INSERT OR REPLACE INTO outreach
            (id, job_id, job_title, company, company_domain, contact_name,
             contact_position, contact_linkedin, dm_short, dm_long, status,
             messaged_at, replied_at, followed_up_at, created_at, notes, profile_id)
          VALUES (@id, @job_id, @job_title, @company, @company_domain, @contact_name,
             @contact_position, @contact_linkedin, @dm_short, @dm_long, @status,
             @messaged_at, @replied_at, @followed_up_at, @created_at, @notes, @profile_id)`,
            )
            .run(item);
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

export function getOutreach(f: OutreachFilters = {}): OutreachJoined[] {
    const d = getDb();
    let query = `
    SELECT o.*, j.url as job_url, j.relevance_score, j.tech_stack,
           j.location, j.salary, j.india_friendly
    FROM outreach o
    LEFT JOIN jobs j ON j.id = o.job_id
    WHERE 1=1`;
    const params: unknown[] = [];
    if (f.status) {
        query += " AND o.status = ?";
        params.push(f.status);
    }
    if (f.search) {
        query += " AND (o.company LIKE ? OR o.job_title LIKE ? OR o.contact_name LIKE ?)";
        const s = `%${f.search}%`;
        params.push(s, s, s);
    }
    if (f.batch === "new" || f.batch === "old") {
        const batchAt = getLastOutreachBatchAt();
        if (batchAt) {
            const op = f.batch === "new" ? ">=" : "<";
            query += ` AND o.created_at ${op} ?`;
            params.push(batchAt);
        } else if (f.batch === "new") {
            query += " AND 0";
        }
    }
    query += " ORDER BY o.created_at DESC, j.relevance_score DESC LIMIT ? OFFSET ?";
    params.push(f.limit ?? 100, f.offset ?? 0);
    return d.prepare(query).all(...params) as OutreachJoined[];
}

export function deleteOutreachBulk(ids: string[]): number {
    if (!ids.length) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const info = getDb()
        .prepare(`DELETE FROM outreach WHERE id IN (${placeholders})`)
        .run(...ids);
    return info.changes;
}

export function deleteAllOutreach(): number {
    return getDb().prepare("DELETE FROM outreach").run().changes;
}

export function setLastOutreachBatchAt(ts: string): void {
    getDb()
        .prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_outreach_batch_at', ?, ?)",
        )
        .run(ts, ts);
}

export function getLastOutreachBatchAt(): string | null {
    const row = getDb()
        .prepare("SELECT value FROM app_settings WHERE key = 'last_outreach_batch_at'")
        .get() as { value: string } | undefined;
    return row ? row.value : null;
}

export function updateOutreachStatus(outreachId: string, status: string, field?: string): void {
    const d = getDb();
    const ts = utcNowIso();
    if (field === "messaged") {
        d.prepare("UPDATE outreach SET status=?, messaged_at=? WHERE id=?").run(status, ts, outreachId);
    } else if (field === "replied") {
        d.prepare("UPDATE outreach SET status=?, replied_at=? WHERE id=?").run(status, ts, outreachId);
    } else if (field === "followed_up") {
        d.prepare("UPDATE outreach SET status=?, followed_up_at=? WHERE id=?").run(status, ts, outreachId);
    } else {
        d.prepare("UPDATE outreach SET status=? WHERE id=?").run(status, outreachId);
    }
}

export function updateOutreachNotes(outreachId: string, notes: string): void {
    getDb().prepare("UPDATE outreach SET notes = ? WHERE id = ?").run(notes, outreachId);
}

export function outreachExistsForJob(jobId: string): boolean {
    return !!getDb().prepare("SELECT id FROM outreach WHERE job_id = ? LIMIT 1").get(jobId);
}

export function getOutreachStats(): { total: number; by_status: Record<string, number> } {
    const d = getDb();
    const total = (d.prepare("SELECT COUNT(*) AS c FROM outreach").get() as { c: number }).c;
    const byStatus = d.prepare("SELECT status, COUNT(*) AS count FROM outreach GROUP BY status").all() as Array<{
        status: string | null;
        count: number;
    }>;
    return { total, by_status: groupCount(byStatus, "status") };
}

export function getUnemailedOutreach(limit = 15, onlyMarked = false): OutreachUnemailed[] {
    const d = getDb();
    let where = "(o.emailed_at = '' OR o.emailed_at IS NULL) AND o.status = 'pending'";
    if (onlyMarked) where += " AND j.mark_for_email = 1";
    return d
        .prepare(
            `SELECT o.*, j.relevance_score, j.url AS job_url, j.description AS job_description,
              j.tech_stack, j.salary, j.location, j.posted_date, j.india_friendly,
              j.mark_for_email
        FROM outreach o
        LEFT JOIN jobs j ON j.id = o.job_id
        WHERE ${where}
        ORDER BY j.mark_for_email DESC, j.relevance_score DESC, o.created_at DESC
        LIMIT ?`,
        )
        .all(limit) as OutreachUnemailed[];
}

export function markOutreachEmailed(outreachIds: string[]): void {
    const d = getDb();
    const ts = utcNowIso();
    const stmt = d.prepare(
        `UPDATE outreach SET emailed_at = ?,
        status = CASE WHEN status = 'pending' THEN 'emailed' ELSE status END
      WHERE id = ?`,
    );
    const tx = d.transaction((ids: string[]) => {
        for (const oid of ids) stmt.run(ts, oid);
    });
    tx(outreachIds);
}

export function logEmail(
    recipient: string,
    subject: string,
    itemsCount: number,
    outreachIds: string[],
    status = "sent",
    error = "",
): void {
    getDb()
        .prepare(
            `INSERT INTO email_log (sent_at, recipient, subject, items_count, outreach_ids, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(utcNowIso(), recipient, subject, itemsCount, outreachIds.join(","), status, error);
}

export function getEmailLogs(limit = 30): EmailLogRow[] {
    return getDb()
        .prepare("SELECT * FROM email_log ORDER BY sent_at DESC LIMIT ?")
        .all(limit) as EmailLogRow[];
}

// ── Search queries (legacy table) ─────────────────────────────────────

export function getSearchQueries(enabledOnly = false): SearchQueryRow[] {
    const d = getDb();
    if (enabledOnly) {
        return d.prepare("SELECT * FROM search_queries WHERE enabled = 1 ORDER BY id").all() as SearchQueryRow[];
    }
    return d.prepare("SELECT * FROM search_queries ORDER BY id").all() as SearchQueryRow[];
}

export function addSearchQuery(
    query: string,
    country = "IN",
    datePosted = "3days",
    remoteJobsOnly = false,
): number {
    const info = getDb()
        .prepare(
            "INSERT INTO search_queries (query, country, date_posted, remote_jobs_only, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
        )
        .run(query, country, datePosted, remoteJobsOnly ? 1 : 0, utcNowIso());
    return Number(info.lastInsertRowid);
}

export function deleteSearchQuery(qid: number): void {
    getDb().prepare("DELETE FROM search_queries WHERE id = ?").run(qid);
}

// ── API usage tracking ────────────────────────────────────────────────

export function logApiCall(apiName: string, success = true, notes = ""): void {
    getDb()
        .prepare("INSERT INTO api_usage (api_name, called_at, success, notes) VALUES (?, ?, ?, ?)")
        .run(apiName, utcNowIso(), success ? 1 : 0, notes);
}

export function getApiUsage(apiName: string): { month: number; today: number; total: number } {
    const d = getDb();
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1)).toISOString().replace("Z", "");
    const todayStart = new Date(Date.UTC(y, m, now.getUTCDate())).toISOString().replace("Z", "");
    const month = (d
        .prepare("SELECT COUNT(*) AS c FROM api_usage WHERE api_name=? AND called_at >= ?")
        .get(apiName, monthStart) as { c: number }).c;
    const today = (d
        .prepare("SELECT COUNT(*) AS c FROM api_usage WHERE api_name=? AND called_at >= ?")
        .get(apiName, todayStart) as { c: number }).c;
    const total = (d
        .prepare("SELECT COUNT(*) AS c FROM api_usage WHERE api_name=?")
        .get(apiName) as { c: number }).c;
    return { month, today, total };
}
