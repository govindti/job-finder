import { logger } from "../config/logger.js";
import { makeJob, type Job } from "../utils/models.js";
import { httpFetch } from "../utils/http.js";
import { ashbyResponseSchema } from "../schemas/external.js";
import type { JobSource } from "./base.js";
import type { AtsCompany } from "./ats-types.js";

/** Ashby ATS posting-api job board. */
export class AshbySource implements JobSource {
    readonly name = "ashby";

    constructor(private readonly company: AtsCompany) { }

    async fetch(): Promise<Job[]> {
        const slug = this.company.ats_slug;
        const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
        const resp = await httpFetch(url, {
            query: { includeCompensation: "true" },
            timeoutMs: 20000,
        });
        if (!resp.ok) return [];

        let body: unknown;
        try {
            body = JSON.parse(resp.text);
        } catch {
            logger.warn({ slug }, "ashby: non-JSON response");
            return [];
        }
        const parsed = ashbyResponseSchema.safeParse(body);
        if (!parsed.success) return [];

        const jobs: Job[] = [];
        for (const item of parsed.data.jobs) {
            const locRaw = item.location;
            const location = typeof locRaw === "string" ? locRaw : locRaw.name || "";

            let salary = "";
            if (item.compensation && item.compensation.summaryComponents.length) {
                salary = item.compensation.summaryComponents.join(" ");
            }

            jobs.push(
                makeJob({
                    title: item.title,
                    company: this.company.name,
                    location: location || "Remote",
                    description: item.descriptionHtml || item.descriptionPlain,
                    url: item.externalLink || item.jobUrl,
                    source: `ashby:${slug}`,
                    posted_date: item.publishedDate,
                    salary,
                    company_domain: this.company.domain || "",
                }),
            );
        }
        return jobs;
    }
}
