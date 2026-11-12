import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { closePool, initSchema } from "./infrastructure/database/connection.js";
import { ensureFirstRunSeed, refreshActiveProfile } from "./modules/profiles/profiles.service.js";
import { startScheduler, stopScheduler } from "./modules/automation/automation.scheduler.js";
import { apiRoutes } from "./app/routes.js";
import { bindRoutes } from "./common/http/route.js";
import { readBody } from "./common/http/request.js";
import { AppError } from "./common/errors/app-error.js";
import { errorResponse } from "./common/errors/error-handler.js";

// Native Bun HTTP server and in-process cron share the PostgreSQL pool and
// active-profile cache. Importing this module never starts either service.

/** Start HTTP only; bootstrap owns database initialization and scheduling. */
export function createServer(options: { hostname?: string; port?: number } = {}): Bun.Server<undefined> {
    return Bun.serve({
        hostname: options.hostname ?? env.HOST,
        port: options.port ?? env.PORT,
        // Collection/export requests can take minutes without sending a response.
        idleTimeout: 0,
        // The bounded streaming guard enforces 100 KiB and returns JSON on 413.
        // Bun's built-in rejection bypasses the application error handler.
        maxRequestBodySize: Infinity,
        routes: bindRoutes(apiRoutes),
        async fetch(req) {
            await readBody(req);
            throw new AppError("ROUTE_NOT_FOUND");
        },
        error: errorResponse,
    });
}

export async function bootstrap(): Promise<void> {
    await initSchema();
    const seeded = await ensureFirstRunSeed();
    if (seeded !== null) logger.info(`First run: seeded + activated legacy profile #${seeded}`);
    // Warm the read-through cache so sync scorers never see a cold profile.
    await refreshActiveProfile();

    const server = createServer();
    try {
        startScheduler();
    } catch (err) {
        await server.stop(true);
        await closePool();
        throw err;
    }
    logger.info(`Job Finder listening on ${server.url}`);

    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`${signal} received — stopping cron and draining requests`);
        try {
            // Stop accepting new work, then wait for HTTP and any running digest.
            await Promise.all([stopScheduler(), server.stop()]);
            await closePool();
            process.exit(0);
        } catch (err) {
            logger.error(`Shutdown failed: ${String(err)}`);
            process.exit(1);
        }
    };
    process.once("SIGINT", () => { void shutdown("SIGINT"); });
    process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
}

// Run when executed directly (not when imported by a test/tool). Bun exposes
// this natively, so no argv/path sniffing is needed.
if (import.meta.main) {
    bootstrap().catch((err: unknown) => {
        logger.error(`Bootstrap failed: ${String(err)}`);
        process.exit(1);
    });
}
