import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { getActiveProfile } from "../profiles/profiles.service.js";
import { cleanupOldJobs, scoreAndStore } from "../jobs/jobs.service.js";
import { getCompanies, getCompanyById, updateCompanyCrawlStatus } from "../companies/companies.service.js";
import { getApiUsage } from "./collection.repository.js";
import type { CompanyRow } from "../companies/companies.types.js";
import type { Job } from "../jobs/jobs.model.js";
import { utcNowIso } from "../../common/utils/time.js";
import type { CollectionStats } from "./collection.types.js";
import { ArbeitnowSource, AshbySource, GreenhouseSource, HTMLCareerSource, JSearchSource, LeverSource, RemoteOKSource, RemotiveSource, type AtsCompany, type JobSource, type JSearchParams } from "./sources/index.js";

// Two tracks feed one score-and-store pipeline:
//   Track A — public job boards (parallel)
//   Track B — per-company ATS crawls (bounded concurrency = 5)

export async function getJSearchStatus() {
    const usage = await getApiUsage("jsearch");
    const monthlyLimit = 200;
    return { configured: Boolean(env.RAPIDAPI_KEY), ...usage, monthly_limit: monthlyLimit, remaining: Math.max(0, monthlyLimit - usage.month) };
}

const STALE_JOB_DAYS = 14;

const COMPANY_CRAWL_CONCURRENCY = 5;

function newStats(): CollectionStats {
    return { fetched: 0, new: 0, updated: 0, filtered_out: 0, sources: {} };
}

/** Build Track A sources fresh each run so JSearch uses the current profile queries. */
async function buildJobBoardSources(): Promise<JobSource[]> {
    const sources: JobSource[] = [new RemotiveSource(), new RemoteOKSource(), new ArbeitnowSource()];

    if (env.RAPIDAPI_KEY) {
        const profile = await getActiveProfile();
        const profileQueries = profile.search.jsearch_default_queries ?? [];
        const queries: JSearchParams[] = profileQueries
            .filter((q) => q.query && (q.enabled ?? true))
            .map((q) => ({
                query: q.query,
                country: q.country ?? "IN",
                date_posted: q.date_posted ?? "3days",
                remote_jobs_only: Boolean(q.remote_jobs_only),
            }));
        if (queries.length) sources.push(new JSearchSource(queries));
    }
    return sources;
}

/** Factory: the right ATS source class for a company, or null for unknown platforms. */
function makeAtsSource(company: CompanyRow): JobSource | null {
    const ref: AtsCompany = {
        id: company.id,
        name: company.name,
        domain: company.domain ?? "",
        careers_url: company.careers_url ?? "",
        ats_slug: company.ats_slug ?? "",
    };
    switch (company.ats_platform) {
        case "greenhouse":
            return new GreenhouseSource(ref);
        case "lever":
            return new LeverSource(ref);
        case "ashby":
            return new AshbySource(ref);
        case "html":
            return new HTMLCareerSource(ref);
        default:
            return null;
    }
}

/** Run async `fn` over `items` with at most `limit` in flight at a time. */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    async function worker(): Promise<void> {
        while (cursor < items.length) {
            const idx = cursor++;
            results[idx] = await fn(items[idx] as T);
        }
    }
    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

async function fetchFromSource(source: JobSource): Promise<Job[]> {
    try {
        const jobs = await source.fetch();
        logger.info(`  [OK] ${source.name}: ${jobs.length} jobs fetched`);
        return jobs;
    } catch (err) {
        logger.warn(`  [FAIL] ${source.name}: ${String(err)}`);
        return [];
    }
}

/** Track A: fetch + score/store from the public job boards. */
export async function runJobBoards(): Promise<CollectionStats> {
    const stats = newStats();
    const sources = await buildJobBoardSources();
    const results = await Promise.all(sources.map((s) => fetchFromSource(s)));

    const allJobs: Job[] = [];
    sources.forEach((source, i) => {
        const jobs = results[i] ?? [];
        stats.sources[source.name] = jobs.length;
        allJobs.push(...jobs);
    });

    stats.fetched = allJobs.length;
    await scoreAndStore(allJobs, stats, await getActiveProfile());
    return stats;
}

