import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import path from "node:path";

// Mock every integration before importing the server: no real database, SMTP,
// collection, Hunter, or Sheets requests are allowed in these tests.
const { env } = await import("../src/config/env.js");
const originalEnv = { ...env };
Object.assign(env, {
    DATABASE_URL: "",
    SENDER_EMAIL: "sender@example.test",
    SENDER_APP_PASSWORD: "",
    RECIPIENT_EMAIL: "recipient@example.test",
    HUNTER_API_KEY: "",
    RAPIDAPI_KEY: "",
    GOOGLE_SHEET_ID: "test-sheet",
    DAILY_EMAIL_HOUR: 9,
});
const { defaultConfig } = await import("../src/db/profile.js");
const config = defaultConfig();
const profile = { ...config, _id: 1, _name: "Test" };
const job = { id: "job-1", title: "Backend Engineer", company: "Test", location: "Remote" };
const company = { id: "company-1", name: "Test", crawl_status: "active", last_crawled: "" };
const collection = { fetched: 1, new: 1, updated: 0, filtered_out: 0, sources: {} };

const getJobs = mock(async (_filters?: unknown) => [job]);
const getJobById = mock(async (_id: string): Promise<unknown> => job);
const updateJobStatus = mock(async (_id: string, _status: string) => { });
const updateOutreachNotes = mock(async (_id: string, _notes: string) => { });
const createProfile = mock(async (_name: string, _config: unknown, _description: string) => 1);
const runCollection = mock(async (_includeCompanies?: boolean) => ({ ...collection }));
const generateOutreach = mock(async (..._args: unknown[]) => 2);
const runPipeline = mock(async (_send: boolean): Promise<unknown> => ({ outreach_generated: 2 }));
const sendDigest = mock(async (_limit?: number, dryRun?: boolean) => ({ sent: 0, dry_run: dryRun }));
const logError = mock((_message: unknown) => { });

mock.module("../src/config/logger.js", () => ({ logger: { info: () => { }, warn: () => { }, error: logError } }));
mock.module("../src/db/connection.js", () => ({
    query: mock(async () => ({ rows: [], rowCount: 0 })),
    queryOne: mock(async () => undefined),
    param: (params: unknown[], value: unknown) => { params.push(value); return `$${params.length}`; },
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => fn({}),
    initSchema: mock(async () => { }),
    closePool: mock(async () => { }),
}));
mock.module("../src/db/repo.js", () => ({
    getJobs,
    getJobById,
    getMarkedJobs: async () => [job],
    getSources: async () => ["test"],
    getStats: async () => ({ total: 1 }),
    toggleMarkForEmail: async () => true,
    updateJobStatus,
    getCompanies: async () => [company],
    getCompanyById: async () => company,
    getCompanyStats: async () => ({ total: 1 }),
    updateCompanyCrawlStatus: async () => { },
    upsertCompany: async () => true,
    getOutreach: async () => [],
    getOutreachStats: async () => ({}),
    getLastOutreachBatchAt: async () => null,
    deleteOutreachBulk: async (ids: string[]) => ids.length,
    updateOutreachStatus: async () => { },
    updateOutreachNotes,
    getApiUsage: async () => ({ month: 1, today: 1, total: 1 }),
    getEmailLogs: async () => [],
}));
mock.module("../src/db/profile.js", () => ({
    getActiveProfile: async () => profile,
    getProfile: async () => ({ id: 1, name: "Test", config }),
    listProfiles: async () => [],
    listPresets: () => [],
    importPreset: async () => 1,
    createProfile,
    updateProfile: async () => { },
    activateProfile: async () => { },
    deleteProfile: async () => { },
    duplicateProfile: async () => 2,
    exportProfile: async () => "name: Test\nschema_version: 1\n",
    getActiveProfileQueries: async () => [],
    addActiveProfileQuery: async () => 0,
    updateActiveProfileQuery: async () => { },
    deleteActiveProfileQuery: async () => { },
    ensureFirstRunSeed: async () => null,
    refreshActiveProfile: async () => profile,
}));
mock.module("../src/sources/collector.js", () => ({ runCollection, runCompanyCrawl: async () => collection }));
mock.module("../src/email/emailer.js", () => ({
    generateOutreachForTopJobs: generateOutreach,
    runDailyPipeline: runPipeline,
    sendDailyDigest: sendDigest,
}));
mock.module("../src/email/sheets.js", () => ({
    exportToSheet: async () => ({ exported: 1 }),
    sheetsConfig: () => ({ sheetId: "test-sheet", credsPath: "unused.json", credsExists: true }),
}));

