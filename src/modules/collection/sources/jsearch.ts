import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { logApiCall } from "../collection.repository.js";
import { makeJob, type Job } from "../../jobs/jobs.model.js";
import { httpFetch } from "../../../infrastructure/http/client.js";
import { jsearchResponseSchema, jsearchItemSchema } from "./external.dto.js";
import { z } from "zod";
import type { JobSource } from "./base.js";

type JsearchItem = z.infer<typeof jsearchItemSchema>;

export interface JSearchParams {
    query: string;
    country?: string;
    date_posted?: string;
    remote_jobs_only?: boolean;
}

/**
 * JSearch via RapidAPI — aggregates LinkedIn/Indeed/Glassdoor/ZipRecruiter/Google
 * Jobs. Each query is logged to `api_usage`.
 */
export class JSearchSource implements JobSource {
    readonly name = "jsearch";
    private static readonly BASE_URL = "https://jsearch.p.rapidapi.com/search";

    constructor(private readonly queries: JSearchParams[] = []) { }

    async fetch(): Promise<Job[]> {
        const apiKey = env.RAPIDAPI_KEY;
        if (!apiKey) return [];
        if (!this.queries.length) return [];

        const headers = {
            "x-rapidapi-host": "jsearch.p.rapidapi.com",
            "x-rapidapi-key": apiKey,
        };

        const allJobs: Job[] = [];
        for (const q of this.queries) {
            try {
                const params: Record<string, string | number | boolean> = {
                    query: q.query,
                    country: q.country ?? "IN",
                    date_posted: q.date_posted ?? "3days",
                    page: 1,
                    num_pages: 1,
                    employment_types: "FULLTIME",
                };
                // Only send remote_jobs_only when true; omit otherwise.
                if (q.remote_jobs_only) params.remote_jobs_only = "true";
                const resp = await httpFetch(JSearchSource.BASE_URL, {
                    headers,
                    query: params,
                    timeoutMs: 60000,
                    retries: 1,
                });
                const success = resp.status === 200;
                await logApiCall("jsearch", success, q.query);
                if (!success) continue;

                const parsed = jsearchResponseSchema.safeParse(JSON.parse(resp.text));
                if (!parsed.success) continue;
                for (const item of parsed.data.data) {
                    const job = this.mapJob(item);
                    if (job) allJobs.push(job);
                }
            } catch (err) {
                await logApiCall("jsearch", false, String(err).slice(0, 100));
                logger.warn({ err, query: q.query }, "jsearch query failed");
                continue;
            }
        }
        return allJobs;
    }

    private mapJob(item: JsearchItem): Job | null {
        const locationParts = [item.job_city, item.job_state, item.job_country].filter((p) => p);
        let location = locationParts.join(", ") || "Remote";
        if (item.job_is_remote) {
            location = !locationParts[0] ? "Remote" : `Remote / ${location}`;
        }

        let salary = "";
        if (item.job_min_salary && item.job_max_salary) {
            const period = (item.job_salary_period ?? "year").toLowerCase();
            salary = `$${item.job_min_salary.toLocaleString("en-US")} - ${item.job_max_salary.toLocaleString(
                "en-US",
            )} / ${period}`;
        }

        const url = item.job_apply_link || item.job_google_link || "";

        let domain = "";
        if (item.employer_website) {
            domain = item.employer_website
                .replace("https://", "")
                .replace("http://", "")
                .replace("www.", "")
                .replace(/\/+$/, "");
        }

        if (!item.job_title || !item.employer_name) return null;

        return makeJob({
            title: item.job_title,
            company: item.employer_name,
            location,
            description: item.job_description.slice(0, 5000),
            url,
            source: "jsearch",
            posted_date: item.job_posted_at_datetime_utc || item.job_posted_at || "",
            company_domain: domain,
            salary,
            job_type: (item.job_employment_type || "FULLTIME").toLowerCase(),
        });
    }
}
