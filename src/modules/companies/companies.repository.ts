import { param, query, queryOne } from "../../infrastructure/database/connection.js";
import { groupCount } from "../../common/utils/group-count.js";
import type { CompanyRow, CompanyInsert, CompanyFilters, CompanyStats } from "./companies.types.js";

export async function upsertCompany(c: CompanyInsert): Promise<boolean> {
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
