import cron from "node-cron";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { runDailyPipeline } from "../email/emailer.js";

// The daily digest runs at DAILY_EMAIL_HOUR:00 in the Asia/Kolkata timezone,
// but only when SENDER_EMAIL is configured. node-cron's `tz` option anchors
// the job to IST.

let started = false;

/** Register the daily digest cron (no-op when SENDER_EMAIL is not configured). */
export function startScheduler(): void {
    if (started) return;

    if (!env.SENDER_EMAIL) {
        logger.info("SENDER_EMAIL not set in .env — daily digest disabled");
        return;
    }

    const expr = `0 ${env.DAILY_EMAIL_HOUR} * * *`;
    cron.schedule(
        expr,
        () => {
            runDailyPipeline(true).catch((err: unknown) =>
                logger.error(`Scheduled daily pipeline failed: ${String(err)}`),
            );
        },
        { timezone: env.DAILY_EMAIL_TIMEZONE },
    );
    started = true;
    logger.info(`Scheduled daily digest at ${env.DAILY_EMAIL_HOUR}:00 ${env.DAILY_EMAIL_TIMEZONE}`);
}
