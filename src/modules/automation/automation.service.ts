import { logger } from "../../config/logger.js";
import { runCollection } from "../collection/collection.service.js";
import { generateOutreachForTopJobs } from "../outreach/outreach.service.js";
import { sendDailyDigest, type DigestResult } from "../email/email.service.js";
import { getActiveProfile } from "../profiles/profiles.service.js";
import { rescoreJobs } from "../jobs/jobs.service.js";
import { utcNowIso } from "../../common/utils/time.js";

export async function collectJobs(generate: boolean) {
    const cutoff = utcNowIso();
    const stats = await runCollection(true);
    if (generate) stats.outreach_generated = await generateOutreachForTopJobs(15, 40, "maybe", cutoff);
    return stats;
}

export async function refreshOutreach(limit: number, minScore: number) {
    const cutoff = utcNowIso();
    const collected = await runCollection(true);
    const generated = await generateOutreachForTopJobs(limit, minScore, "maybe", cutoff);
    return { collected, generated };
}

export async function rescoreAll(deleteBelowMin: boolean) {
    return rescoreJobs(await getActiveProfile(), deleteBelowMin);
}

// Orchestration depends on domain services; those services never import this module.
export interface PipelineResult {
    collection: { new: number };
    outreach_generated: number;
    email: DigestResult | { skipped: boolean };
}

/** Full daily pipeline: collect → generate outreach → send email. */
export async function runDailyPipeline(send = true): Promise<PipelineResult> {
    logger.info("=== Daily Pipeline Start ===");

    logger.info("Step 1: Collecting jobs...");
    const collectStats = await runCollection(true);
    logger.info(`  Fetched: ${collectStats.fetched}, New: ${collectStats.new}`);

    logger.info("Step 2: Generating outreach...");
    const generated = await generateOutreachForTopJobs();
    logger.info(`  Generated ${generated} new outreach items`);

    let emailResult: DigestResult | { skipped: boolean } = { skipped: true };
    if (send) {
        logger.info("Step 3: Sending email...");
        emailResult = await sendDailyDigest();
        logger.info(`  Email: ${JSON.stringify(emailResult)}`);
    }

    logger.info("=== Daily Pipeline Complete ===");
    return {
        collection: { new: collectStats.new },
        outreach_generated: generated,
        email: emailResult,
    };
}
