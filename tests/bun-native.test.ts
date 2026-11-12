import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test";
import { AppError } from "../src/common/errors/app-error.js";
import { ErrorCode } from "../src/common/errors/error-codes.js";
import { request as nodeRequest } from "node:http";

// Mock every integration before importing the server: no real database, SMTP,
// collection, Hunter, or Sheets requests are allowed in these tests.
const { env } = await import("../src/config/env.js");
const originalEnv = { ...env };
Object.assign(env, {
    DATABASE_URL: "",
    SENDER_EMAIL: "sender@example.test",
    SENDER_APP_PASSWORD: "test-only-password",
    RECIPIENT_EMAIL: "recipient@example.test",
    HUNTER_API_KEY: "",
    RAPIDAPI_KEY: "",
    GOOGLE_SHEET_ID: "test-sheet",
    DAILY_EMAIL_HOUR: 9,
});
const { defaultConfig } = await import("../src/modules/profiles/profiles.config.js");
const config = defaultConfig();
const profile = { ...config, _id: 1, _name: "Test" };
const job = { id: "job-1", title: "Backend Engineer", company: "Test", location: "Remote" };
const company = { id: "company-1", name: "Test", crawl_status: "active", last_crawled: "" };
const collection = { fetched: 1, new: 1, updated: 0, filtered_out: 0, sources: {} };

const getJobs = mock(async (_filters?: unknown) => [job]);
const getJobById = mock(async (_id: string): Promise<unknown> => job);
const updateJobStatus = mock(async (_id: string, _status: string) => { });
const updateOutreachNotes = mock(async (_id: string, _notes: string) => { });
const createProfile = mock(async (_name: string, _description: string, _config: unknown, _source: string) => 1);
const profileRow = { id: 1, name: "Test", description: "", source: "custom", config_json: JSON.stringify(config), created_at: "", updated_at: "" };
const readProfileRow = mock(async (id: number): Promise<typeof profileRow | undefined> => ({ ...profileRow, id }));
const readActiveProfileId = mock(async (): Promise<number | null> => 1);
const updateProfileRow = mock(async (..._args: unknown[]) => { });
const getCompanyById = mock(async (_id: string): Promise<unknown> => company);
const upsertCompany = mock(async (..._args: unknown[]) => true);
const getOutreachById = mock(async (_id: string): Promise<unknown> => ({ id: "outreach-1" }));
const getJobsForRescore = mock(async (): Promise<Array<typeof job & { description: string; tech_stack: string }>> => []);
const updateJobScore = mock(async (..._args: unknown[]) => { });
const deleteJob = mock(async (..._args: unknown[]) => { });
const insertJob = mock(async (..._args: unknown[]) => "new");
const getUnemailedOutreach = mock(async (): Promise<unknown[]> => []);
const sendMail = mock(async (..._args: unknown[]) => ({}));
const markOutreachEmailed = mock(async (..._args: unknown[]) => { });
const logEmail = mock(async (..._args: unknown[]) => { });
const exportToSheet = mock(async (..._args: unknown[]) => ({ exported: 1 }));
const sheetsConfig = mock(() => ({ sheetId: "test-sheet", credsPath: "unused.json", credsExists: true }));
const runCollection = mock(async (_includeCompanies?: boolean) => ({ ...collection }));
const generateOutreach = mock(async (..._args: unknown[]) => 2);
const runPipeline = mock(async (_send: boolean): Promise<unknown> => ({ outreach_generated: 2 }));
const sendDigest = mock(async (_limit?: number, dryRun?: boolean): Promise<unknown> => ({ sent: 0, dry_run: dryRun }));
const logError = mock((_message: unknown) => { });
const transactionClient = {};
const withTransaction = mock(async (fn: (client: unknown) => Promise<unknown>) => fn(transactionClient));
const insertOutreach = mock(async (..._args: unknown[]) => true);
const setLastOutreachBatchAt = mock(async (..._args: unknown[]) => { });
const findProfileByName = mock(async (_name: string): Promise<{ id: number } | undefined> => undefined);
const deleteProfileRow = mock(async (_id: number) => { });
const getCompanies = mock(async (_filters?: unknown): Promise<Array<typeof company & { ats_platform?: string; ats_slug?: string }>> => [company]);
const updateCompanyCrawlStatus = mock(async (..._args: unknown[]) => { });
const cleanupOldJobs = mock(async (_days?: number) => 0);

