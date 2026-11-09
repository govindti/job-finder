import path from "node:path";
import express from "express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { initSchema } from "./db/connection.js";
import { ensureFirstRunSeed } from "./db/profile.js";
import { startScheduler } from "./scheduler/index.js";
import { apiRouter } from "./routes/index.js";

// Express bootstrap: init the DB schema, seed the starter profile on first
// run, mount the /api router + static assets + HTML pages, then start the IST
// daily-digest scheduler and listen.

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

    return app;
}

export function bootstrap(): void {
    initSchema();
    const seeded = ensureFirstRunSeed();
    if (seeded !== null) logger.info(`First run: seeded + activated legacy profile #${seeded}`);

    startScheduler();

    const app = createApp();
    app.listen(env.PORT, env.HOST, () => {
        logger.info(`Job Finder listening on http://${env.HOST}:${env.PORT}`);
    });
}

// Run when executed directly (not when imported by a test/tool). Bun exposes
// this natively, so no argv/path sniffing is needed.
if (import.meta.main) {
    bootstrap();
}