const { createServer } = await import("../src/server.js");
const { apiRoutes } = await import("../src/routes/index.js");
const { startScheduler, stopScheduler } = await import("../src/scheduler/index.js");
const { getQuery, readJson } = await import("../src/routes/util.js");
let server: Bun.Server<undefined>;

beforeAll(() => { server = createServer({ hostname: "127.0.0.1", port: 0 }); });
afterAll(async () => {
    await stopScheduler();
    await server.stop(true);
    Object.assign(env, originalEnv);
    mock.restore();
});
beforeEach(() => {
    getJobs.mockClear();
    getJobById.mockClear();
    updateJobStatus.mockClear();
    createProfile.mockClear();
    generateOutreach.mockClear();
    runCollection.mockClear();
    runPipeline.mockClear();
    sendDigest.mockClear();
    logError.mockClear();
});

function request(url: string, method = "GET", body?: unknown): Promise<Response> {
    return fetch(new URL(url, server.url), {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

// Every pre-migration route/method must remain reachable. All writes hit mocks.
const cases: Array<[string, string, unknown?]> = [
    ["GET", "/api/jobs"], ["GET", "/api/jobs/marked"], ["GET", "/api/jobs/job-1"],
    ["PATCH", "/api/jobs/job-1/status?status=reviewed"], ["POST", "/api/jobs/job-1/mark-for-email"],
    ["GET", "/api/stats"], ["GET", "/api/sources"], ["POST", "/api/collect"],
    ["GET", "/api/companies"], ["GET", "/api/companies/stats"],
    ["POST", "/api/companies", { name: "Test" }],
    ["PATCH", "/api/companies/company-1", { name: "Updated" }],
    ["DELETE", "/api/companies/company-1"], ["POST", "/api/companies/company-1/activate"],
    ["POST", "/api/companies/seed"], ["POST", "/api/companies/mega-seed"],
    ["POST", "/api/companies/crawl"], ["POST", "/api/companies/company-1/crawl"],
    ["POST", "/api/companies/detect-ats"], ["POST", "/api/companies/discover"],
    ["GET", "/api/outreach"], ["GET", "/api/outreach/stats"],
    ["POST", "/api/outreach/bulk-delete", { ids: ["outreach-1"] }],
    ["POST", "/api/outreach/refresh"], ["POST", "/api/outreach/generate"],
    ["PATCH", "/api/outreach/outreach-1/status?status=messaged"],
    ["PATCH", "/api/outreach/outreach-1/notes?notes=Hello"],
    ["POST", "/api/email/send-now"], ["POST", "/api/email/run-pipeline"], ["POST", "/api/run-now"],
    ["GET", "/api/email/status"], ["GET", "/api/jsearch/status"], ["GET", "/api/hunter/status"],
    ["POST", "/api/export/sheets"], ["GET", "/api/export/sheets/status"],
    ["GET", "/api/profiles"], ["GET", "/api/profiles/active"],
    ["POST", "/api/profiles/import", { preset_slug: "backend_python" }],
    ["POST", "/api/profiles/rescore-all"], ["GET", "/api/profiles/1"],
    ["POST", "/api/profiles", { name: "Test", config: {} }],
    ["PUT", "/api/profiles/1", { name: "Test", config: {} }],
    ["POST", "/api/profiles/1/activate"], ["POST", "/api/profiles/1/duplicate"],
    ["DELETE", "/api/profiles/1"], ["GET", "/api/profiles/1/export"],
    ["GET", "/api/search-queries"], ["POST", "/api/search-queries", { query: "backend" }],
    ["PATCH", "/api/search-queries/0", { enabled: false }], ["DELETE", "/api/search-queries/0"],
];

describe("native HTTP routing", () => {
    test("retains all 50 method handlers", () => {
        expect(Object.values(apiRoutes).reduce((count, methods) => count + Object.keys(methods).length, 0)).toBe(50);
        expect(cases).toHaveLength(50);
    });

    for (const [method, url, body] of cases) {
        test(`${method} ${url}`, async () => {
            const response = await request(url, method, body);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain(url.endsWith("/export") ? "application/x-yaml" : "application/json");
            await response.text();
        });
    }

    test("preserves query decoding, defaults, and bounds", async () => {
        await (await request("/api/jobs?search=Go%20%26%20Node&min_score=999&limit=999&offset=-5")).text();
        expect(getJobs).toHaveBeenLastCalledWith(expect.objectContaining({
            search: "Go & Node", min_score: 100, limit: 500, offset: 0,
        }));
    });

    test("static paths take precedence over job/profile parameters", async () => {
        const marked = await request("/api/jobs/marked");
        expect(await marked.json()).toEqual({ jobs: [job] });
        expect(getJobById).not.toHaveBeenCalled();
        const active = await request("/api/profiles/active");
        expect(await active.json()).toMatchObject({ id: 1, name: "Test" });
    });

    test("decodes route parameters and preserves status query parameters", async () => {
        await (await request("/api/jobs/job%20one/status?status=applied", "PATCH")).text();
        expect(updateJobStatus).toHaveBeenLastCalledWith("job one", "applied");
    });

    test("keeps legacy missing-job response", async () => {
        getJobById.mockResolvedValueOnce(undefined);
        const response = await request("/api/jobs/missing");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ error: "Job not found" });
    });

    test("forwards valid JSON to profile creation", async () => {
        await (await request("/api/profiles", "POST", { name: "New", description: "Example", config: {} })).text();
        expect(createProfile).toHaveBeenLastCalledWith("New", {}, "Example");
    });

    for (const [url, method, body] of [
        ["/api/profiles", "POST", {}], ["/api/companies", "POST", {}],
        ["/api/outreach/bulk-delete", "POST", {}], ["/api/profiles/import", "POST", {}],
        ["/api/jobs/job-1/status", "PATCH", undefined], ["/api/outreach/outreach-1/status", "PATCH", undefined],
        ["/api/profiles/not-a-number", "GET", undefined], ["/api/search-queries/not-a-number", "DELETE", undefined],
    ] as const) {
        test(`validation: ${method} ${url}`, async () => {
            const response = await request(url, method, body);
            expect(response.status).toBe(422);
            expect(await response.json()).toHaveProperty("detail");
        });
    }

    test("malformed JSON returns 400 without invoking the handler's integration", async () => {
        const response = await fetch(new URL("/api/profiles", server.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ detail: "Invalid JSON body" });
        expect(createProfile).not.toHaveBeenCalled();
    });

    test("enforces the 100 KiB request limit", async () => {
        const response = await request("/api/profiles", "POST", { name: "x".repeat(110 * 1024), config: {} });
        expect(response.status).toBe(413);
        await response.text();
        expect(createProfile).not.toHaveBeenCalled();
    });

    test("async failures use the JSON error handler", async () => {
        getJobs.mockRejectedValueOnce(new Error("simulated database failure"));
        const response = await request("/api/jobs");
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ detail: "Error: simulated database failure" });
        expect(logError).toHaveBeenCalledTimes(1);
    });

    test("collection can skip outreach and otherwise passes its run cutoff", async () => {
        await (await request("/api/collect?generate_outreach=false", "POST")).text();
        expect(generateOutreach).not.toHaveBeenCalled();
        await (await request("/api/collect", "POST")).text();
        expect(generateOutreach).toHaveBeenLastCalledWith(15, 40, "maybe", expect.any(String));
    });

    test("dry-run aliases never request email delivery", async () => {
        await (await request("/api/run-now?dryRun=true", "POST")).text();
        expect(runPipeline).toHaveBeenLastCalledWith(false);
        await (await request("/api/email/run-pipeline?send=false", "POST")).text();
        expect(runPipeline).toHaveBeenLastCalledWith(false);
        await (await request("/api/email/send-now?dry_run=true", "POST")).text();
        expect(sendDigest).toHaveBeenLastCalledWith(undefined, true);
    });

    for (const url of ["/", "/outreach", "/profile"]) {
        test(`serves legacy page ${url} with GET and HEAD`, async () => {
            const response = await request(url);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("text/html");
            expect((await response.text()).toLowerCase()).toContain("<!doctype html>");
            const head = await request(url, "HEAD");
            expect(head.status).toBe(200);
            expect(await head.text()).toBe("");
        });
    }

    test("serves static assets with MIME types and handles missing paths", async () => {
        const response = await request("/static/style.css");
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/css");
        expect(await response.text()).toBe(await Bun.file(path.join(env.PUBLIC_DIR, "static", "style.css")).text());
        for (const url of ["/static/missing.css", "/static/..%2f..%2fpackage.json", "/missing", "/api/missing"]) {
            const missing = await request(url);
            expect(missing.status).toBe(404);
            await missing.text();
        }
    });

    test("unsupported methods do not execute a GET handler", async () => {
        const response = await request("/api/jobs", "DELETE");
        expect([404, 405]).toContain(response.status);
        expect(getJobs).not.toHaveBeenCalled();
        await response.text();
    });
});

