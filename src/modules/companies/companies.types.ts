export interface CompanyRow {
    id: string;
    name: string;
    domain: string | null;
    careers_url: string | null;
    ats_platform: string | null;
    ats_slug: string | null;
    founded_year: number | null;
    employee_count: string | null;
    tags: string | null;
    india_friendly: string | null;
    last_crawled: string | null;
    crawl_status: string | null;
    notes: string | null;
}

// ── Companies CRUD ────────────────────────────────────────────────────

export type CompanyInsert = CompanyRow;

export interface CompanyFilters {
    ats_platform?: string | null;
    crawl_status?: string | null;
    india_friendly?: string | null;
    search?: string | null;
    limit?: number;
    offset?: number;
}

export interface CompanyStats {
    total: number;
    by_platform: Record<string, number>;
    by_status: Record<string, number>;
    by_india: Record<string, number>;
}
