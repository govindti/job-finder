export interface OutreachRow {
    id: string;
    job_id: string;
    job_title: string | null;
    company: string | null;
    company_domain: string | null;
    contact_name: string | null;
    contact_position: string | null;
    contact_linkedin: string | null;
    dm_short: string | null;
    dm_long: string | null;
    status: string | null;
    messaged_at: string | null;
    replied_at: string | null;
    followed_up_at: string | null;
    created_at: string;
    notes: string | null;
    emailed_at: string | null;
    profile_id: number | null;
}

// Outreach rows returned with joined job fields.
export type OutreachJoined = OutreachRow & {
    job_url: string | null;
    relevance_score: number | null;
    tech_stack: string | null;
    location: string | null;
    salary: string | null;
    india_friendly: string | null;
};

export type OutreachUnemailed = OutreachRow & {
    relevance_score: number | null;
    job_url: string | null;
    job_description: string | null;
    tech_stack: string | null;
    salary: string | null;
    location: string | null;
    posted_date: string | null;
    india_friendly: string | null;
    mark_for_email: number | null;
};

export interface OutreachFilters {
    status?: string | null;
    search?: string | null;
    batch?: "new" | "old" | null;
    limit?: number;
    offset?: number;
}
