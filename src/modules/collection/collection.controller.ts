import type { ApiRequest } from "../../common/http/route.js";
import { parseCrawlCompanyId } from "./collection.dto.js";
import * as service from "./collection.service.js";

export async function crawl(): Promise<Response> { return Response.json(await service.runCompanyCrawl()); }
export async function crawlCompany(req: ApiRequest): Promise<Response> {
    return Response.json(await service.runCompanyCrawl([parseCrawlCompanyId(req)]));
}
export async function jsearchStatus(): Promise<Response> { return Response.json(await service.getJSearchStatus()); }
