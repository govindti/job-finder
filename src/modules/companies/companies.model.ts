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
