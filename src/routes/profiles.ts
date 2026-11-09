import { Router } from "express";
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
import { asyncHandler, toBool, detail, toStr } from "./util.js";

// ── Profiles + active-profile search-queries API ────────────
export const profilesRouter = Router();

function parsePid(raw: unknown, res: Parameters<typeof detail>[0]): number | null {
    const pid = Number.parseInt(String(raw), 10);
    if (Number.isNaN(pid)) {
        detail(res, 422, "profile id must be an integer");
        return null;
    }
    return pid;
}

async function queriesCountFor(pid: number): Promise<number> {
    const row = await getProfile(pid);
    return row?.config.search.jsearch_default_queries?.length ?? 0;
}

// ── Static paths must be registered before the "/profiles/:pid" routes ──

profilesRouter.get(
    "/profiles",
    asyncHandler(async (_req, res) => {
        res.json({ profiles: await listProfiles(), presets: listPresets() });
    }),
);

profilesRouter.get(
    "/profiles/active",
    asyncHandler(async (_req, res) => {
        const cfg = await getActiveProfile();
        const config: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cfg)) {
            if (!k.startsWith("_")) config[k] = v;
        }
        res.json({ id: cfg._id, name: cfg._name, config });
    }),
);

profilesRouter.post(
    "/profiles/import",
    asyncHandler(async (req, res) => {
        const parsed = presetImportSchema.safeParse(req.body);
        if (!parsed.success) {
            detail(res, 422, parsed.error.message);
            return;
        }
        let pid: number;
        try {
            pid = await importPreset(parsed.data.preset_slug, parsed.data.activate, parsed.data.overwrite);
        } catch (err) {
            const msg = String(err);
            detail(res, msg.includes("not found") ? 404 : 400, msg.replace(/^Error:\s*/, ""));
            return;
        }
        res.json({ ok: true, id: pid, queries: await queriesCountFor(pid) });
    }),
);

profilesRouter.post(
    "/profiles/rescore-all",
    asyncHandler(async (req, res) => {
        const deleteBelowMin = toBool(req.query.delete_below_min, false);
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

        res.json({ ok: true, scanned: rows.rows.length, updated, deleted });
    }),
);

// ── Parametric profile routes ─────────────────────────────────────────

profilesRouter.get(
    "/profiles/:pid",
    asyncHandler(async (req, res) => {
        const pid = parsePid(req.params.pid, res);
        if (pid === null) return;
        const row = await getProfile(pid);
        if (!row) {
            detail(res, 404, "Profile not found");
            return;
        }
        res.json(row);
    }),
);

profilesRouter.post(
    "/profiles",
    asyncHandler(async (req, res) => {
        const parsed = profileInputSchema.safeParse(req.body);
        if (!parsed.success) {
            detail(res, 422, parsed.error.message);
            return;
        }
        try {
            const pid = await createProfile(
                parsed.data.name,
                parsed.data.config,
                parsed.data.description,
            );
            res.json({ id: pid, ok: true });
        } catch (err) {
            detail(res, 400, String(err));
        }
    }),
);

profilesRouter.put(
    "/profiles/:pid",
    asyncHandler(async (req, res) => {
        const pid = parsePid(req.params.pid, res);
        if (pid === null) return;
        if (!(await getProfile(pid))) {
            detail(res, 404, "Profile not found");
            return;
        }
        const parsed = profileInputSchema.safeParse(req.body);
        if (!parsed.success) {
            detail(res, 422, parsed.error.message);
            return;
        }
        await updateProfile(pid, {
            config: parsed.data.config,
            name: parsed.data.name,
            description: parsed.data.description,
        });
        res.json({ ok: true });
    }),
);

profilesRouter.post(
    "/profiles/:pid/activate",
    asyncHandler(async (req, res) => {
        const pid = parsePid(req.params.pid, res);
        if (pid === null) return;
        try {
            await activateProfile(pid);
        } catch (err) {
            detail(res, 404, String(err));
            return;
        }
        res.json({ ok: true, active: pid, queries: await queriesCountFor(pid) });
    }),
);

profilesRouter.post(
    "/profiles/:pid/duplicate",
    asyncHandler(async (req, res) => {
        const pid = parsePid(req.params.pid, res);
        if (pid === null) return;
        try {
            const newId = await duplicateProfile(pid, toStr(req.query.name) ?? undefined);
            res.json({ ok: true, id: newId });
        } catch (err) {
            detail(res, 404, String(err));
        }
    }),
);

profilesRouter.delete(
    "/profiles/:pid",
    asyncHandler(async (req, res) => {
        const pid = parsePid(req.params.pid, res);
        if (pid === null) return;
        try {
            await deleteProfile(pid);
            res.json({ ok: true });
        } catch (err) {
            detail(res, 400, String(err));
        }
    }),
);

profilesRouter.get(
    "/profiles/:pid/export",
    asyncHandler(async (req, res) => {
        const pid = parsePid(req.params.pid, res);
        if (pid === null) return;
        try {
            const yamlText = await exportProfile(pid);
            res.type("application/x-yaml").send(yamlText);
        } catch (err) {
            detail(res, 404, String(err));
        }
    }),
);

// ── Search queries (stored on the active profile) ─────────────────────

profilesRouter.get(
    "/search-queries",
    asyncHandler(async (_req, res) => {
        res.json({ queries: await getActiveProfileQueries() });
    }),
);

profilesRouter.post(
    "/search-queries",
    asyncHandler(async (req, res) => {
        const parsed = queryInputSchema.safeParse(req.body);
        if (!parsed.success) {
            detail(res, 422, parsed.error.message);
            return;
        }
        try {
            const qid = await addActiveProfileQuery(
                parsed.data.query,
                parsed.data.country,
                parsed.data.date_posted,
                parsed.data.remote_jobs_only,
            );
            res.json({ id: qid, ok: true });
        } catch (err) {
            detail(res, 400, String(err));
        }
    }),
);

profilesRouter.patch(
    "/search-queries/:qid",
    asyncHandler(async (req, res) => {
        const qid = Number.parseInt(String(req.params.qid), 10);
        if (Number.isNaN(qid)) {
            detail(res, 422, "query id must be an integer");
            return;
        }
        const parsed = queryPatchSchema.safeParse(req.body);
        if (!parsed.success) {
            detail(res, 422, parsed.error.message);
            return;
        }
        try {
            await updateActiveProfileQuery(qid, parsed.data);
            res.json({ ok: true });
        } catch (err) {
            detail(res, 400, String(err));
        }
    }),
);

profilesRouter.delete(
    "/search-queries/:qid",
    asyncHandler(async (req, res) => {
        const qid = Number.parseInt(String(req.params.qid), 10);
        if (Number.isNaN(qid)) {
            detail(res, 422, "query id must be an integer");
            return;
        }
        try {
            await deleteActiveProfileQuery(qid);
            res.json({ ok: true });
        } catch (err) {
            detail(res, 400, String(err));
        }
    }),
);
