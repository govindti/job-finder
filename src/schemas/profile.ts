import { z } from "zod";

// ── Sub-schemas composing the profile config ──────────────────────────

export const jsearchQuerySchema = z
    .object({
        query: z.string(),
        country: z.string().default("IN"),
        date_posted: z.string().default("3days"),
        remote_jobs_only: z.boolean().default(false),
        enabled: z.boolean().default(true),
    })
    .passthrough();

export const linkedinTitleSchema = z
    .object({
        title: z.string(),
        label: z.string().default(""),
        category: z.string().default("engineering"),
    })
    .passthrough();

// experience_bonuses: target -> detected-level -> bonus (-15..+15)
export const experienceBonusesSchema = z
    .object({
        fresher: z.record(z.number()),
        junior: z.record(z.number()),
        mid: z.record(z.number()),
        senior: z.record(z.number()),
        any: z.record(z.number()),
    })
    .passthrough();

export const weightsSchema = z
    .object({
        title: z.number().default(35),
        tech: z.number().default(35),
        experience: z.number().default(15),
        signal: z.number().default(15),
    })
    .passthrough();

export const searchSchema = z
    .object({
        default_terms: z.array(z.string()).default([]),
        title_keywords_positive: z.array(z.string()).default([]),
        title_keywords_negative: z.array(z.string()).default([]),
        relevant_tech: z.array(z.string()).default([]),
        jsearch_default_queries: z.array(jsearchQuerySchema).default([]),
    })
    .passthrough();

export const scoringSchema = z
    .object({
        experience_target: z.enum(["fresher", "junior", "mid", "senior", "any"]).default("mid"),
        min_relevance_score: z.number().default(50),
        min_score_to_store: z.number().default(25),
        weights: weightsSchema.default({}),
        core_tech: z.array(z.string()).default([]),
        // Domain keywords matched against the job description. Kept under the
        // `backend_signals` name for config compatibility.
        backend_signals: z.array(z.string()).default([]),
        experience_bonuses: experienceBonusesSchema.optional(),
    })
    .passthrough();

export const locationSchema = z
    .object({
        india_positive: z.array(z.string()).default([]),
        india_negative: z.array(z.string()).default([]),
        timezone_compatible: z.array(z.string()).default([]),
        timezone_incompatible: z.array(z.string()).default([]),
    })
    .passthrough();

export const outreachSchema = z
    .object({
        candidate_name: z.string().default(""),
        candidate_core_tech: z.array(z.string()).default([]),
        candidate_extra_tech: z.array(z.string()).default([]),
        linkedin_search_titles: z.array(linkedinTitleSchema).default([]),
        bio_short: z.string().default(""),
        achievements: z.array(z.string()).default([]),
        dm_short_template: z.string().default(""),
        dm_long_template: z.string().default(""),
        email_digest_subject_role: z.string().default("software"),
        email_greeting: z.string().default("Your Daily Job Digest"),
        recipient_email: z.string().default(""),
    })
    .passthrough();

export const profileConfigSchema = z
    .object({
        schema_version: z.number().default(1),
        search: searchSchema.default({}),
        scoring: scoringSchema.default({}),
        location: locationSchema.default({}),
        outreach: outreachSchema.default({}),
    })
    .passthrough();

// ── Explicit working types (used across the app; cleaner than zod-infer with
//    .passthrough()). Shapes match defaultConfig() in profile.ts ──────────

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

export type ExperienceBonuses = Record<string, Record<string, number>>;

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
    experience_bonuses?: ExperienceBonuses;
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
    schema_version: number;
    search: SearchConfig;
    scoring: ScoringConfig;
    location: LocationConfig;
    outreach: OutreachConfig;
}

// The active profile is a validated config plus the injected identity fields
// (`_id`/`_name`) added when the active profile is loaded.
export type ActiveProfile = ProfileConfig & { _id: number | null; _name: string | null };
