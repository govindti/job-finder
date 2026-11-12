import {
    getJobById,
    getJobs,
    getMarkedJobs,
    getSources,
    getStats,
    toggleMarkForEmail,
    updateJobStatus,
} from "../db/repo.js";
import { generateOutreachForTopJobs } from "../email/emailer.js";
import { runCollection } from "../sources/collector.js";
import { utcNowIso } from "../utils/models.js";
import { detail, toBool, toInt, toStr, getQuery } from "./util.js";

// ── Jobs API ─────────────────────────────────────

export const jobsRoutes = {
    "/api/jobs": {
        GET: async (req) => {
            const q = getQuery(req);
            const jobs = await getJobs({
                source: toStr(q.source),
                status: toStr(q.status),
                min_score: toInt(q.min_score, 0, 0, 100),
                search: toStr(q.search),
                location: toStr(q.location),
                tech: toStr(q.tech),
                india_friendly: toStr(q.india_friendly),
                company_domain: toStr(q.company_domain),
                limit: toInt(q.limit, 50, 1, 500),
                offset: toInt(q.offset, 0, 0),
            });
            return Response.json({ jobs, count: jobs.length });
        },
    },
    "/api/jobs/marked": {
        // Bun gives this static path precedence over the jobId parameter route.
        GET: async (_req) => {
            return Response.json({ jobs: await getMarkedJobs() });
        },
    },
    "/api/jobs/:jobId": {
        GET: async (req) => {
            const job = await getJobById(req.params.jobId as string);
            if (!job) {
                return Response.json({ error: "Job not found" });
            }
            return Response.json(job);
        },
    },
    "/api/jobs/:jobId/status": {
        PATCH: async (req) => {
            const status = toStr(getQuery(req).status);
            if (!status) {
                return detail(422, "status query parameter is required");
            }
            await updateJobStatus(req.params.jobId as string, status);
            return Response.json({ ok: true });
        },
    },
    "/api/jobs/:jobId/mark-for-email": {
        POST: async (req) => {
            const newState = await toggleMarkForEmail(req.params.jobId as string);
            return Response.json({ mark_for_email: newState });
        },
    },
    "/api/stats": {
        GET: async (_req) => {
            return Response.json(await getStats());
        },
    },
    "/api/sources": {
        GET: async (_req) => {
            return Response.json({ sources: await getSources() });
        },
    },
    "/api/collect": {
        POST: async (req) => {
            const generate = toBool(getQuery(req).generate_outreach, true);
            // Cutoff is captured before collection so outreach only sees this run's jobs.
            const cutoff = utcNowIso();
            const stats = await runCollection(true);
            if (generate) {
                stats.outreach_generated = await generateOutreachForTopJobs(15, 40, "maybe", cutoff);
            }
            return Response.json(stats);
        },
    },
} satisfies Bun.Serve.Routes<undefined, string>;
