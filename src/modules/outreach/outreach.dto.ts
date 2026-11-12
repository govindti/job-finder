import { z } from "zod";
import { getQuery, readJson, requiredString, toInt, toStr } from "../../common/http/request.js";
import type { ApiRequest } from "../../common/http/route.js";
import type { OutreachFilters } from "./outreach.types.js";

export const outreachBulkDeleteSchema = z.object({
    ids: z.array(z.string()),
});

export const parseBulkDelete = async (req: Request) => outreachBulkDeleteSchema.parse(await readJson(req));
export const parseOutreachId = (req: ApiRequest) => requiredString(req.params.outreachId, "outreach id");
export const parseStatus = (req: Request) => requiredString(getQuery(req).status, "status query parameter");
export const parseNotes = (req: Request) => toStr(getQuery(req).notes) ?? "";

export function parseOutreachFilters(req: Request): OutreachFilters {
    const q = getQuery(req);
    const batch = toStr(q.batch);
    return {
        status: toStr(q.status), search: toStr(q.search), batch: batch === "new" || batch === "old" ? batch : null,
        limit: toInt(q.limit, 100, 1, 500), offset: toInt(q.offset, 0, 0),
    };
}

export function parseGenerationQuery(req: Request) {
    const q = getQuery(req);
    return { limit: toInt(q.limit, 15, 1, 50), minScore: toInt(q.min_score, 40, 0, 100), indiaFriendly: toStr(q.india_friendly) ?? "maybe" };
}
