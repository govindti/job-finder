import { logger } from "../config/logger.js";
import { makeJob, type Job } from "../utils/models.js";
import { httpJson } from "../utils/http.js";
import { arbeitnowResponseSchema } from "../schemas/external.js";
import type { JobSource } from "./base.js";

/** Arbeitnow — free public API. */
export class ArbeitnowSource implements JobSource {
    readonly name = "arbeitnow";
    private static readonly BASE_URL = "https://www.arbeitnow.com/api/job-board-api";

    async fetch(): Promise<Job[]> {
        const data = await httpJson(ArbeitnowSource.BASE_URL, { timeoutMs: 30000 });
        const parsed = arbeitnowResponseSchema.safeParse(data);
        if (!parsed.success) {
            logger.warn("arbeitnow response failed schema validation");
            return [];
        }

        return parsed.data.data.map((item) => {
            const tags = item.tags.join(", ");
            // Unix seconds -> naive UTC ISO (matches datetime.utcfromtimestamp().isoformat()).
            let posted: string;
            if (typeof item.created_at === "number") {
                posted = new Date(item.created_at * 1000).toISOString().replace("Z", "");
            } else {
                posted = String(item.created_at);
            }

            return makeJob({
                title: item.title,
                company: item.company_name,
                location: item.location || "Remote",
                description: item.description,
                url: item.url,
                source: this.name,
                posted_date: posted,
                job_type: item.remote ? "full-time" : "on-site",
                tech_stack: tags,
            });
        });
    }
}
