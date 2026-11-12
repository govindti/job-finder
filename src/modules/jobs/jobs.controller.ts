import type { ApiRequest } from "../../common/http/route.js";
import * as dto from "./jobs.dto.js";
import * as service from "./jobs.service.js";

export async function list(req: ApiRequest): Promise<Response> {
    const jobs = await service.getJobs(dto.parseJobFilters(req));
    return Response.json({ jobs, count: jobs.length });
}

export async function marked(): Promise<Response> {
    return Response.json({ jobs: await service.getMarkedJobs() });
}

export async function get(req: ApiRequest): Promise<Response> {
    return Response.json(await service.getJobById(dto.parseJobId(req)));
}

export async function updateStatus(req: ApiRequest): Promise<Response> {
    await service.updateJobStatus(dto.parseJobId(req), dto.parseJobStatus(req));
    return Response.json({ ok: true });
}

export async function toggleEmailMark(req: ApiRequest): Promise<Response> {
    return Response.json({ mark_for_email: await service.toggleMarkForEmail(dto.parseJobId(req)) });
}

export async function stats(): Promise<Response> { return Response.json(await service.getStats()); }
export async function sources(): Promise<Response> { return Response.json({ sources: await service.getSources() }); }
