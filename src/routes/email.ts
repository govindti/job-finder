import { Router } from "express";
import { env } from "../config/env.js";
import { getActiveProfile } from "../db/profile.js";
import { getApiUsage, getEmailLogs } from "../db/repo.js";
import { runDailyPipeline, sendDailyDigest } from "../email/emailer.js";
import { asyncHandler, toBool } from "./util.js";

// ── Email digest + API-status routes ────────────────────────
export const emailRouter = Router();

emailRouter.post(
    "/email/send-now",
    asyncHandler(async (req, res) => {
        const dryRun = toBool(req.query.dry_run, false);
        res.json(await sendDailyDigest(undefined, dryRun));
    }),
);

emailRouter.post(
    "/email/run-pipeline",
    asyncHandler(async (req, res) => {
        const send = toBool(req.query.send, true);
        res.json(await runDailyPipeline(send));
    }),
);

// Convenience alias: dryRun=true → collect + generate
// outreach but skip the email send; otherwise run the full pipeline.
emailRouter.post(
    "/run-now",
    asyncHandler(async (req, res) => {
        const dryRun = toBool(req.query.dryRun, false);
        res.json(await runDailyPipeline(!dryRun));
    }),
);

emailRouter.get(
    "/email/status",
    asyncHandler(async (_req, res) => {
        const logs = await getEmailLogs(10);
        const out = (await getActiveProfile()).outreach ?? {};
        const profileRecipient = (out.recipient_email || "").trim();
        const envRecipient = env.RECIPIENT_EMAIL;
        const effectiveRecipient = profileRecipient || envRecipient;
        res.json({
            sender_configured: Boolean(env.SENDER_EMAIL) && Boolean(env.SENDER_APP_PASSWORD),
            sender: env.SENDER_EMAIL,
            sender_source: env.SENDER_EMAIL ? "env" : "none",
            recipient: effectiveRecipient,
            recipient_source: profileRecipient ? "profile" : envRecipient ? "env" : "none",
            candidate_name: out.candidate_name || "",
            scheduled_hour: env.DAILY_EMAIL_HOUR,
            timezone: env.DAILY_EMAIL_TIMEZONE,
            recent_sends: logs,
        });
    }),
);

emailRouter.get(
    "/jsearch/status",
    asyncHandler(async (_req, res) => {
        const usage = await getApiUsage("jsearch");
        const monthlyLimit = 200;
        res.json({
            configured: Boolean(env.RAPIDAPI_KEY),
            month: usage.month,
            today: usage.today,
            total: usage.total,
            monthly_limit: monthlyLimit,
            remaining: Math.max(0, monthlyLimit - usage.month),
        });
    }),
);

emailRouter.get("/hunter/status", async (_req, res) => {
    if (!env.HUNTER_API_KEY) {
        res.json({ configured: false });
        return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const resp = await fetch(
            `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(env.HUNTER_API_KEY)}`,
            { signal: controller.signal },
        );
        const data = (await resp.json()) as { data?: Record<string, unknown> };
        if (data.data) {
            const requests = (data.data.requests ?? {}) as { used?: number; available?: number };
            res.json({
                configured: true,
                plan: String(data.data.plan_name ?? ""),
                used: requests.used ?? 0,
                available: requests.available ?? 0,
            });
            return;
        }
        res.json({ configured: true, error: "could not fetch stats" });
    } catch (err) {
        res.json({ configured: true, error: String(err) });
    } finally {
        clearTimeout(timer);
    }
});
