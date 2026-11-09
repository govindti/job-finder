import path from "node:path";
import express from "express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { closePool, initSchema } from "./db/connection.js";
import { ensureFirstRunSeed, refreshActiveProfile } from "./db/profile.js";
import { startScheduler } from "./scheduler/index.js";
import { apiRouter } from "./routes/index.js";

// Express bootstrap: init the PostgreSQL schema, seed the starter profile on
// first run, warm the active-profile cache, mount the /api router + static
// assets + HTML pages, then start the IST daily-digest scheduler and listen.

const TEMPLATES_DIR = path.join(env.PUBLIC_DIR, "templates");

function sendTemplate(res: express.Response, file: string): void {
    res.sendFile(path.join(TEMPLATES_DIR, file), (err) => {
        if (err && !res.headersSent) res.status(404).send(`${file} not found — did you copy the frontend into public/?`);
    });
}

export function createApp(): express.Express {
    const app = express();
    app.use(express.json());

    // API routes.
    app.use("/api", apiRouter);

    // Static assets (static/app.js, style.css, ... copied into public/static).
    app.use("/static", express.static(path.join(env.PUBLIC_DIR, "static")));

    // HTML pages.
    app.get("/", (_req, res) => sendTemplate(res, "dashboard.html"));
    app.get("/outreach", (_req, res) => sendTemplate(res, "outreach.html"));
    app.get("/profile", (_req, res) => sendTemplate(res, "profile.html"));

    // Terminal error handler: async route handlers forward rejections here via
    // asyncHandler(), so a database error becomes a JSON 500 instead of a hang.
    app.use(
        (
            err: unknown,
            _req: express.Request,
            res: express.Response,
            _next: express.NextFunction,
        ) => {
            logger.error(`Unhandled request error: ${String(err)}`);
            if (!res.headersSent) res.status(500).json({ detail: String(err) });
        },
    );

    return app;
}

export async function bootstrap(): Promise<void> {
    await initSchema();
    const seeded = await ensureFirstRunSeed();
    if (seeded !== null) logger.info(`First run: seeded + activated legacy profile #${seeded}`);
    // Warm the read-through cache so sync scorers never see a cold profile.
    await refreshActiveProfile();

    startScheduler();

    const app = createApp();
    const server = app.listen(env.PORT, env.HOST, () => {
        logger.info(`Job Finder listening on http://${env.HOST}:${env.PORT}`);
    });

    const shutdown = (signal: NodeJS.Signals): void => {
        logger.info(`${signal} received — closing the server`);
        server.close(() => {
            void closePool().finally(() => process.exit(0));
        });
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

// Run when executed directly (not when imported by a test/tool). Bun exposes
// this natively, so no argv/path sniffing is needed.
if (import.meta.main) {
    bootstrap().catch((err: unknown) => {
        logger.error(`Bootstrap failed: ${String(err)}`);
        process.exit(1);
    });
}
