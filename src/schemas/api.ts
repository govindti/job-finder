import { z } from "zod";

// Request-body schemas for the native Bun routes (CompanyInput, ProfileInput,
// QueryInput, QueryPatch, PresetImport, OutreachBulkDelete). Defaults match
// the field defaults used across the API.

export const companyInputSchema = z.object({
    name: z.string(),
    domain: z.string().default(""),
    careers_url: z.string().default(""),
    ats_platform: z.string().default("unknown"),
    ats_slug: z.string().default(""),
    founded_year: z.number().int().default(0),
    employee_count: z.string().default(""),
    tags: z.string().default(""),
    india_friendly: z.string().default("unknown"),
    notes: z.string().default(""),
});
export type CompanyInput = z.infer<typeof companyInputSchema>;

export const profileInputSchema = z.object({
    name: z.string(),
    description: z.string().default(""),
    config: z.record(z.unknown()),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const queryInputSchema = z.object({
    query: z.string(),
    country: z.string().default("IN"),
    date_posted: z.string().default("3days"),
    remote_jobs_only: z.boolean().default(false),
});
export type QueryInput = z.infer<typeof queryInputSchema>;

export const queryPatchSchema = z.object({
    query: z.string().optional(),
    country: z.string().optional(),
    date_posted: z.string().optional(),
    remote_jobs_only: z.boolean().optional(),
    enabled: z.boolean().optional(),
});
export type QueryPatch = z.infer<typeof queryPatchSchema>;

export const presetImportSchema = z.object({
    preset_slug: z.string(),
    activate: z.boolean().default(false),
    overwrite: z.boolean().default(false),
});
export type PresetImport = z.infer<typeof presetImportSchema>;

export const outreachBulkDeleteSchema = z.object({
    ids: z.array(z.string()),
});
