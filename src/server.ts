import path from "node:path";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { closePool, initSchema } from "./db/connection.js";
import { ensureFirstRunSeed, refreshActiveProfile } from "./db/profile.js";
import { startScheduler, stopScheduler } from "./scheduler/index.js";
import { apiRoutes } from "./routes/index.js";
import { detail, HttpError } from "./routes/util.js";

// Native Bun HTTP server and in-process cron share the PostgreSQL pool and
// active-profile cache. Importing this module never starts either service.

const TEMPLATES_DIR = path.join(env.PUBLIC_DIR, "templates");

async function sendTemplate(file: string): Promise<Response> {
    const content = Bun.file(path.join(TEMPLATES_DIR, file));
    if (!(await content.exists())) {
        return new Response(`${file} not found — did you copy the frontend into public/?`, { status: 404 });
    }
    return new Response(content, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Start HTTP only; bootstrap owns database initialization and scheduling. */
export function createServer(options: { hostname?: string; port?: number } = {}): Bun.Server<undefined> {
    return Bun.serve({
        hostname: options.hostname ?? env.HOST,
        port: options.port ?? env.PORT,
        // Collection/export requests can take minutes without sending a response.
        idleTimeout: 0,
        maxRequestBodySize: 100 * 1024,
        routes: {
            ...apiRoutes,
            "/": { GET: () => sendTemplate("dashboard.html") },
            "/outreach": { GET: () => sendTemplate("outreach.html") },
            "/profile": { GET: () => sendTemplate("profile.html") },
            "/static/*": { dir: path.join(env.PUBLIC_DIR, "static") },
        },
        fetch() {
            return detail(404, "Not found");
        },
        error(err) {
            if (err instanceof HttpError) return detail(err.status, err.message);
            logger.error(`Unhandled request error: ${String(err)}`);
            return detail(500, String(err));
        },
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
