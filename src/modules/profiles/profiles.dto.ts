import { z } from "zod";
import { getQuery, parseIntegerId, readJson, toStr } from "../../common/http/request.js";
import type { ApiRequest } from "../../common/http/route.js";

export const profileInputSchema = z.object({
    name: z.string(),
    description: z.string().default(""),
    config: z.record(z.unknown()),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

export const queryInputSchema = z.object({
    query: z.string(),
    country: z.string().default("IN"),
    date_posted: z.string().default("3days"),
    remote_jobs_only: z.boolean().default(false),
});

export type QueryInput = z.infer<typeof queryInputSchema>;

export const queryPatchSchema = z.object({
    query: z.string().optional(),
    country: z.string().optional(),
    date_posted: z.string().optional(),
    remote_jobs_only: z.boolean().optional(),
    enabled: z.boolean().optional(),
});

export type QueryPatch = z.infer<typeof queryPatchSchema>;

export const presetImportSchema = z.object({
    preset_slug: z.string(),
    activate: z.boolean().default(false),
    overwrite: z.boolean().default(false),
});

export type PresetImport = z.infer<typeof presetImportSchema>;

export const parseProfileId = (req: ApiRequest) => parseIntegerId(req.params.pid, "profile id");
export const parseQueryId = (req: ApiRequest) => parseIntegerId(req.params.qid, "query id", 0);
export const parseDuplicateName = (req: Request) => toStr(getQuery(req).name) ?? undefined;
export const parseProfileInput = async (req: Request) => profileInputSchema.parse(await readJson(req));
export const parsePresetInput = async (req: Request) => presetImportSchema.parse(await readJson(req));
export const parseQueryInput = async (req: Request) => queryInputSchema.parse(await readJson(req));
export const parseQueryPatch = async (req: Request) => queryPatchSchema.parse(await readJson(req));
