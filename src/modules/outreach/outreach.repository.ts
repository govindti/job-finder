import { param, query, queryOne } from "../../infrastructure/database/connection.js";
import { utcNowIso } from "../../common/utils/time.js";
import { groupCount } from "../../common/utils/group-count.js";
import type { OutreachRow, OutreachJoined, OutreachUnemailed, OutreachFilters } from "./outreach.types.js";

// ── Outreach CRUD ─────────────────────────────────────────────────────

export function getOutreachById(id: string): Promise<OutreachRow | undefined> {
    return queryOne<OutreachRow>("SELECT * FROM outreach WHERE id = $1", [id]);
}

export async function insertOutreach(item: OutreachRow): Promise<boolean> {
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