mock.module("../src/config/logger.js", () => ({ logger: { info: () => { }, warn: () => { }, error: logError } }));
mock.module("../src/infrastructure/database/connection.js", () => ({
    query: mock(async () => ({ rows: [], rowCount: 0 })),
    queryOne: mock(async () => undefined),
    param: (params: unknown[], value: unknown) => { params.push(value); return `$${params.length}`; },
    withTransaction,
    initSchema: mock(async () => { }),
    closePool: mock(async () => { }),
}));
mock.module("../src/modules/jobs/jobs.repository.js", () => ({
    getJobs, getJobById, updateJobStatus, getJobsForRescore, updateJobScore, deleteJob, insertJob,
    getMarkedJobs: async () => [job], getSources: async () => ["test"], getStats: async () => ({ total: 1 }),
    toggleMarkForEmail: async () => true, cleanupOldJobs,
}));
mock.module("../src/modules/companies/companies.repository.js", () => ({
    getCompanies, getCompanyById, upsertCompany,
    getCompanyStats: async () => ({ total: 1 }), updateCompanyCrawlStatus,
}));
mock.module("../src/modules/outreach/outreach.repository.js", () => ({
    getOutreach: async () => [], getOutreachById, getOutreachStats: async () => ({}),
    getLastOutreachBatchAt: async () => null, deleteOutreachBulk: async (ids: string[]) => ids.length,
    updateOutreachStatus: async () => { }, updateOutreachNotes, getUnemailedOutreach, markOutreachEmailed,
    insertOutreach, outreachExistsForJob: async () => false, setLastOutreachBatchAt,
}));
mock.module("../src/modules/profiles/profiles.repository.js", () => ({
    readActiveProfileId, readProfileRow, insertProfile: createProfile, updateProfileRow,
    listProfileRows: async () => [], findProfileByName,
    setActiveProfileId: async () => { }, deleteProfileRow, countProfiles: async () => 1,
}));
mock.module("../src/modules/email/email.repository.js", () => ({ getEmailLogs: async () => [], logEmail }));
mock.module("../src/modules/collection/collection.repository.js", () => ({ getApiUsage: async () => ({ month: 1, today: 1, total: 1 }), logApiCall: async () => { } }));
mock.module("../src/modules/exports/sheets.adapter.js", () => ({ exportToSheet, sheetsConfig }));
mock.module("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const sources = await import("../src/modules/collection/sources/index.js");
const realCollection = await import("../src/modules/collection/collection.service.js");
const realCompanyCrawl = realCollection.runCompanyCrawl;
const realFullCollection = realCollection.runCollection;
mock.module("../src/modules/collection/collection.service.js", () => ({ ...realCollection, runCollection, runCompanyCrawl: async () => collection }));
const realOutreach = await import("../src/modules/outreach/outreach.service.js");
const realGenerateOutreach = realOutreach.generateOutreachForTopJobs;
mock.module("../src/modules/outreach/outreach.service.js", () => ({ ...realOutreach, generateOutreachForTopJobs: generateOutreach }));
const realEmail = await import("../src/modules/email/email.service.js");
const realSendDigest = realEmail.sendDailyDigest;
mock.module("../src/modules/email/email.service.js", () => ({ ...realEmail, sendDailyDigest: sendDigest }));
const realAutomation = await import("../src/modules/automation/automation.service.js");
const realRunPipeline = realAutomation.runDailyPipeline;
mock.module("../src/modules/automation/automation.service.js", () => ({ ...realAutomation, runDailyPipeline: runPipeline }));
const profilesService = await import("../src/modules/profiles/profiles.service.js");
const jobsService = await import("../src/modules/jobs/jobs.service.js");
const companiesService = await import("../src/modules/companies/companies.service.js");
const { makeJob, jobFingerprint } = await import("../src/modules/jobs/jobs.model.js");
const { errorResponse } = await import("../src/common/errors/error-handler.js");

const { createServer } = await import("../src/server.js");
const { apiRoutes } = await import("../src/app/routes.js");
const { startScheduler, stopScheduler } = await import("../src/modules/automation/automation.scheduler.js");
const { getQuery, readJson, readBody, MAX_BODY_BYTES } = await import("../src/common/http/request.js");
let server: Bun.Server<undefined>;

beforeAll(() => { server = createServer({ hostname: "127.0.0.1", port: 0 }); });
afterAll(async () => {
    await stopScheduler();
    await server.stop(true);
    Object.assign(env, originalEnv);
    mock.restore();
});
beforeEach(() => {
    Object.assign(env, { SENDER_EMAIL: "sender@example.test", SENDER_APP_PASSWORD: "test-only-password", RECIPIENT_EMAIL: "recipient@example.test", HUNTER_API_KEY: "" });
    withTransaction.mockClear();
    getCompanies.mockClear();
    updateCompanyCrawlStatus.mockClear();
    cleanupOldJobs.mockClear();
    insertOutreach.mockClear();
    setLastOutreachBatchAt.mockClear();
    deleteProfileRow.mockClear();
    exportToSheet.mockClear();
    profilesService.invalidateCache();
    readProfileRow.mockClear();
    readActiveProfileId.mockClear();
    updateProfileRow.mockClear();
    upsertCompany.mockClear();
    getJobsForRescore.mockClear();
    updateJobScore.mockClear();
    deleteJob.mockClear();
    insertJob.mockClear();
    sendMail.mockClear();
    markOutreachEmailed.mockClear();
    logEmail.mockClear();
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
    ["DELETE", "/api/profiles/2"], ["GET", "/api/profiles/1/export"],
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
            const unimplemented = url.endsWith("/detect-ats") || url.endsWith("/discover");
            const missingQuery = url === "/api/search-queries/0";
            expect(response.status).toBe(unimplemented ? 501 : missingQuery ? 404 : 200);
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

    test("missing jobs return the unified 404 contract", async () => {
        getJobById.mockResolvedValueOnce(undefined);
        const response = await request("/api/jobs/missing");
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ err_code: "JOB_NOT_FOUND", status_code: 404, err_mess: "Job not found" });
    });

    test("forwards valid JSON to profile creation", async () => {
        await (await request("/api/profiles", "POST", { name: "New", description: "Example", config: {} })).text();
        expect(createProfile).toHaveBeenLastCalledWith("New", "Example", config, "custom");
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
            expect(await response.json()).toMatchObject({ err_code: "VALIDATION_ERROR", status_code: 422 });
        });
    }

    test("malformed JSON returns 400 without invoking the handler's integration", async () => {
        const response = await fetch(new URL("/api/profiles", server.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ err_code: "INVALID_JSON", status_code: 400, err_mess: "Invalid JSON body" });
        expect(createProfile).not.toHaveBeenCalled();
    });

    test("enforces the 100 KiB request limit", async () => {
        const response = await request("/api/profiles", "POST", { name: "x".repeat(110 * 1024), config: {} });
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({ err_code: "REQUEST_TOO_LARGE", status_code: 413 });
        expect(createProfile).not.toHaveBeenCalled();
    });

    test("async failures use the JSON error handler", async () => {
        getJobs.mockRejectedValueOnce(new Error("simulated database failure"));
        const response = await request("/api/jobs");
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ err_code: "INTERNAL_ERROR", status_code: 500, err_mess: "An unexpected error occurred" });
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

    for (const url of ["/", "/outreach", "/profile", "/static/style.css", "/static/..%2f..%2fpackage.json", "/missing", "/api/missing"]) {
        test(`API-only server rejects ${url} with JSON`, async () => {
            const response = await request(url);
            expect(response.status).toBe(404);
            expect(await response.json()).toEqual({ err_code: "ROUTE_NOT_FOUND", status_code: 404, err_mess: "Route not found" });
        });
    }

    test("HEAD responses preserve status without a body", async () => {
        const success = await request("/api/jobs", "HEAD");
        expect(success.status).toBe(200);
        expect(await success.text()).toBe("");
        const missing = await request("/missing", "HEAD");
        expect(missing.status).toBe(404);
        expect(await missing.text()).toBe("");
    });

    test("chunked bodies enforce the limit with JSON before service execution", async () => {
        const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
            const req = nodeRequest(new URL("/api/profiles", server.url), {
                method: "POST", headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" },
            }, response => {
                let text = "";
                response.setEncoding("utf8");
                response.on("data", chunk => { text += chunk; });
                response.on("end", () => resolve({ status: response.statusCode!, text }));
            });
            req.on("error", reject);
            req.write("x".repeat(MAX_BODY_BYTES / 2));
            req.write("x".repeat(MAX_BODY_BYTES / 2 + 1));
            req.end();
        });
        expect(result.status).toBe(413);
        expect(JSON.parse(result.text)).toMatchObject({ err_code: "REQUEST_TOO_LARGE", status_code: 413 });
        expect(createProfile).not.toHaveBeenCalled();
    });

    test("unsupported methods do not execute a GET handler", async () => {
        const response = await request("/api/jobs", "DELETE");
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
        expect(getJobs).not.toHaveBeenCalled();
        expect(await response.json()).toMatchObject({ err_code: "METHOD_NOT_ALLOWED", status_code: 405 });
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
    test("bounded bytes are cached and the exact byte limit is accepted", async () => {
        const req = new Request("http://localhost", { method: "POST", body: "x".repeat(MAX_BODY_BYTES) });
        const first = readBody(req);
        expect(readBody(req)).toBe(first);
        expect((await first).length).toBe(MAX_BODY_BYTES);
        const utf8 = new Request("http://localhost", { method: "POST", body: "é".repeat(MAX_BODY_BYTES / 2 + 1) });
        await expect(readBody(utf8)).rejects.toMatchObject({ err_code: "REQUEST_TOO_LARGE" });
    });
    test("oversized streams are canceled and never read to completion", async () => {
        let canceled = false;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1)); },
            cancel() { canceled = true; },
        });
        const req = new Request("http://localhost", { method: "POST", body: stream });
        await expect(readBody(req)).rejects.toMatchObject({ err_code: "REQUEST_TOO_LARGE" });
        expect(canceled).toBe(true);
    });
    test("strict JSON rejects primitives", async () => {
        const req = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
        await expect(readJson(req)).rejects.toThrow("Invalid JSON body");
    });
});

