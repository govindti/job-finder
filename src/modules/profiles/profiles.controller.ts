import type { ApiRequest } from "../../common/http/route.js";
import * as dto from "./profiles.dto.js";
import * as service from "./profiles.service.js";

export async function list(): Promise<Response> { return Response.json(await service.profilesOverview()); }
export async function active(): Promise<Response> { return Response.json(await service.activeProfileView()); }
export async function get(req: ApiRequest): Promise<Response> { return Response.json(await service.getProfile(dto.parseProfileId(req))); }

export async function create(req: ApiRequest): Promise<Response> {
    const input = await dto.parseProfileInput(req);
    return Response.json({ id: await service.createProfile(input.name, input.config, input.description), ok: true });
}

export async function update(req: ApiRequest): Promise<Response> {
    const id = dto.parseProfileId(req);
    await service.updateProfile(id, await dto.parseProfileInput(req));
    return Response.json({ ok: true });
}

export async function remove(req: ApiRequest): Promise<Response> {
    await service.deleteProfile(dto.parseProfileId(req));
    return Response.json({ ok: true });
}

export async function activate(req: ApiRequest): Promise<Response> {
    const id = dto.parseProfileId(req);
    await service.activateProfile(id);
    return Response.json({ ok: true, active: id, queries: await service.queriesCountFor(id) });
}

export async function duplicate(req: ApiRequest): Promise<Response> {
    const id = await service.duplicateProfile(dto.parseProfileId(req), dto.parseDuplicateName(req));
    return Response.json({ ok: true, id });
}

export async function importPreset(req: ApiRequest): Promise<Response> {
    const input = await dto.parsePresetInput(req);
    const id = await service.importPreset(input.preset_slug, input.activate, input.overwrite);
    return Response.json({ ok: true, id, queries: await service.queriesCountFor(id) });
}

export async function exportYaml(req: ApiRequest): Promise<Response> {
    return new Response(await service.exportProfile(dto.parseProfileId(req)), { headers: { "Content-Type": "application/x-yaml; charset=utf-8" } });
}

export async function queries(): Promise<Response> { return Response.json({ queries: await service.getActiveProfileQueries() }); }

export async function addQuery(req: ApiRequest): Promise<Response> {
    const input = await dto.parseQueryInput(req);
    const id = await service.addActiveProfileQuery(input.query, input.country, input.date_posted, input.remote_jobs_only);
    return Response.json({ id, ok: true });
}

export async function updateQuery(req: ApiRequest): Promise<Response> {
    const id = dto.parseQueryId(req);
    await service.updateActiveProfileQuery(id, await dto.parseQueryPatch(req));
    return Response.json({ ok: true });
}

export async function removeQuery(req: ApiRequest): Promise<Response> {
    await service.deleteActiveProfileQuery(dto.parseQueryId(req));
    return Response.json({ ok: true });
}
