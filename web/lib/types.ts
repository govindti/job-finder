export interface Job {
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

export interface JobStats {
    total: number;
    by_source: Record<string, number>;
    by_status: Record<string, number>;
    by_india: Record<string, number>;
    avg_score: number;
}

export interface JSearchStatus {
    configured: boolean;
    month: number;
    today: number;
    total: number;
    monthly_limit: number;
    remaining: number;
}

export interface SheetsStatus {
    configured: boolean;
    sheet_id: string;
    creds_exists: boolean;
}

export interface SearchQuery {
    id: number;
    query: string;
    country: string;
    date_posted: string;
    remote_jobs_only: boolean;
    enabled: boolean;
}

export interface OutreachItem {
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
    job_url: string | null;
    relevance_score: number | null;
    tech_stack: string | null;
    location: string | null;
    salary: string | null;
    india_friendly: string | null;
}

export interface OutreachStats {
    total: number;
    by_status: Record<string, number>;
}

export interface LinkedInSearch {
    label: string;
    title?: string;
    category: string;
    url: string;
}

export interface EmailStatus {
    sender_configured: boolean;
    sender: string;
    sender_source: string;
    recipient: string;
    recipient_source: string;
    candidate_name: string;
    scheduled_hour: number;
    timezone: string;
    recent_sends: Array<{
        id: number;
        sent_at: string;
        recipient: string;
        subject: string | null;
        items_count: number | null;
        status: string | null;
        error: string | null;
    }>;
}

export interface HunterStatus {
    configured: boolean;
    plan?: string;
    used?: number;
    available?: number;
    error?: string;
}

export interface DigestPreview {
    error?: string;
    sent?: number;
    message?: string;
    dry_run?: boolean;
    items_count?: number;
    subject?: string;
    sender?: string;
    recipient?: string;
    html_length?: number;
    preview?: Array<{ title: string | null; company: string | null }>;
}

export interface JsearchQuery {
    query: string;
    country: string;
    date_posted: string;
    remote_jobs_only: boolean;
    enabled?: boolean;
}

export interface LinkedinTitle {
    title: string;
    label: string;
    category: string;
}

export interface Weights {
    title: number;
    tech: number;
    experience: number;
    signal: number;
}

export interface SearchConfig {
    default_terms: string[];
    title_keywords_positive: string[];
    title_keywords_negative: string[];
    relevant_tech: string[];
    jsearch_default_queries: JsearchQuery[];
}

export interface ScoringConfig {
    experience_target: "fresher" | "junior" | "mid" | "senior" | "any";
    min_relevance_score: number;
    min_score_to_store: number;
    weights: Weights;
    core_tech: string[];
    backend_signals: string[];
    experience_bonuses?: Record<string, Record<string, number>>;
}

export interface LocationConfig {
    india_positive: string[];
    india_negative: string[];
    timezone_compatible: string[];
    timezone_incompatible: string[];
}

export interface OutreachConfig {
    candidate_name: string;
    candidate_core_tech: string[];
    candidate_extra_tech: string[];
    linkedin_search_titles: LinkedinTitle[];
    bio_short: string;
    achievements: string[];
    dm_short_template: string;
    dm_long_template: string;
    email_digest_subject_role: string;
    email_greeting: string;
    recipient_email: string;
}

export interface ProfileConfig {
    schema_version?: number;
    search: SearchConfig;
    scoring: ScoringConfig;
    location: LocationConfig;
    outreach: OutreachConfig;
    [key: string]: unknown;
}

export interface ProfileSummary {
    id: number;
    name: string;
    description: string;
    source: string;
    created_at: string;
    updated_at: string;
    is_active: boolean;
}

export interface PresetMeta {
    slug: string;
    name: string;
    description: string;
}

export interface ProfileDetail {
    id: number;
    name: string;
    description: string;
    source: string;
    created_at: string;
    updated_at: string;
    config: ProfileConfig;
}

export interface ActiveProfile {
    id: number | null;
    name: string | null;
    config: ProfileConfig;
}

export interface CollectionStats {
    fetched: number;
    new: number;
    updated: number;
    filtered_out: number;
    deleted_stale?: number;
    sources?: Record<string, number>;
    board_sources?: Record<string, number>;
    companies_crawled?: number;
    companies_failed?: number;
    outreach_generated?: number;
}

export interface PipelineResult {
    collection: { new: number };
    outreach_generated: number;
    email: DigestPreview | { skipped: boolean };
}
