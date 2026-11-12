import { z } from "zod";
import { getQuery, readJson, requiredString, toInt, toStr } from "../../common/http/request.js";
import type { ApiRequest } from "../../common/http/route.js";
import type { CompanyFilters } from "./companies.types.js";

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

export async function parseCompanyInput(req: Request): Promise<CompanyInput> { return companyInputSchema.parse(await readJson(req)); }
export const parseCompanyId = (req: ApiRequest) => requiredString(req.params.companyId, "company id");

export function parseCompanyFilters(req: Request): CompanyFilters {
    const q = getQuery(req);
    return {
        ats_platform: toStr(q.ats_platform), crawl_status: toStr(q.crawl_status),
        india_friendly: toStr(q.india_friendly), search: toStr(q.search),
        limit: toInt(q.limit, 200, 1, 500), offset: toInt(q.offset, 0, 0),
    };
}
