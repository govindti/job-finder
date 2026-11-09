import { z } from "zod";
import { logger } from "../config/logger.js";
import { makeJob, type Job } from "../utils/models.js";
import { httpFetch } from "../utils/http.js";
import { remoteokItemSchema } from "../schemas/external.js";
import type { JobSource } from "./base.js";

type RemoteokItem = z.infer<typeof remoteokItemSchema>;

/** RemoteOK — free public API. */
export class RemoteOKSource implements JobSource {
    readonly name = "remoteok";
    private static readonly BASE_URL = "https://remoteok.com/api";

    async fetch(): Promise<Job[]> {
        const resp = await httpFetch(RemoteOKSource.BASE_URL, {
            headers: { "User-Agent": "JobScraper/1.0" },
            timeoutMs: 30000,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for remoteok`);

        const raw = JSON.parse(resp.text) as unknown[];
        // First element is metadata, not a job.
        const items = raw.slice(1);

        const jobs: Job[] = [];
        for (const candidate of items) {
            const parsed = remoteokItemSchema.safeParse(candidate);
            if (!parsed.success) continue;
            const item = parsed.data;
            const tags = item.tags.join(", ");

            jobs.push(
                makeJob({
                    title: item.position,
                    company: item.company,
                    location: item.location || "Remote",
                    description: item.description,
                    url: item.url || `https://remoteok.com/l/${item.id}`,
                    source: this.name,
                    posted_date: item.date,
                    salary: this.parseSalary(item),
                    job_type: "full-time",
                    tech_stack: tags,
                }),
            );
        }
        if (jobs.length === 0 && items.length > 0) {
            logger.warn("remoteok: no items passed schema validation");
        }
        return jobs;
    }

    private parseSalary(item: RemoteokItem): string {
        const min = item.salary_min;
        const max = item.salary_max;
        if (min && max) return `$${min.toLocaleString("en-US")} - ${max.toLocaleString("en-US")}`;
        if (min) return `$${min.toLocaleString("en-US")}+`;
        return "";
    }
}
