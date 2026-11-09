import { makeJob, type Job } from "../utils/models.js";
import { httpJson } from "../utils/http.js";
import { leverResponseSchema } from "../schemas/external.js";
import type { JobSource } from "./base.js";
import type { AtsCompany } from "./ats-types.js";

/** Lever ATS postings API. */
export class LeverSource implements JobSource {
    readonly name = "lever";

    constructor(private readonly company: AtsCompany) { }

    async fetch(): Promise<Job[]> {
        const slug = this.company.ats_slug;
        const url = `https://api.lever.co/v0/postings/${slug}`;
        const data = await httpJson(url, { query: { mode: "json" }, timeoutMs: 20000 });
        const items = leverResponseSchema.parse(data);

        const jobs: Job[] = [];
        for (const item of items) {
            let posted = "";
            if (item.createdAt) {
                // createdAt is a ms epoch -> naive UTC ISO.
                posted = new Date(item.createdAt).toISOString().replace("Z", "");
            }
            const location = item.categories?.location || "";
            jobs.push(
                makeJob({
                    title: item.text,
                    company: this.company.name,
                    location: location || "Remote",
                    description: item.descriptionPlain || item.description,
                    url: item.hostedUrl,
                    source: `lever:${slug}`,
                    posted_date: posted,
                    company_domain: this.company.domain || "",
                }),
            );
        }
        return jobs;
    }
}
