import { withTransaction } from "../../infrastructure/database/connection.js";
import { insertJob } from "./jobs.repository.js";
import * as repository from "./jobs.repository.js";
import { AppError } from "../../common/errors/app-error.js";

export { getJobs, getMarkedJobs, getSources, getStats, cleanupOldJobs } from "./jobs.repository.js";
import { scoreJob } from "./scoring/scorer.js";
import { extractDomain, jobFingerprint, type Job } from "./jobs.model.js";
import { utcNowIso } from "../../common/utils/time.js";
import type { ActiveProfile } from "../profiles/profiles.types.js";

interface JobBatchStats { new: number; updated: number; filtered_out: number }

export async function getJobById(id: string) {
    const job = await repository.getJobById(id);
    if (!job) throw new AppError("JOB_NOT_FOUND");
    return job;
}

export async function updateJobStatus(id: string, status: string): Promise<void> {
    await getJobById(id);
    await repository.updateJobStatus(id, status);
}

export async function toggleMarkForEmail(id: string): Promise<boolean> {
    await getJobById(id);
    return repository.toggleMarkForEmail(id);
}

export async function rescoreJobs(profile: ActiveProfile, deleteBelowMin: boolean) {
    const rows = await repository.getJobsForRescore();
    const minStore = Math.trunc(profile.scoring.min_score_to_store ?? 25);
    let updated = 0;
    let deleted = 0;
    await withTransaction(async (client) => {
        for (const row of rows) {
            const result = scoreJob(row.title, row.description || "", row.location || "", profile);
            if (deleteBelowMin && result.score < minStore) {
                await repository.deleteJob(row.id, client);
                deleted += 1;
                continue;
            }
            const tech = new Set((row.tech_stack || "").split(",").map(t => t.trim()).filter(Boolean));
            for (const value of result.tech_stack) tech.add(value);
            await repository.updateJobScore(row.id, result, [...tech].sort().join(", "), profile._id, client);
            updated += 1;
        }
    });
    return { ok: true, scanned: rows.length, updated, deleted };
}

/** Score, filter, dedupe and store; shared by both tracks. Mirrors _score_and_store. */
export async function scoreAndStore(
    jobs: Job[],
    stats: JobBatchStats,
    profile: ActiveProfile,
): Promise<void> {
    const profileId = profile._id;
    const minStore = Math.trunc(profile.scoring.min_score_to_store ?? 25);

    // One transaction per batch: a remote database round-trips per insert, so
    // batching on a single connection keeps collection fast and atomic.
    await withTransaction(async (client) => {
        for (const job of jobs) {
            const result = scoreJob(job.title, job.description, job.location, profile);

            if (result.score < minStore) {
                stats.filtered_out += 1;
                continue;
            }

            job.relevance_score = result.score;
            job.experience_level = result.experience_level;
            job.india_friendly = result.india_friendly;
            job.location_note = result.location_note;

            const techSet = new Set(
                job.tech_stack
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
            );
            for (const t of result.tech_stack) techSet.add(t);
            job.tech_stack = [...techSet].sort().join(", ");

            if (!job.company_domain) {
                job.company_domain = extractDomain(job.url);
            }

            const status = await insertJob(
                {
                    id: jobFingerprint(job),
                    title: job.title,
                    company: job.company,
                    location: job.location,
                    description: job.description,
                    url: job.url,
                    source: job.source,
                    posted_date: job.posted_date,
                    discovered_at: utcNowIso(),
                    tech_stack: job.tech_stack,
                    experience_level: job.experience_level,
                    relevance_score: job.relevance_score,
                    status: job.status,
                    company_domain: job.company_domain,
                    salary: job.salary,
                    job_type: job.job_type,
                    india_friendly: job.india_friendly,
                    location_note: job.location_note,
                    scored_profile_id: profileId,
                },
                client,
            );

            if (status === "new") stats.new += 1;
            else stats.updated += 1;
        }
    });
}
