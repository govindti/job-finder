import { Router } from "express";
import { getDb } from "../db/connection.js";
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
import { toBool, detail, toStr } from "./util.js";

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

function queriesCountFor(pid: number): number {
    const row = getProfile(pid);
    return row?.config.search.jsearch_default_queries?.length ?? 0;
}

// ── Static paths must be registered before the "/profiles/:pid" routes ──

profilesRouter.get("/profiles", (_req, res) => {
    res.json({ profiles: listProfiles(), presets: listPresets() });
});

profilesRouter.get("/profiles/active", (_req, res) => {
    const cfg = getActiveProfile();
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg)) {
        if (!k.startsWith("_")) config[k] = v;
    }
    res.json({ id: cfg._id, name: cfg._name, config });
});

profilesRouter.post("/profiles/import", (req, res) => {
    const parsed = presetImportSchema.safeParse(req.body);
    if (!parsed.success) {
        detail(res, 422, parsed.error.message);
        return;
    }
    let pid: number;
    try {
        pid = importPreset(parsed.data.preset_slug, parsed.data.activate, parsed.data.overwrite);
    } catch (err) {
        const msg = String(err);
        detail(res, msg.includes("not found") ? 404 : 400, msg.replace(/^Error:\s*/, ""));
        return;
    }
    res.json({ ok: true, id: pid, queries: queriesCountFor(pid) });
});

profilesRouter.post("/profiles/rescore-all", (req, res) => {
    const deleteBelowMin = toBool(req.query.delete_below_min, false);
    const profile = getActiveProfile();
    const profileId = profile._id;
    const minStore = Math.trunc(profile.scoring.min_score_to_store ?? 25);

    const d = getDb();
    const rows = d
        .prepare("SELECT id, title, description, location, tech_stack FROM jobs")
        .all() as Array<{
            id: string;
            title: string;
            description: string | null;
            location: string | null;
            tech_stack: string | null;
        }>;

    const del = d.prepare("DELETE FROM jobs WHERE id = ?");
    const upd = d.prepare(
        `UPDATE jobs SET relevance_score = ?, experience_level = ?, india_friendly = ?,
        location_note = ?, tech_stack = ?, scored_profile_id = ? WHERE id = ?`,
    );

    let updated = 0;
    let deleted = 0;
    const tx = d.transaction(() => {
        for (const r of rows) {
            const result = scoreJob(r.title, r.description || "", r.location || "", profile);
            if (deleteBelowMin && result.score < minStore) {
                del.run(r.id);
                deleted += 1;
                continue;
            }
            const tech = new Set(
                (r.tech_stack || "").split(",").map((t) => t.trim()).filter(Boolean),
            );
            for (const t of result.tech_stack) tech.add(t);
            const techStr = [...tech].sort().join(", ");
            upd.run(
                result.score,
                result.experience_level,
                result.india_friendly,
                result.location_note,
                techStr,
                profileId,
                r.id,
            );
            updated += 1;
        }
    });
    tx();

    res.json({ ok: true, scanned: rows.length, updated, deleted });
});

// ── Parametric profile routes ─────────────────────────────────────────

profilesRouter.get("/profiles/:pid", (req, res) => {
    const pid = parsePid(req.params.pid, res);
    if (pid === null) return;
    const row = getProfile(pid);
    if (!row) {
        detail(res, 404, "Profile not found");
        return;
    }
    res.json(row);
});

profilesRouter.post("/profiles", (req, res) => {
    const parsed = profileInputSchema.safeParse(req.body);
    if (!parsed.success) {
        detail(res, 422, parsed.error.message);
        return;
    }
    try {
        const pid = createProfile(parsed.data.name, parsed.data.config, parsed.data.description);
        res.json({ id: pid, ok: true });
    } catch (err) {
        detail(res, 400, String(err));
    }
});

profilesRouter.put("/profiles/:pid", (req, res) => {
    const pid = parsePid(req.params.pid, res);
    if (pid === null) return;
    if (!getProfile(pid)) {
        detail(res, 404, "Profile not found");
        return;
    }
    const parsed = profileInputSchema.safeParse(req.body);
    if (!parsed.success) {
        detail(res, 422, parsed.error.message);
        return;
    }
    updateProfile(pid, { config: parsed.data.config, name: parsed.data.name, description: parsed.data.description });
    res.json({ ok: true });
});

profilesRouter.post("/profiles/:pid/activate", (req, res) => {
    const pid = parsePid(req.params.pid, res);
    if (pid === null) return;
    try {
        activateProfile(pid);
    } catch (err) {
        detail(res, 404, String(err));
        return;
    }
    res.json({ ok: true, active: pid, queries: queriesCountFor(pid) });
});

profilesRouter.post("/profiles/:pid/duplicate", (req, res) => {
    const pid = parsePid(req.params.pid, res);
    if (pid === null) return;
    try {
        const newId = duplicateProfile(pid, toStr(req.query.name) ?? undefined);
        res.json({ ok: true, id: newId });
    } catch (err) {
        detail(res, 404, String(err));
    }
});

profilesRouter.delete("/profiles/:pid", (req, res) => {
    const pid = parsePid(req.params.pid, res);
    if (pid === null) return;
    try {
        deleteProfile(pid);
        res.json({ ok: true });
    } catch (err) {
        detail(res, 400, String(err));
    }
});

profilesRouter.get("/profiles/:pid/export", (req, res) => {
    const pid = parsePid(req.params.pid, res);
    if (pid === null) return;
    try {
        const yamlText = exportProfile(pid);
        res.type("application/x-yaml").send(yamlText);
    } catch (err) {
        detail(res, 404, String(err));
    }
});

// ── Search queries (stored on the active profile) ─────────────────────

profilesRouter.get("/search-queries", (_req, res) => {
    res.json({ queries: getActiveProfileQueries() });
});

profilesRouter.post("/search-queries", (req, res) => {
    const parsed = queryInputSchema.safeParse(req.body);
    if (!parsed.success) {
        detail(res, 422, parsed.error.message);
        return;
    }
    try {
        const qid = addActiveProfileQuery(
            parsed.data.query,
            parsed.data.country,
            parsed.data.date_posted,
            parsed.data.remote_jobs_only,
        );
        res.json({ id: qid, ok: true });
    } catch (err) {
        detail(res, 400, String(err));
    }
});

profilesRouter.patch("/search-queries/:qid", (req, res) => {
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
        updateActiveProfileQuery(qid, parsed.data);
        res.json({ ok: true });
    } catch (err) {
        detail(res, 400, String(err));
    }
});

profilesRouter.delete("/search-queries/:qid", (req, res) => {
    const qid = Number.parseInt(String(req.params.qid), 10);
    if (Number.isNaN(qid)) {
        detail(res, 422, "query id must be an integer");
        return;
    }
    try {
        deleteActiveProfileQuery(qid);
        res.json({ ok: true });
    } catch (err) {
        detail(res, 400, String(err));
    }
});
