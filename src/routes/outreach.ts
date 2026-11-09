import { Router } from "express";
import {
    deleteOutreachBulk,
    getLastOutreachBatchAt,
    getOutreach,
    getOutreachStats,
    updateOutreachNotes,
    updateOutreachStatus,
} from "../db/repo.js";
import { generateOutreachForTopJobs } from "../email/emailer.js";
import { runCollection } from "../sources/collector.js";
import { utcNowIso } from "../utils/models.js";
import { outreachBulkDeleteSchema } from "../schemas/api.js";
import { detail, toInt, toStr } from "./util.js";

// ── Outreach API ─────────────────────────────
export const outreachRouter = Router();

outreachRouter.get("/outreach", (req, res) => {
    const q = req.query;
    const batchRaw = toStr(q.batch);
    const batch = batchRaw === "new" || batchRaw === "old" ? batchRaw : null;
    const items = getOutreach({
        status: toStr(q.status),
        search: toStr(q.search),
        batch,
        limit: toInt(q.limit, 100, 1, 500),
        offset: toInt(q.offset, 0, 0),
    });
    res.json({ outreach: items, count: items.length, last_batch_at: getLastOutreachBatchAt() });
});

outreachRouter.get("/outreach/stats", (_req, res) => {
    res.json(getOutreachStats());
});

outreachRouter.post("/outreach/bulk-delete", (req, res) => {
    const parsed = outreachBulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
        detail(res, 422, parsed.error.message);
        return;
    }
    res.json({ deleted: deleteOutreachBulk(parsed.data.ids) });
});

outreachRouter.post("/outreach/refresh", async (req, res) => {
    const limit = toInt(req.query.limit, 15, 1, 50);
    const minScore = toInt(req.query.min_score, 40, 0, 100);
    const cutoff = utcNowIso();
    const collected = await runCollection(true);
    const generated = generateOutreachForTopJobs(limit, minScore, "maybe", cutoff);
    res.json({ collected, generated });
});

outreachRouter.post("/outreach/generate", (req, res) => {
    const minScore = toInt(req.query.min_score, 40, 0, 100);
    const limit = toInt(req.query.limit, 15, 1, 50);
    const indiaFriendly = toStr(req.query.india_friendly) ?? "maybe";
    const generated = generateOutreachForTopJobs(limit, minScore, indiaFriendly, null);
    if (generated === 0) {
        res.json({ generated: 0, message: "No new jobs eligible for outreach" });
        return;
    }
    res.json({ generated });
});

outreachRouter.patch("/outreach/:outreachId/status", (req, res) => {
    const status = toStr(req.query.status);
    if (!status) {
        detail(res, 422, "status query parameter is required");
        return;
    }
    const fieldMap: Record<string, string> = {
        messaged: "messaged",
        replied: "replied",
        followed_up: "followed_up",
    };
    updateOutreachStatus(req.params.outreachId as string, status, fieldMap[status]);
    res.json({ ok: true });
});

outreachRouter.patch("/outreach/:outreachId/notes", (req, res) => {
    updateOutreachNotes(req.params.outreachId as string, toStr(req.query.notes) ?? "");
    res.json({ ok: true });
});