/** Track B: crawl jobs from active companies in the DB. */
export async function runCompanyCrawl(companyIds?: string[]): Promise<CollectionStats> {
    const stats: CollectionStats = { ...newStats(), companies_crawled: 0, companies_failed: 0 };
    logger.info("Starting company crawl...");

    if (companyIds) for (const id of companyIds) await getCompanyById(id);
    let companies = await getCompanies({ crawl_status: "active" });
    if (companyIds) companies = companies.filter((c) => companyIds.includes(c.id));

    if (!companies.length) {
        logger.info("  No active companies to crawl. Seed first with /api/companies/seed");
        return stats;
    }

    logger.info(`  Crawling ${companies.length} companies...`);

    const results = await mapWithConcurrency(companies, COMPANY_CRAWL_CONCURRENCY, async (company) => {
        const source = makeAtsSource(company);
        if (!source) return [] as Job[];
        try {
            const jobs = await source.fetch();
            await updateCompanyCrawlStatus(company.id, "active", utcNowIso());
            logger.info(`  [OK] ${company.name} (${company.ats_platform}): ${jobs.length} jobs`);
            stats.companies_crawled = (stats.companies_crawled ?? 0) + 1;
            stats.sources[`${company.ats_platform}:${company.ats_slug}`] = jobs.length;
            return jobs;
        } catch (err) {
            await updateCompanyCrawlStatus(company.id, "failed", utcNowIso());
            logger.warn(`  [FAIL] ${company.name}: ${String(err)}`);
            stats.companies_failed = (stats.companies_failed ?? 0) + 1;
            return [] as Job[];
        }
    });

    const allJobs = results.flat();
    stats.fetched = allJobs.length;
    logger.info(`  Total from companies: ${allJobs.length}`);
    await scoreAndStore(allJobs, stats, await getActiveProfile());
    return stats;
}

/** Full collection: job boards + company crawl + stale cleanup. */
export async function runCollection(includeCompanies = true): Promise<CollectionStats> {
    logger.info("=".repeat(50));
    logger.info("Starting full collection...");

    logger.info("--- Job Boards ---");
    const boardStats = await runJobBoards();

    let companyStats: CollectionStats = {
        ...newStats(),
        companies_crawled: 0,
        companies_failed: 0,
    };
    if (includeCompanies) {
        logger.info("--- Company Crawl ---");
        companyStats = await runCompanyCrawl();
    }

    logger.info(`--- Cleanup (jobs older than ${STALE_JOB_DAYS} days) ---`);
    const deleted = await cleanupOldJobs(STALE_JOB_DAYS);
    logger.info(`  Deleted ${deleted} stale jobs`);

    const total: CollectionStats = {
        fetched: boardStats.fetched + companyStats.fetched,
        new: boardStats.new + companyStats.new,
        updated: boardStats.updated + companyStats.updated,
        filtered_out: boardStats.filtered_out + companyStats.filtered_out,
        deleted_stale: deleted,
        board_sources: boardStats.sources,
        companies_crawled: companyStats.companies_crawled ?? 0,
        companies_failed: companyStats.companies_failed ?? 0,
        sources: { ...boardStats.sources, ...companyStats.sources },
    };

    logger.info("--- Summary ---");
    logger.info(`  Total fetched: ${total.fetched}`);
    logger.info(`  New: ${total.new} | Updated (already existed): ${total.updated}`);
    logger.info(`  Filtered out (low score): ${total.filtered_out}`);
    logger.info(`  Deleted (stale): ${total.deleted_stale}`);
    logger.info("Collection complete!");
    logger.info("=".repeat(50));
    return total;
}
