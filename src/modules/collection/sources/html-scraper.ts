import * as cheerio from "cheerio";
import { getActiveProfile } from "../../profiles/profiles.service.js";
import { makeJob, type Job } from "../../jobs/jobs.model.js";
import { httpFetch } from "../../../infrastructure/http/client.js";
import type { JobSource } from "./base.js";
import type { AtsCompany } from "./ats-types.js";

/**
 * Fallback HTML career-page scraper for companies without a standard ATS.
 * Uses cheerio to pull job links out of a careers page.
 */
export class HTMLCareerSource implements JobSource {
    readonly name = "html";

    constructor(private readonly company: AtsCompany) { }

    async fetch(): Promise<Job[]> {
        const url = this.company.careers_url;
        if (!url) return [];

        const titleKeywords = (await getActiveProfile()).search.title_keywords_positive ?? [];

        const resp = await httpFetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; JobBot/1.0)" },
            timeoutMs: 30000,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);

        const $ = cheerio.load(resp.text);
        const jobs: Job[] = [];
        const seenUrls = new Set<string>();

        $("a[href]").each((_i, el) => {
            const href = $(el).attr("href");
            if (!href) return;
            const text = $(el).text().trim();
            if (!text || text.length < 5 || text.length > 200) return;
            if (titleKeywords.length && !titleKeywords.some((kw) => text.toLowerCase().includes(kw))) {
                return;
            }

            let fullUrl: string;
            try {
                fullUrl = new URL(href, url).toString();
            } catch {
                return;
            }
            if (seenUrls.has(fullUrl)) return;
            seenUrls.add(fullUrl);

            jobs.push(
                makeJob({
                    title: text,
                    company: this.company.name,
                    location: "Remote",
                    description: "",
                    url: fullUrl,
                    source: `html:${this.company.id}`,
                    company_domain: this.company.domain || "",
                }),
            );
        });

        return jobs;
    }
}
