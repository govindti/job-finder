import { makeJob, type Job } from "../utils/models.js";
import { httpJson } from "../utils/http.js";
import { greenhouseResponseSchema } from "../schemas/external.js";
import type { JobSource } from "./base.js";
import type { AtsCompany } from "./ats-types.js";

/** Greenhouse ATS public board API. */
export class GreenhouseSource implements JobSource {
    readonly name = "greenhouse";

    constructor(private readonly company: AtsCompany) { }

    async fetch(): Promise<Job[]> {
        const slug = this.company.ats_slug;
        const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
        const data = await httpJson(url, { query: { content: "true" }, timeoutMs: 20000 });
        const parsed = greenhouseResponseSchema.safeParse(data);
        if (!parsed.success) return [];

        const jobs: Job[] = [];
        for (const item of parsed.data.jobs) {
            const locRaw = item.location;
            const location =
                typeof locRaw === "string" ? locRaw : locRaw.name || "";
            jobs.push(
                makeJob({
                    title: item.title,
                    company: this.company.name,
                    location: location || "Remote",
                    description: item.content,
                    url: item.absolute_url,
                    source: `greenhouse:${slug}`,
                    posted_date: item.updated_at,
                    company_domain: this.company.domain || "",
                }),
            );
        }
        return jobs;
    }
}
