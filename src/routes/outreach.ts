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
import { detail, toInt, toStr, getQuery, readJson } from "./util.js";

// ── Outreach API ─────────────────────────────

export const outreachRoutes = {
    "/api/outreach": {
        GET: async (req) => {
            const q = getQuery(req);
            const batchRaw = toStr(q.batch);
            const batch = batchRaw === "new" || batchRaw === "old" ? batchRaw : null;
            const items = await getOutreach({
                status: toStr(q.status),
                search: toStr(q.search),
                batch,
                limit: toInt(q.limit, 100, 1, 500),
                offset: toInt(q.offset, 0, 0),
            });
            return Response.json({
                outreach: items,
                count: items.length,
                last_batch_at: await getLastOutreachBatchAt(),
            });
        },
    },
    "/api/outreach/stats": {
        GET: async (_req) => {
            return Response.json(await getOutreachStats());
        },
    },
    "/api/outreach/bulk-delete": {
        POST: async (req) => {
            const parsed = outreachBulkDeleteSchema.safeParse(await readJson(req));
            if (!parsed.success) {
                return detail(422, parsed.error.message);
            }
            return Response.json({ deleted: await deleteOutreachBulk(parsed.data.ids) });
        },
    },
    "/api/outreach/refresh": {
        POST: async (req) => {
            const limit = toInt(getQuery(req).limit, 15, 1, 50);
            const minScore = toInt(getQuery(req).min_score, 40, 0, 100);
            const cutoff = utcNowIso();
            const collected = await runCollection(true);
            const generated = await generateOutreachForTopJobs(limit, minScore, "maybe", cutoff);
            return Response.json({ collected, generated });
        },
    },
    "/api/outreach/generate": {
        POST: async (req) => {
            const minScore = toInt(getQuery(req).min_score, 40, 0, 100);
            const limit = toInt(getQuery(req).limit, 15, 1, 50);
            const indiaFriendly = toStr(getQuery(req).india_friendly) ?? "maybe";
            const generated = await generateOutreachForTopJobs(limit, minScore, indiaFriendly, null);
            if (generated === 0) {
                return Response.json({ generated: 0, message: "No new jobs eligible for outreach" });
            }
            return Response.json({ generated });
        },
    },
    "/api/outreach/:outreachId/status": {
        PATCH: async (req) => {
            const status = toStr(getQuery(req).status);
            if (!status) {
                return detail(422, "status query parameter is required");
            }
            const fieldMap: Record<string, string> = {
                messaged: "messaged",
                replied: "replied",
                followed_up: "followed_up",
            };
            await updateOutreachStatus(req.params.outreachId as string, status, fieldMap[status]);
            return Response.json({ ok: true });
        },
    },
    "/api/outreach/:outreachId/notes": {
        PATCH: async (req) => {
            await updateOutreachNotes(req.params.outreachId as string, toStr(getQuery(req).notes) ?? "");
            return Response.json({ ok: true });
        },
    },
} satisfies Bun.Serve.Routes<undefined, string>;
