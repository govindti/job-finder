import { logger } from "../../config/logger.js";
import { getActiveProfile } from "../profiles/profiles.service.js";
import { getJobs } from "../jobs/jobs.service.js";
import { insertOutreach, outreachExistsForJob, setLastOutreachBatchAt } from "./outreach.repository.js";
import type { OutreachRow, OutreachFilters } from "./outreach.types.js";
import * as repository from "./outreach.repository.js";
import { AppError } from "../../common/errors/app-error.js";

export { getOutreachStats, getUnemailedOutreach, markOutreachEmailed, deleteOutreachBulk } from "./outreach.repository.js";
export { getHunterStatus } from "./hunter.adapter.js";
import { buildLinkedinSearches, generateDmTemplate } from "./linkedin.js";
import { md5Hex } from "../../common/utils/hash.js";
import { utcNowIso } from "../../common/utils/time.js";

export async function listOutreach(filters: OutreachFilters) {
    const outreach = await repository.getOutreach(filters);
    return { outreach, count: outreach.length, last_batch_at: await repository.getLastOutreachBatchAt() };
}

export async function updateOutreachStatus(id: string, status: string): Promise<void> {
    if (!(await repository.getOutreachById(id))) throw new AppError("OUTREACH_NOT_FOUND");
    const fields: Record<string, string> = { messaged: "messaged", replied: "replied", followed_up: "followed_up" };
    await repository.updateOutreachStatus(id, status, Object.hasOwn(fields, status) ? fields[status] : undefined);
}

export async function updateOutreachNotes(id: string, notes: string): Promise<void> {
    if (!(await repository.getOutreachById(id))) throw new AppError("OUTREACH_NOT_FOUND");
    await repository.updateOutreachNotes(id, notes);
}

/**
 * Create outreach items for the highest-scoring jobs without one yet.
 * `seenAfter` scopes generation to a specific collection run. Returns the count.
 */
export async function generateOutreachForTopJobs(
    limit = 15,
    minScore = 40,
    indiaFriendly: string | null = "maybe",
    seenAfter: string | null = null,
): Promise<number> {
    const profile = await getActiveProfile();
    const profileId = profile._id;

    const topJobs = await getJobs({
        min_score: minScore,
        india_friendly: indiaFriendly,
        seen_after: seenAfter,
        limit: limit * 5,
    });
    const candidates: typeof topJobs = [];
    for (const job of topJobs) {
        if (candidates.length >= limit) break;
        if (!(await outreachExistsForJob(job.id))) candidates.push(job);
    }

    // All items in this run share one timestamp so batch filtering is exact.
    const batchTs = utcNowIso();
    let generated = 0;

    for (const job of candidates) {
        try {
            const searches = buildLinkedinSearches(job.company, profile);
            const dms = generateDmTemplate(job, null, profile);
            const primaryUrl = searches[0]?.url ?? "";

            const outreachId = md5Hex(`${job.id}|linkedin`);
            const row: OutreachRow = {
                id: outreachId,
                job_id: job.id,
                job_title: job.title,
                company: job.company,
                company_domain: job.company_domain ?? "",
                contact_name: "[Search LinkedIn]",
                contact_position: "Engineering Manager / Tech Lead / Head of Eng",
                contact_linkedin: primaryUrl,
                dm_short: dms.short,
                dm_long: dms.long,
                status: "pending",
                messaged_at: "",
                replied_at: "",
                followed_up_at: "",
                created_at: batchTs,
                notes: JSON.stringify(searches),
                emailed_at: "",
                profile_id: profileId,
            };
            await insertOutreach(row);
            generated += 1;
        } catch (err) {
            logger.warn(`  Skipped ${job.company}: ${String(err)}`);
            continue;
        }
    }

    if (generated > 0) await setLastOutreachBatchAt(batchTs);
    return generated;
}
