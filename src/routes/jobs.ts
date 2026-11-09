import { Router } from "express";
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
import { detail, toBool, toInt, toStr } from "./util.js";

// ── Jobs API ─────────────────────────────────────
export const jobsRouter = Router();

jobsRouter.get("/jobs", (req, res) => {
    const q = req.query;
    const jobs = getJobs({
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
    res.json({ jobs, count: jobs.length });
});

// Marked list is a static path — register before the "/jobs/:jobId" param route.
jobsRouter.get("/jobs/marked", (_req, res) => {
    res.json({ jobs: getMarkedJobs() });
});

jobsRouter.get("/jobs/:jobId", (req, res) => {
    const job = getJobById(req.params.jobId as string);
    if (!job) {
        res.json({ error: "Job not found" });
        return;
    }
    res.json(job);
});

jobsRouter.patch("/jobs/:jobId/status", (req, res) => {
    const status = toStr(req.query.status);
    if (!status) {
        detail(res, 422, "status query parameter is required");
        return;
    }
    updateJobStatus(req.params.jobId as string, status);
    res.json({ ok: true });
});

jobsRouter.post("/jobs/:jobId/mark-for-email", (req, res) => {
    const newState = toggleMarkForEmail(req.params.jobId as string);
    res.json({ mark_for_email: newState });
});

jobsRouter.get("/stats", (_req, res) => {
    res.json(getStats());
});

jobsRouter.get("/sources", (_req, res) => {
    res.json({ sources: getSources() });
});

jobsRouter.post("/collect", async (req, res) => {
    const generate = toBool(req.query.generate_outreach, true);
    // Cutoff is captured before collection so outreach only sees this run's jobs.
    const cutoff = utcNowIso();
    const stats = await runCollection(true);
    if (generate) {
        stats.outreach_generated = generateOutreachForTopJobs(15, 40, "maybe", cutoff);
    }
    res.json(stats);
});
