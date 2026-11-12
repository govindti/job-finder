import { getQuery, toBool, toInt } from "../../common/http/request.js";

export const parseCollectQuery = (req: Request) => toBool(getQuery(req).generate_outreach, true);
export const parsePipelineQuery = (req: Request) => toBool(getQuery(req).send, true);
export const parseRunNowQuery = (req: Request) => !toBool(getQuery(req).dryRun, false);
export const parseRescoreQuery = (req: Request) => toBool(getQuery(req).delete_below_min, false);
export function parseRefreshQuery(req: Request) {
    const q = getQuery(req);
    return { limit: toInt(q.limit, 15, 1, 50), minScore: toInt(q.min_score, 40, 0, 100) };
}
