import { env } from "../config/env.js";
import { getActiveProfile } from "../db/profile.js";
import { getApiUsage, getEmailLogs } from "../db/repo.js";
import { runDailyPipeline, sendDailyDigest } from "../email/emailer.js";
import { toBool, getQuery } from "./util.js";

// ── Email digest + API-status routes ────────────────────────

export const emailRoutes = {
    "/api/email/send-now": {
        POST: async (req) => {
            const dryRun = toBool(getQuery(req).dry_run, false);
            return Response.json(await sendDailyDigest(undefined, dryRun));
        },
    },
    "/api/email/run-pipeline": {
        POST: async (req) => {
            const send = toBool(getQuery(req).send, true);
            return Response.json(await runDailyPipeline(send));
        },
    },
    "/api/run-now": {
        // Convenience alias: dryRun=true → collect + generate
        // outreach but skip the email send; otherwise run the full pipeline.
        POST: async (req) => {
            const dryRun = toBool(getQuery(req).dryRun, false);
            return Response.json(await runDailyPipeline(!dryRun));
        },
    },
    "/api/email/status": {
        GET: async (_req) => {
            const logs = await getEmailLogs(10);
            const out = (await getActiveProfile()).outreach ?? {};
            const profileRecipient = (out.recipient_email || "").trim();
            const envRecipient = env.RECIPIENT_EMAIL;
            const effectiveRecipient = profileRecipient || envRecipient;
            return Response.json({
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
        },
    },
    "/api/jsearch/status": {
        GET: async (_req) => {
            const usage = await getApiUsage("jsearch");
            const monthlyLimit = 200;
            return Response.json({
                configured: Boolean(env.RAPIDAPI_KEY),
                month: usage.month,
                today: usage.today,
                total: usage.total,
                monthly_limit: monthlyLimit,
                remaining: Math.max(0, monthlyLimit - usage.month),
            });
        },
    },
    "/api/hunter/status": {
        GET: async (_req) => {
            if (!env.HUNTER_API_KEY) {
                return Response.json({ configured: false });
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
                    return Response.json({
                        configured: true,
                        plan: String(data.data.plan_name ?? ""),
                        used: requests.used ?? 0,
                        available: requests.available ?? 0,
                    });
                }
                return Response.json({ configured: true, error: "could not fetch stats" });
            } catch (err) {
                return Response.json({ configured: true, error: String(err) });
            } finally {
                clearTimeout(timer);
            }
        },
    },
} satisfies Bun.Serve.Routes<undefined, string>;
