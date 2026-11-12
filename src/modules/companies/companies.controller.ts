import type { ApiRequest } from "../../common/http/route.js";
import * as dto from "./companies.dto.js";
import * as service from "./companies.service.js";

export async function list(req: ApiRequest): Promise<Response> {
    const companies = await service.getCompanies(dto.parseCompanyFilters(req));
    return Response.json({ companies, count: companies.length });
}

export async function create(req: ApiRequest): Promise<Response> {
    const id = await service.createCompany(await dto.parseCompanyInput(req));
    return Response.json({ ok: true, id });
}

export async function update(req: ApiRequest): Promise<Response> {
    await service.updateCompany(dto.parseCompanyId(req), await dto.parseCompanyInput(req));
    return Response.json({ ok: true });
}

export async function pause(req: ApiRequest): Promise<Response> {
    await service.pauseCompany(dto.parseCompanyId(req));
    return Response.json({ ok: true });
}

export async function activate(req: ApiRequest): Promise<Response> {
    await service.updateCompanyCrawlStatus(dto.parseCompanyId(req), "active");
    return Response.json({ ok: true });
}

export async function stats(): Promise<Response> { return Response.json(await service.getCompanyStats()); }
export async function seed(): Promise<Response> { return Response.json(await service.seedCompanies()); }
export async function megaSeed(): Promise<Response> { return Response.json(await service.seedCompanies(true)); }
export function discover(): Response { return service.discoverCompanies(); }
