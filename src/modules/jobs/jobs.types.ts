// ── Row types (column names mirror the PostgreSQL tables exactly) ──────

export interface JobRow {
    id: string;
    title: string;
    company: string;
    location: string | null;
    description: string | null;
    url: string | null;
    source: string | null;
    posted_date: string | null;
    discovered_at: string;
    tech_stack: string | null;
    experience_level: string | null;
    relevance_score: number | null;
    status: string | null;
    company_domain: string | null;
    salary: string | null;
    job_type: string | null;
    india_friendly: string | null;
    location_note: string | null;
    last_seen: string | null;
    mark_for_email: number | null;
    scored_profile_id: number | null;
}

// ── Jobs CRUD ─────────────────────────────────────────────────────────

export type JobInsert = Pick<
    JobRow,
    | "id"
    | "title"
    | "company"
    | "location"
    | "description"
    | "url"
    | "source"
    | "posted_date"
    | "discovered_at"
    | "tech_stack"
    | "experience_level"
    | "relevance_score"
    | "status"
    | "company_domain"
    | "salary"
    | "job_type"
    | "india_friendly"
    | "location_note"
> & {
    scored_profile_id?: number | null;
};

export interface JobFilters {
    source?: string | null;
    status?: string | null;
    min_score?: number;
    search?: string | null;
    location?: string | null;
    tech?: string | null;
    india_friendly?: string | null;
    company_domain?: string | null;
    seen_after?: string | null;
    limit?: number;
    offset?: number;
}

export interface JobStats {
    total: number;
    by_source: Record<string, number>;
    by_status: Record<string, number>;
    by_india: Record<string, number>;
    avg_score: number;
}
