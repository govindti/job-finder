import { param, query, queryOne, type Executor } from "../../infrastructure/database/connection.js";
import { daysAgoIso, utcNowIso } from "../../common/utils/time.js";
import { groupCount } from "../../common/utils/group-count.js";
import type { JobRow, JobInsert, JobFilters, JobStats } from "./jobs.types.js";
import type { ScoreResult } from "./scoring/scorer.js";

export async function getJobsForRescore() {
    return (await query<Pick<JobRow, "id" | "title" | "description" | "location" | "tech_stack">>(
        "SELECT id, title, description, location, tech_stack FROM jobs",
    )).rows;
}

export async function deleteJob(id: string, exec: Executor): Promise<void> {
    await query("DELETE FROM jobs WHERE id = $1", [id], exec);
}

export async function updateJobScore(id: string, score: ScoreResult, tech: string, profileId: number | null, exec: Executor): Promise<void> {
    await query(
        `UPDATE jobs SET relevance_score = $1, experience_level = $2, india_friendly = $3,
         location_note = $4, tech_stack = $5, scored_profile_id = $6 WHERE id = $7`,
        [score.score, score.experience_level, score.india_friendly, score.location_note, tech, profileId, id], exec,
    );
}

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
