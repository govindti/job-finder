import type { ApiRequest } from "../../common/http/route.js";
import * as dto from "./automation.dto.js";
import * as service from "./automation.service.js";

export async function collect(req: ApiRequest): Promise<Response> { return Response.json(await service.collectJobs(dto.parseCollectQuery(req))); }
export async function pipeline(req: ApiRequest): Promise<Response> { return Response.json(await service.runDailyPipeline(dto.parsePipelineQuery(req))); }
export async function runNow(req: ApiRequest): Promise<Response> { return Response.json(await service.runDailyPipeline(dto.parseRunNowQuery(req))); }
export async function rescore(req: ApiRequest): Promise<Response> { return Response.json(await service.rescoreAll(dto.parseRescoreQuery(req))); }
export async function refresh(req: ApiRequest): Promise<Response> {
    const { limit, minScore } = dto.parseRefreshQuery(req);
    return Response.json(await service.refreshOutreach(limit, minScore));
}
