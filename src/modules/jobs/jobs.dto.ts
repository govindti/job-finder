import { getQuery, requiredString, toInt, toStr } from "../../common/http/request.js";
import type { ApiRequest } from "../../common/http/route.js";
import type { JobFilters } from "./jobs.types.js";

export function parseJobFilters(req: Request): JobFilters {
    const q = getQuery(req);
    return {
        source: toStr(q.source), status: toStr(q.status), min_score: toInt(q.min_score, 0, 0, 100),
        search: toStr(q.search), location: toStr(q.location), tech: toStr(q.tech),
        india_friendly: toStr(q.india_friendly), company_domain: toStr(q.company_domain),
        limit: toInt(q.limit, 50, 1, 500), offset: toInt(q.offset, 0, 0),
    };
}

export const parseJobId = (req: ApiRequest) => requiredString(req.params.jobId, "job id");
export const parseJobStatus = (req: Request) => requiredString(getQuery(req).status, "status query parameter");
