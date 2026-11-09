import { logger } from "../config/logger.js";
import { makeJob, type Job } from "../utils/models.js";
import { httpJson } from "../utils/http.js";
import { remotiveResponseSchema } from "../schemas/external.js";
import type { JobSource } from "./base.js";

/** Remotive.com — free public API, no key. */
export class RemotiveSource implements JobSource {
    readonly name = "remotive";
    private static readonly BASE_URL = "https://remotive.com/api/remote-jobs";

    async fetch(): Promise<Job[]> {
        const data = await httpJson(RemotiveSource.BASE_URL, {
            query: { category: "software-dev", limit: 100 },
            timeoutMs: 30000,
        });
        const parsed = remotiveResponseSchema.safeParse(data);
        if (!parsed.success) {
            logger.warn("remotive response failed schema validation");
            return [];
        }

        return parsed.data.jobs.map((item) =>
            makeJob({
                title: item.title,
                company: item.company_name,
                location: item.candidate_required_location || "Anywhere",
                description: item.description,
                url: item.url,
                source: this.name,
                posted_date: item.publication_date,
                salary: item.salary || "",
                job_type: item.job_type,
            }),
        );
    }
}