describe("request helpers", () => {
    test("preserves repeated query values without prototype pollution", () => {
        const result = getQuery(new Request("http://localhost/?tech=go&tech=node&__proto__=safe"));
        expect(result.tech).toEqual(["go", "node"]);
        expect(result.__proto__).toBe("safe");
        expect(Object.getPrototypeOf(result)).toBeNull();
    });
    test("empty/non-JSON bodies keep the empty-object default", async () => {
        expect(await readJson(new Request("http://localhost", { method: "POST" }))).toEqual({});
        expect(await readJson(new Request("http://localhost", { method: "POST", body: "text" }))).toEqual({});
    });
    test("strict JSON rejects primitives", async () => {
        const req = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
        await expect(readJson(req)).rejects.toThrow("Invalid JSON body");
    });
});

async function advanceClock(milliseconds: number): Promise<void> {
    jest.advanceTimersByTime(milliseconds);
    // Let the pipeline's then/catch/finally chain and Bun's rescheduling settle.
    for (let index = 0; index < 10; index++) await Promise.resolve();
}

describe("native Bun cron", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-11-12T03:29:00Z"));
        Object.assign(env, { SENDER_EMAIL: "sender@example.test" });
    });
    afterEach(async () => {
        await stopScheduler();
        jest.useRealTimers();
    });

    test("uses 09:00 Asia/Kolkata independent of the server timezone", () => {
        expect(Bun.cron.parse("0 9 * * *", new Date("2026-11-12T00:00:00Z"), { tz: "Asia/Kolkata" })?.toISOString())
            .toBe("2026-11-12T03:30:00.000Z");
    });
    test("disabled without a sender", async () => {
        Object.assign(env, { SENDER_EMAIL: "" });
        startScheduler();
        await advanceClock(60_000);
        expect(runPipeline).not.toHaveBeenCalled();
    });
    test("starts once, fires at IST time, and stops cleanly", async () => {
        startScheduler();
        startScheduler();
        await advanceClock(60_000);
        expect(runPipeline).toHaveBeenCalledTimes(1);
        expect(runPipeline).toHaveBeenCalledWith(true);
        await stopScheduler();
        await advanceClock(86_400_000);
        expect(runPipeline).toHaveBeenCalledTimes(1);
    });
    test("logs pipeline failures and continues scheduling", async () => {
        runPipeline.mockRejectedValueOnce(new Error("simulated pipeline failure"));
        startScheduler();
        await advanceClock(60_000);
        expect(logError).toHaveBeenCalledTimes(1);
        await advanceClock(86_400_000);
        expect(runPipeline).toHaveBeenCalledTimes(2);
    });
    test("prevents overlapping cron runs and drains a running pipeline", async () => {
        let finish!: (value: unknown) => void;
        runPipeline.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        startScheduler();
        await advanceClock(60_000);
        await advanceClock(86_400_000);
        expect(runPipeline).toHaveBeenCalledTimes(1);
        let drained = false;
        const stopping = stopScheduler().then(() => { drained = true; });
        await Promise.resolve();
        expect(drained).toBe(false);
        finish({});
        await stopping;
        expect(drained).toBe(true);
    });
});
