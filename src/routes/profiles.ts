import { query, withTransaction } from "../db/connection.js";
import {
    activateProfile,
    addActiveProfileQuery,
    createProfile,
    deleteActiveProfileQuery,
    deleteProfile,
    duplicateProfile,
    exportProfile,
    getActiveProfile,
    getActiveProfileQueries,
    getProfile,
    importPreset,
    listPresets,
    listProfiles,
    updateActiveProfileQuery,
    updateProfile,
} from "../db/profile.js";
import { scoreJob } from "../scoring/scorer.js";
import {
    presetImportSchema,
    profileInputSchema,
    queryInputSchema,
    queryPatchSchema,
} from "../schemas/api.js";
import { HttpError, toBool, detail, toStr, getQuery, readJson } from "./util.js";

// ── Profiles + active-profile search-queries API ────────────

function parsePid(raw: unknown): number {
    const pid = Number.parseInt(String(raw), 10);
    if (Number.isNaN(pid)) throw new HttpError(422, "profile id must be an integer");
    return pid;
}

async function queriesCountFor(pid: number): Promise<number> {
    const row = await getProfile(pid);
    return row?.config.search.jsearch_default_queries?.length ?? 0;
}

// Bun resolves static paths before parameter routes, regardless of map order.

export const profilesRoutes = {
    "/api/profiles": {
        GET: async (_req) => {
            return Response.json({ profiles: await listProfiles(), presets: listPresets() });
        },
        POST: async (req) => {
            const parsed = profileInputSchema.safeParse(await readJson(req));
            if (!parsed.success) {
                return detail(422, parsed.error.message);
            }
            try {
                const pid = await createProfile(
                    parsed.data.name,
                    parsed.data.config,
                    parsed.data.description,
                );
                return Response.json({ id: pid, ok: true });
            } catch (err) {
                return detail(400, String(err));
            }
        },
    },
    "/api/profiles/active": {
        GET: async (_req) => {
            const cfg = await getActiveProfile();
            const config: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(cfg)) {
                if (!k.startsWith("_")) config[k] = v;
            }
            return Response.json({ id: cfg._id, name: cfg._name, config });
        },
    },
    "/api/profiles/import": {
        POST: async (req) => {
            const parsed = presetImportSchema.safeParse(await readJson(req));
            if (!parsed.success) {
                return detail(422, parsed.error.message);
            }
            let pid: number;
            try {
                pid = await importPreset(parsed.data.preset_slug, parsed.data.activate, parsed.data.overwrite);
            } catch (err) {
                const msg = String(err);
                return detail(msg.includes("not found") ? 404 : 400, msg.replace(/^Error:\s*/, ""));
            }
            return Response.json({ ok: true, id: pid, queries: await queriesCountFor(pid) });
        },
    },
    "/api/profiles/rescore-all": {
        POST: async (req) => {
            const deleteBelowMin = toBool(getQuery(req).delete_below_min, false);
            const profile = await getActiveProfile();
            const profileId = profile._id;
            const minStore = Math.trunc(profile.scoring.min_score_to_store ?? 25);

            const rows = await query<{
                id: string;
                title: string;
                description: string | null;
                location: string | null;
                tech_stack: string | null;
            }>("SELECT id, title, description, location, tech_stack FROM jobs");

            let updated = 0;
            let deleted = 0;
            await withTransaction(async (client) => {
                for (const r of rows.rows) {
                    const result = scoreJob(r.title, r.description || "", r.location || "", profile);
                    if (deleteBelowMin && result.score < minStore) {
                        await query("DELETE FROM jobs WHERE id = $1", [r.id], client);
                        deleted += 1;
                        continue;
                    }
                    const tech = new Set(
                        (r.tech_stack || "").split(",").map((t) => t.trim()).filter(Boolean),
                    );
                    for (const t of result.tech_stack) tech.add(t);
                    const techStr = [...tech].sort().join(", ");
                    await query(
                        `UPDATE jobs SET relevance_score = $1, experience_level = $2, india_friendly = $3,
                         location_note = $4, tech_stack = $5, scored_profile_id = $6 WHERE id = $7`,
                        [
                            result.score,
                            result.experience_level,
                            result.india_friendly,
                            result.location_note,
                            techStr,
                            profileId,
                            r.id,
                        ],
                        client,
                    );
                    updated += 1;
                }
            });

            return Response.json({ ok: true, scanned: rows.rows.length, updated, deleted });
        },
    },
    "/api/profiles/:pid": {
        // ── Parametric profile routes ─────────────────────────────────────────
        GET: async (req) => {
            const pid = parsePid(req.params.pid);
            const row = await getProfile(pid);
            if (!row) {
                return detail(404, "Profile not found");
            }
            return Response.json(row);
        },
        PUT: async (req) => {
            const pid = parsePid(req.params.pid);
            if (!(await getProfile(pid))) {
                return detail(404, "Profile not found");
            }
            const parsed = profileInputSchema.safeParse(await readJson(req));
            if (!parsed.success) {
                return detail(422, parsed.error.message);
            }
            await updateProfile(pid, {
                config: parsed.data.config,
                name: parsed.data.name,
                description: parsed.data.description,
            });
            return Response.json({ ok: true });
        },
        DELETE: async (req) => {
            const pid = parsePid(req.params.pid);
            try {
                await deleteProfile(pid);
                return Response.json({ ok: true });
            } catch (err) {
                return detail(400, String(err));
            }
        },
    },
    "/api/profiles/:pid/activate": {
        POST: async (req) => {
            const pid = parsePid(req.params.pid);
            try {
                await activateProfile(pid);
            } catch (err) {
                return detail(404, String(err));
            }
            return Response.json({ ok: true, active: pid, queries: await queriesCountFor(pid) });
        },
    },
    "/api/profiles/:pid/duplicate": {
        POST: async (req) => {
            const pid = parsePid(req.params.pid);
            try {
                const newId = await duplicateProfile(pid, toStr(getQuery(req).name) ?? undefined);
                return Response.json({ ok: true, id: newId });
            } catch (err) {
                return detail(404, String(err));
            }
        },
    },
    "/api/profiles/:pid/export": {
        GET: async (req) => {
            const pid = parsePid(req.params.pid);
            try {
                const yamlText = await exportProfile(pid);
                return new Response(yamlText, { headers: { "Content-Type": "application/x-yaml; charset=utf-8" } });
            } catch (err) {
                return detail(404, String(err));
            }
        },
    },
    "/api/search-queries": {
        // ── Search queries (stored on the active profile) ─────────────────────
        GET: async (_req) => {
            return Response.json({ queries: await getActiveProfileQueries() });
        },
        POST: async (req) => {
            const parsed = queryInputSchema.safeParse(await readJson(req));
            if (!parsed.success) {
                return detail(422, parsed.error.message);
            }
            try {
                const qid = await addActiveProfileQuery(
                    parsed.data.query,
                    parsed.data.country,
                    parsed.data.date_posted,
                    parsed.data.remote_jobs_only,
                );
                return Response.json({ id: qid, ok: true });
            } catch (err) {
                return detail(400, String(err));
            }
        },
    },
    "/api/search-queries/:qid": {
        PATCH: async (req) => {
            const qid = Number.parseInt(String(req.params.qid), 10);
            if (Number.isNaN(qid)) {
                return detail(422, "query id must be an integer");
            }
            const parsed = queryPatchSchema.safeParse(await readJson(req));
            if (!parsed.success) {
                return detail(422, parsed.error.message);
            }
            try {
                await updateActiveProfileQuery(qid, parsed.data);
                return Response.json({ ok: true });
            } catch (err) {
                return detail(400, String(err));
            }
        },
        DELETE: async (req) => {
            const qid = Number.parseInt(String(req.params.qid), 10);
            if (Number.isNaN(qid)) {
                return detail(422, "query id must be an integer");
            }
            try {
                await deleteActiveProfileQuery(qid);
                return Response.json({ ok: true });
            } catch (err) {
                return detail(400, String(err));
            }
        },
    },
} satisfies Bun.Serve.Routes<undefined, string>;
