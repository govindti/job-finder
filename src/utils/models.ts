import { md5Hex } from "./hash.js";

// ── Job ──────────────────────────────────

export interface Job {
    title: string;
    company: string;
    location: string;
    description: string;
    url: string;
    source: string;
    posted_date: string;
    discovered_at: string;
    tech_stack: string; // comma-separated
    experience_level: string; // junior/mid/senior
    relevance_score: number;
    status: string; // new/reviewed/applied/stale
    company_domain: string;
    salary: string;
    job_type: string; // full-time/part-time/contract
    india_friendly: string; // yes/no/maybe/unknown
    location_note: string;
}

/** Build a Job, filling in defaults for any omitted field. */
export function makeJob(partial: Partial<Job> & { title: string; company: string }): Job {
    return {
        location: "Remote",
        description: "",
        url: "",
        source: "",
        posted_date: "",
        discovered_at: utcNowIso(),
        tech_stack: "",
        experience_level: "",
        relevance_score: 0,
        status: "new",
        company_domain: "",
        salary: "",
        job_type: "",
        india_friendly: "unknown",
        location_note: "",
        ...partial,
    };
}

/** Dedup fingerprint from company + title + location (lowercased + trimmed). */
export function jobFingerprint(job: Pick<Job, "company" | "title" | "location">): string {
    const raw = `${job.company.toLowerCase().trim()}|${job.title.toLowerCase().trim()}|${job.location
        .toLowerCase()
        .trim()}`;
    return md5Hex(raw);
}

const SKIP_DOMAINS = [
    "remotive.com",
    "remoteok.com",
    "arbeitnow.com",
    "linkedin.com",
    "indeed.com",
    "glassdoor.com",
];

/** Extract company domain from a job URL, skipping job-board hosts. */
export function extractDomain(url: string): string {
    if (!url) return "";
    try {
        const parsed = new URL(url);
        // The URL host (with any port) comes straight from WHATWG URL parsing.
        const domain = parsed.host.replace("www.", "");
        if (SKIP_DOMAINS.some((s) => domain.includes(s))) return "";
        return domain;
    } catch {
        return "";
    }
}

// ── Company ──────────────────────────────

export interface Company {
    id: string;
    name: string;
    domain: string;
    careers_url: string;
    ats_platform: string; // greenhouse/lever/ashby/html/unknown
    ats_slug: string;
    founded_year: number;
    employee_count: string;
    tags: string;
    india_friendly: string;
    last_crawled: string;
    crawl_status: string; // active/paused/failed
    notes: string;
}

/** Slugify a company name into an id: non-alphanumeric runs -> "-", trimmed. */
export function makeCompanyId(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// ── Time helpers ──────────────────────────────────────────────────────

// Timestamps are naive UTC (no trailing Z), e.g. 2026-11-01T12:34:56.789012.
// This shape makes lexicographic comparisons in SQL
// (last_seen < cutoff, created_at >= batch) behave correctly.
export function utcNowIso(): string {
    return new Date().toISOString().replace("Z", "");
}

export function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace("Z", "");
}
