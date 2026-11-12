import YAML from "yaml";
import { AppError } from "../../common/errors/app-error.js";
import { utcNowIso } from "../../common/utils/time.js";
import { defaultConfig, legacyProfileFromSettings, validateConfig } from "./profiles.config.js";
import { readPreset, listPresets } from "./profiles.presets.js";
import * as repository from "./profiles.repository.js";
import type { ActiveProfile, ActiveProfileQuery, JsearchQuery, ProfileConfig, ProfileDetail, ProfileSummary } from "./profiles.types.js";

let activeCache: ActiveProfile | null = null;

export function invalidateCache(): void { activeCache = null; }

export async function refreshActiveProfile(): Promise<ActiveProfile> {
    invalidateCache();
    const id = await repository.readActiveProfileId();
    const row = id === null ? undefined : await repository.readProfileRow(id);
    if (!row) return { ...defaultConfig(), _id: null, _name: "(none)" };
    activeCache = { ...validateConfig(JSON.parse(row.config_json)), _id: row.id, _name: row.name };
    return { ...activeCache };
}

export async function getActiveProfile(): Promise<ActiveProfile> {
    return activeCache ? { ...activeCache } : refreshActiveProfile();
}

export async function activeProfileView() {
    const { _id, _name, ...config } = await getActiveProfile();
    return { id: _id, name: _name, config: Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith("_"))) };
}

export async function listProfiles(): Promise<ProfileSummary[]> {
    const activeId = await repository.readActiveProfileId();
    return (await repository.listProfileRows()).map(({ config_json: _, ...row }) => ({ ...row, is_active: row.id === activeId }));
}

export async function profilesOverview() { return { profiles: await listProfiles(), presets: listPresets() }; }

export async function getProfile(id: number): Promise<ProfileDetail> {
    const row = await repository.readProfileRow(id);
    if (!row) throw new AppError("PROFILE_NOT_FOUND");
    const { config_json, ...detail } = row;
    return { ...detail, config: validateConfig(JSON.parse(config_json)) };
}

export async function createProfile(name: string, config: unknown, description = "", source = "custom"): Promise<number> {
    return repository.insertProfile(name, description, validateConfig(config), source);
}

export async function updateProfile(id: number, fields: { name?: string; description?: string; config?: unknown }): Promise<void> {
    await getProfile(id);
    await repository.updateProfileRow(id, {
        name: fields.name,
        description: fields.description,
        config: fields.config === undefined ? undefined : validateConfig(fields.config),
    });
    if ((await repository.readActiveProfileId()) === id) await refreshActiveProfile();
}

export async function activateProfile(id: number): Promise<void> {
    await getProfile(id);
    await repository.setActiveProfileId(id);
    await refreshActiveProfile();
}

export async function deleteProfile(id: number): Promise<void> {
    await getProfile(id);
    if ((await repository.readActiveProfileId()) === id) throw new AppError("ACTIVE_PROFILE_DELETE_FORBIDDEN");
    await repository.deleteProfileRow(id);
}

export async function duplicateProfile(id: number, name?: string): Promise<number> {
    const profile = await getProfile(id);
    return createProfile(name || `${profile.name} (copy)`, profile.config, profile.description);
}

export async function importPreset(slug: string, activate = false, overwrite = false): Promise<number> {
    const preset = readPreset(slug);
    const config = validateConfig(preset.config);
    const existing = await repository.findProfileByName(preset.name);
    let id: number;
    if (existing && overwrite) {
        id = existing.id;
        await repository.updateProfileRow(id, { description: preset.description, config, source: `preset:${slug}` });
        if ((await repository.readActiveProfileId()) === id) await refreshActiveProfile();
    } else {
        const name = existing ? `${preset.name} (imported ${utcNowIso().slice(0, 10)})` : preset.name;
        id = await repository.insertProfile(name, preset.description, config, `preset:${slug}`);
    }
    if (activate) await activateProfile(id);
    return id;
}

export async function queriesCountFor(id: number): Promise<number> {
    return (await getProfile(id)).config.search.jsearch_default_queries?.length ?? 0;
}

export async function exportProfile(id: number): Promise<string> {
    const { name, description, config } = await getProfile(id);
    return YAML.stringify({ name, description, ...config }, { lineWidth: 100 });
}

export async function ensureFirstRunSeed(): Promise<number | null> {
    if ((await repository.countProfiles()) > 0) return null;
    const id = await repository.insertProfile(
        "Backend Python (legacy)",
        "Seeded from pre-profile hardcoded settings. Edit or switch to another preset.",
        legacyProfileFromSettings(), "legacy",
    );
    await repository.setActiveProfileId(id);
    invalidateCache();
    return id;
}

async function loadActiveProfileConfig(): Promise<{ id: number | null; config: ProfileConfig }> {
    const id = await repository.readActiveProfileId();
    const row = id === null ? undefined : await repository.readProfileRow(id);
    return row ? { id: row.id, config: validateConfig(JSON.parse(row.config_json)) } : { id: null, config: defaultConfig() };
}

export async function getActiveProfileQueries(): Promise<ActiveProfileQuery[]> {
    const { config } = await loadActiveProfileConfig();
    return (config.search.jsearch_default_queries ?? []).map((q, id) => ({
        id, query: q.query ?? "", country: q.country ?? "IN", date_posted: q.date_posted ?? "3days",
        remote_jobs_only: Boolean(q.remote_jobs_only), enabled: q.enabled ?? true,
    }));
}

export async function addActiveProfileQuery(query: string, country = "IN", datePosted = "3days", remoteJobsOnly = false): Promise<number> {
    const { id, config } = await loadActiveProfileConfig();
    if (id === null) throw new AppError("NO_ACTIVE_PROFILE");
    const queries = [...(config.search.jsearch_default_queries ?? [])];
    queries.push({ query, country, date_posted: datePosted, remote_jobs_only: remoteJobsOnly, enabled: true });
    config.search.jsearch_default_queries = queries;
    await updateProfile(id, { config });
    return queries.length - 1;
}

export async function updateActiveProfileQuery(queryId: number, fields: Partial<JsearchQuery>): Promise<void> {
    const { id, config } = await loadActiveProfileConfig();
    if (id === null) throw new AppError("NO_ACTIVE_PROFILE");
    const queries = [...(config.search.jsearch_default_queries ?? [])];
    const target = queries[queryId];
    if (!target) throw new AppError("QUERY_NOT_FOUND");
    queries[queryId] = { ...target, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) };
    config.search.jsearch_default_queries = queries;
    await updateProfile(id, { config });
}

export async function deleteActiveProfileQuery(queryId: number): Promise<void> {
    const { id, config } = await loadActiveProfileConfig();
    if (id === null) throw new AppError("NO_ACTIVE_PROFILE");
    const queries = [...(config.search.jsearch_default_queries ?? [])];
    if (queryId < 0 || queryId >= queries.length) throw new AppError("QUERY_NOT_FOUND");
    queries.splice(queryId, 1);
    config.search.jsearch_default_queries = queries;
    await updateProfile(id, { config });
}
