import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { runDailyPipeline } from "../email/emailer.js";

// In-process Bun cron shares the server's pool/cache and only runs while the
// server is alive. No OS-level scheduled tasks are installed.

let task: Bun.CronJob | null = null;
let running: Promise<void> | null = null;

/** Register the daily digest cron (no-op when SENDER_EMAIL is not configured). */
export function startScheduler(): void {
    if (task) return;

    if (!env.SENDER_EMAIL) {
        logger.info("SENDER_EMAIL not set in .env — daily digest disabled");
        return;
    }

    const expr = `0 ${env.DAILY_EMAIL_HOUR} * * *`;
    task = Bun.cron(
        expr,
        () => {
            running = runDailyPipeline(true)
                .then(() => { })
                .catch((err: unknown) => {
                    logger.error(`Scheduled daily pipeline failed: ${String(err)}`);
                })
                .finally(() => { running = null; });
            // Returning the promise lets Bun prevent overlapping scheduled runs.
            return running;
        },
        { tz: env.DAILY_EMAIL_TIMEZONE },
    );
    logger.info(`Scheduled daily digest at ${env.DAILY_EMAIL_HOUR}:00 ${env.DAILY_EMAIL_TIMEZONE}`);
}

/** Cancel future fires and let an in-flight pipeline finish before closing the DB. */
export async function stopScheduler(): Promise<void> {
    task?.stop();
    task = null;
    await running;
}