describe("domain services and errors", () => {
    for (const code of Object.values(ErrorCode)) {
        test(`serializes ${code} with exactly the public contract`, async () => {
            const response = errorResponse(new AppError(code, { cause: new Error("private SQL and credentials") }));
            const body = await response.json();
            expect(Object.keys(body).sort()).toEqual(["err_code", "err_mess", "status_code"]);
            expect(body.status_code).toBe(response.status);
            expect(body.err_code).toBe(code);
            expect(JSON.stringify(body)).not.toContain("private SQL");
        });
    }

    test("missing resources prevent mutations", async () => {
        getJobById.mockResolvedValueOnce(undefined);
        await expect(jobsService.updateJobStatus("missing", "applied")).rejects.toMatchObject({ err_code: "JOB_NOT_FOUND" });
        expect(updateJobStatus).not.toHaveBeenCalled();
        getCompanyById.mockResolvedValueOnce(undefined);
        await expect(companiesService.pauseCompany("missing")).rejects.toMatchObject({ err_code: "COMPANY_NOT_FOUND" });
        expect(upsertCompany).not.toHaveBeenCalled();
        getOutreachById.mockResolvedValueOnce(undefined);
        await expect(realOutreach.updateOutreachNotes("missing", "note")).rejects.toMatchObject({ err_code: "OUTREACH_NOT_FOUND" });
        readProfileRow.mockResolvedValueOnce(undefined);
        await expect(profilesService.updateProfile(99, { name: "new" })).rejects.toMatchObject({ err_code: "PROFILE_NOT_FOUND" });
        expect(updateProfileRow).not.toHaveBeenCalled();
    });

    test("active-profile deletion and missing active-profile queries conflict", async () => {
        const response = await request("/api/profiles/1", "DELETE");
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ err_code: "ACTIVE_PROFILE_DELETE_FORBIDDEN", status_code: 409 });
        expect(deleteProfileRow).not.toHaveBeenCalled();
        readActiveProfileId.mockResolvedValueOnce(null);
        await expect(profilesService.addActiveProfileQuery("backend")).rejects.toMatchObject({ err_code: "NO_ACTIVE_PROFILE", status_code: 409 });
        expect(updateProfileRow).not.toHaveBeenCalled();
    });

    test("profile reads are cached and active updates refresh the cache", async () => {
        await profilesService.getActiveProfile();
        await profilesService.getActiveProfile();
        expect(readProfileRow).toHaveBeenCalledTimes(1);
        readProfileRow.mockResolvedValueOnce(profileRow).mockResolvedValueOnce({ ...profileRow, name: "Updated" });
        await profilesService.updateProfile(1, { name: "Updated" });
        expect((await profilesService.getActiveProfile())._name).toBe("Updated");
        expect(updateProfileRow).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Updated" }));
    });

    test("overwriting the active preset refreshes cache even without activation", async () => {
        await profilesService.getActiveProfile();
        findProfileByName.mockResolvedValueOnce({ id: 1 });
        readProfileRow.mockResolvedValueOnce({ ...profileRow, name: "Preset Updated" });
        expect(await profilesService.importPreset("backend_python", false, true)).toBe(1);
        expect(updateProfileRow).toHaveBeenCalledWith(1, expect.objectContaining({ source: "preset:backend_python" }));
        expect((await profilesService.getActiveProfile())._name).toBe("Preset Updated");
    });

    test("missing and unsafe preset names never expose filesystem paths", async () => {
        for (const [slug, status, code] of [["does_not_exist", 404, "PRESET_NOT_FOUND"], ["../package", 422, "INVALID_PRESET"]] as const) {
            const response = await request("/api/profiles/import", "POST", { preset_slug: slug });
            expect(response.status).toBe(status);
            const body = await response.json();
            expect(body.err_code).toBe(code);
            expect(body.err_mess).not.toContain("profiles/");
        }
    });

    test("failed company writes propagate and duplicate constraints normalize", async () => {
        upsertCompany.mockRejectedValueOnce(new Error("private SQL"));
        const response = await request("/api/companies", "POST", { name: "Test" });
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ err_code: "INTERNAL_ERROR", err_mess: "An unexpected error occurred" });
        const conflict = errorResponse({ code: "23505", detail: "private SQL" });
        expect(conflict.status).toBe(409);
        expect(await conflict.json()).toMatchObject({ err_code: "RESOURCE_CONFLICT" });
    });

    test("scoring stores a fingerprint and merged tech within one transaction", async () => {
        const batchProfile = structuredClone(profile);
        batchProfile.scoring.min_score_to_store = 0;
        const candidate = makeJob({ title: "Backend Engineer", company: "Test", location: "Remote", url: "https://example.test/jobs/1", tech_stack: "Existing" });
        const stats = { new: 0, updated: 0, filtered_out: 0 };
        await jobsService.scoreAndStore([candidate], stats, batchProfile);
        expect(withTransaction).toHaveBeenCalledTimes(1);
        expect(insertJob).toHaveBeenCalledWith(expect.objectContaining({ id: jobFingerprint(candidate), scored_profile_id: 1, company_domain: "example.test", tech_stack: expect.stringContaining("Existing") }), transactionClient);
        expect(stats).toEqual({ new: 1, updated: 0, filtered_out: 0 });
    });

    test("low-scoring jobs are filtered and rescoring preserves transaction boundaries", async () => {
        const strictProfile = structuredClone(profile);
        strictProfile.scoring.min_score_to_store = 101;
        const stats = { new: 0, updated: 0, filtered_out: 0 };
        await jobsService.scoreAndStore([makeJob({ title: "Unrelated", company: "Test" })], stats, strictProfile);
        expect(insertJob).not.toHaveBeenCalled();
        expect(stats.filtered_out).toBe(1);
        getJobsForRescore.mockResolvedValueOnce([{ ...job, description: "", tech_stack: "Existing" }]);
        expect(await jobsService.rescoreJobs(strictProfile, true)).toEqual({ ok: true, scanned: 1, updated: 0, deleted: 1 });
        expect(deleteJob).toHaveBeenCalledWith("job-1", transactionClient);
        expect(updateJobScore).not.toHaveBeenCalled();
        getJobsForRescore.mockResolvedValueOnce([{ ...job, description: "", tech_stack: "Existing" }]);
        expect(await jobsService.rescoreJobs(profile, false)).toMatchObject({ updated: 1, deleted: 0 });
        expect(updateJobScore).toHaveBeenCalledWith("job-1", expect.any(Object), expect.stringContaining("Existing"), 1, transactionClient);
    });

    test("outreach uses the collection cutoff and only counts successful persistence", async () => {
        expect(await realGenerateOutreach(2, 40, "maybe", "cutoff")).toBe(1);
        expect(getJobs).toHaveBeenCalledWith({ min_score: 40, india_friendly: "maybe", seen_after: "cutoff", limit: 10 });
        expect(setLastOutreachBatchAt).toHaveBeenCalledTimes(1);
        insertOutreach.mockRejectedValueOnce(new Error("database write failed"));
        setLastOutreachBatchAt.mockClear();
        expect(await realGenerateOutreach()).toBe(0);
        expect(setLastOutreachBatchAt).not.toHaveBeenCalled();
    });

    test("digest handles configuration and empty results without delivering", async () => {
        Object.assign(env, { SENDER_EMAIL: "" });
        await expect(realSendDigest()).rejects.toMatchObject({ err_code: "EMAIL_NOT_CONFIGURED", status_code: 503 });
        Object.assign(env, { SENDER_EMAIL: "sender@example.test", RECIPIENT_EMAIL: "" });
        await expect(realSendDigest()).rejects.toMatchObject({ err_code: "RECIPIENT_NOT_CONFIGURED" });
        Object.assign(env, { RECIPIENT_EMAIL: "recipient@example.test" });
        expect(await realSendDigest()).toMatchObject({ sent: 0 });
        expect(sendMail).not.toHaveBeenCalled();
    });

    test("digest dry run renders without sending or marking items", async () => {
        getUnemailedOutreach.mockResolvedValueOnce([{ id: "outreach-1", job_title: "Engineer", company: "Test", dm_short: "Hi", dm_long: "Hello", notes: "[]" }]);
        expect(await realSendDigest(5, true)).toMatchObject({ dry_run: true, items_count: 1 });
        expect(sendMail).not.toHaveBeenCalled();
        expect(markOutreachEmailed).not.toHaveBeenCalled();
    });

    test("delivery failures remain typed even if failure logging also fails", async () => {
        getUnemailedOutreach.mockResolvedValueOnce([{ id: "outreach-1", job_title: "Engineer", company: "Test", dm_short: "Hi", dm_long: "Hello", notes: "[]" }]);
        sendMail.mockRejectedValueOnce(new Error("private SMTP response"));
        logEmail.mockRejectedValueOnce(new Error("private database failure"));
        await expect(realSendDigest()).rejects.toMatchObject({ err_code: "EMAIL_DELIVERY_FAILED", status_code: 502 });
        expect(markOutreachEmailed).not.toHaveBeenCalled();
        expect(logEmail).toHaveBeenCalledWith(expect.any(String), expect.any(String), 1, ["outreach-1"], "failed", expect.any(String));
    });

    test("pipeline dry run skips delivery and a manual delivery failure propagates", async () => {
        expect(await realRunPipeline(false)).toMatchObject({ email: { skipped: true }, collection: { new: 1 } });
        expect(sendDigest).not.toHaveBeenCalled();
        sendDigest.mockRejectedValueOnce(new AppError("EMAIL_DELIVERY_FAILED"));
        await expect(realRunPipeline(true)).rejects.toMatchObject({ err_code: "EMAIL_DELIVERY_FAILED" });
        expect(runCollection).toHaveBeenCalledTimes(2);
        runPipeline.mockRejectedValueOnce(new AppError("EMAIL_DELIVERY_FAILED"));
        const response = await request("/api/email/run-pipeline", "POST");
        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ err_code: "EMAIL_DELIVERY_FAILED", status_code: 502 });
    });

    test("collection isolates board failures and keeps the stale cleanup cutoff", async () => {
        const adapters = [
            spyOn(sources.RemotiveSource.prototype, "fetch").mockRejectedValue(new Error("upstream failed")),
            spyOn(sources.RemoteOKSource.prototype, "fetch").mockResolvedValue([]),
            spyOn(sources.ArbeitnowSource.prototype, "fetch").mockResolvedValue([]),
        ];
        try {
            const result = await realFullCollection(false);
            expect(result).toMatchObject({ fetched: 0, new: 0, deleted_stale: 0 });
            expect(Object.values(result.board_sources ?? {})).toEqual([0, 0, 0]);
            expect(cleanupOldJobs).toHaveBeenCalledWith(14);
            expect(getCompanies).not.toHaveBeenCalled();
        } finally { for (const adapter of adapters) adapter.mockRestore(); }
    });

    test("company crawls cap concurrency at five and preserve best-effort statistics", async () => {
        const companies = Array.from({ length: 12 }, (_, index) => ({ ...company, id: `company-${index}`, ats_platform: "greenhouse", ats_slug: `test-${index}` }));
        getCompanies.mockResolvedValueOnce(companies);
        let active = 0;
        let peak = 0;
        let calls = 0;
        const adapter = spyOn(sources.GreenhouseSource.prototype, "fetch").mockImplementation(async () => {
            active += 1;
            peak = Math.max(peak, active);
            const fail = calls++ === 0;
            await new Promise(resolve => setTimeout(resolve, 1));
            active -= 1;
            if (fail) throw new Error("upstream failed");
            return [];
        });
        try {
            expect(await realCompanyCrawl()).toMatchObject({ companies_crawled: 11, companies_failed: 1, fetched: 0 });
            expect(peak).toBe(5);
            expect(updateCompanyCrawlStatus).toHaveBeenCalledTimes(12);
            expect(updateCompanyCrawlStatus).toHaveBeenCalledWith("company-0", "failed", expect.any(String));
            getCompanyById.mockResolvedValueOnce(undefined);
            await expect(realCompanyCrawl(["missing"])).rejects.toMatchObject({ err_code: "COMPANY_NOT_FOUND" });
        } finally { adapter.mockRestore(); }
    });

    test("Hunter status is best-effort only when unconfigured; upstream errors are typed", async () => {
        const transport = spyOn(globalThis, "fetch");
        try {
            expect(await realOutreach.getHunterStatus()).toEqual({ configured: false });
            expect(transport).not.toHaveBeenCalled();
            Object.assign(env, { HUNTER_API_KEY: "test-only-key" });
            transport.mockResolvedValueOnce(Response.json({ data: { plan_name: "Free", requests: { used: 2, available: 48 } } }));
            expect(await realOutreach.getHunterStatus()).toEqual({ configured: true, plan: "Free", used: 2, available: 48 });
            for (const response of [new Response("private upstream", { status: 503 }), Response.json({ unexpected: true })]) {
                transport.mockResolvedValueOnce(response);
                await expect(realOutreach.getHunterStatus()).rejects.toMatchObject({ err_code: "HUNTER_STATUS_FAILED", status_code: 502 });
            }
        } finally { transport.mockRestore(); }
    });

    test("Sheets distinguishes unavailable configuration, provider, and database failures", async () => {
        for (const [code, status, overrides] of [
            ["SHEETS_NOT_CONFIGURED", 503, { sheetId: "" }],
            ["SHEETS_CREDENTIALS_MISSING", 503, { credsExists: false }],
        ] as const) {
            sheetsConfig.mockReturnValueOnce(Object.assign({ sheetId: "test", credsPath: "private/path", credsExists: true }, overrides));
            const response = await request("/api/export/sheets", "POST");
            expect(response.status).toBe(status);
            expect(await response.json()).toMatchObject({ err_code: code });
        }
        expect(exportToSheet).not.toHaveBeenCalled();
        exportToSheet.mockRejectedValueOnce(new Error("private provider error"));
        const upstream = await request("/api/export/sheets", "POST");
        expect(upstream.status).toBe(502);
        expect(await upstream.json()).toMatchObject({ err_code: "SHEETS_EXPORT_FAILED" });
        getJobs.mockRejectedValueOnce(new Error("private SQL"));
        const database = await request("/api/export/sheets", "POST");
        expect(database.status).toBe(500);
        expect(await database.json()).toMatchObject({ err_code: "INTERNAL_ERROR" });
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
