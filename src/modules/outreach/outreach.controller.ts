import type { ApiRequest } from "../../common/http/route.js";
import * as dto from "./outreach.dto.js";
import * as service from "./outreach.service.js";

export async function list(req: ApiRequest): Promise<Response> { return Response.json(await service.listOutreach(dto.parseOutreachFilters(req))); }
export async function stats(): Promise<Response> { return Response.json(await service.getOutreachStats()); }
export async function hunterStatus(): Promise<Response> { return Response.json(await service.getHunterStatus()); }

export async function bulkDelete(req: ApiRequest): Promise<Response> {
    const { ids } = await dto.parseBulkDelete(req);
    return Response.json({ deleted: await service.deleteOutreachBulk(ids) });
}

export async function generate(req: ApiRequest): Promise<Response> {
    const { limit, minScore, indiaFriendly } = dto.parseGenerationQuery(req);
    const generated = await service.generateOutreachForTopJobs(limit, minScore, indiaFriendly, null);
    return Response.json(generated === 0 ? { generated, message: "No new jobs eligible for outreach" } : { generated });
}

export async function updateStatus(req: ApiRequest): Promise<Response> {
    await service.updateOutreachStatus(dto.parseOutreachId(req), dto.parseStatus(req));
    return Response.json({ ok: true });
}

export async function updateNotes(req: ApiRequest): Promise<Response> {
    await service.updateOutreachNotes(dto.parseOutreachId(req), dto.parseNotes(req));
    return Response.json({ ok: true });
}
