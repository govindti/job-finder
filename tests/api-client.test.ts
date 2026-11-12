import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { api, qs } from "../web/lib/api";
import { ApiError, errorMessages, formatApiError } from "../web/lib/api-error";
import { ErrorCode, isApiErrorBody } from "../src/common/errors/error-codes";

const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => { fetchSpy.mockReset(); });

function respond(response: Response): void { fetchSpy.mockResolvedValueOnce(response); }

describe("frontend API error contract", () => {
    test("known codes select local messages while retaining server fields", async () => {
        respond(Response.json({ err_code: "JOB_NOT_FOUND", status_code: 404, err_mess: "Server wording" }, { status: 404 }));
        try {
            await api("/jobs/missing");
            throw new Error("Expected an API failure");
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            expect(error).toMatchObject({ err_code: "JOB_NOT_FOUND", status_code: 404, err_mess: "Server wording" });
            expect(formatApiError(error)).toBe(errorMessages.JOB_NOT_FOUND);
        }
        expect(Object.keys(errorMessages).sort()).toEqual(Object.keys(ErrorCode).sort());
    });

    test("unknown codes fall back to the safe server message", async () => {
        respond(Response.json({ err_code: "FUTURE_CODE", status_code: 409, err_mess: "Try again after the current operation." }, { status: 409 }));
        await expect(api("/future")).rejects.toMatchObject({ err_code: "FUTURE_CODE", message: "Try again after the current operation." });
        expect(new ApiError({ err_code: "toString", status_code: 400, err_mess: "Safe fallback" }).message).toBe("Safe fallback");
    });

    for (const body of [
        "<html>Private proxy failure</html>",
        JSON.stringify({ detail: "Private legacy failure" }),
        JSON.stringify({ err_code: "INTERNAL_ERROR", status_code: 404, err_mess: "Mismatched status" }),
        JSON.stringify({ err_code: "INTERNAL_ERROR", status_code: "502", err_mess: "Wrong type" }),
    ]) {
        test(`unsafe failure uses a local fallback: ${body}`, async () => {
            respond(new Response(body, { status: 502 }));
            await expect(api("/jobs")).rejects.toMatchObject({ err_code: "HTTP_ERROR", status_code: 502, message: "The API request failed (HTTP 502). Please try again later." });
        });
    }

    test("network and aborted requests never expose transport details", async () => {
        fetchSpy.mockRejectedValueOnce(new Error("private transport address"));
        await expect(api("/jobs")).rejects.toMatchObject({ err_code: "NETWORK_ERROR", status_code: 0, message: "Unable to reach the API. Check your connection and try again." });
        fetchSpy.mockRejectedValueOnce(new DOMException("private reason", "AbortError"));
        await expect(api("/jobs")).rejects.toMatchObject({ err_code: "REQUEST_ABORTED", message: "The request was canceled." });
    });

    test("normal JSON values and empty successes remain unchanged", async () => {
        for (const value of [{ jobs: [] }, [1, 2], "valid JSON string", 42, null, false]) {
            respond(Response.json(value));
            expect(await api("/jobs")).toEqual(value);
        }
        respond(new Response(null, { status: 204 }));
        expect(await api("/empty")).toBeNull();
        respond(new Response("{broken", { headers: { "Content-Type": "application/json" } }));
        await expect(api("/invalid")).rejects.toMatchObject({ err_code: "INVALID_RESPONSE" });
    });

    test("YAML export uses the same client and failure parsing", async () => {
        const yaml = "name: Backend\nsearch:\n  remote_only: true\n";
        respond(new Response(yaml, { headers: { "Content-Type": "application/x-yaml" } }));
        expect(await api<string>("/profiles/1/export")).toBe(yaml);
        respond(Response.json({ err_code: "PROFILE_NOT_FOUND", status_code: 404, err_mess: "Profile not found" }, { status: 404 }));
        await expect(api("/profiles/99/export")).rejects.toMatchObject({ err_code: "PROFILE_NOT_FOUND" });
    });

    test("serializes bodies, preserves headers, and builds query strings", async () => {
        respond(Response.json({ ok: true }));
        await api("/profiles", { method: "POST", body: { name: "New" }, headers: new Headers({ "X-Test": "value" }) });
        expect(fetchSpy).toHaveBeenLastCalledWith("/api/profiles", expect.objectContaining({ method: "POST", body: '{"name":"New"}' }));
        const headers = new Headers(fetchSpy.mock.calls.at(-1)?.[1]?.headers);
        expect(headers.get("X-Test")).toBe("value");
        expect(headers.get("Content-Type")).toBe("application/json");
        expect(qs({ search: "Go & Node", empty: "", no: null, omitted: undefined, enabled: false, offset: 0 })).toBe("?search=Go+%26+Node&enabled=false&offset=0");
    });

    test("contract guard rejects malformed statuses and messages", () => {
        for (const value of [null, [], {}, { err_code: "X", status_code: 200, err_mess: "x" }, { err_code: "X", status_code: 500.5, err_mess: "x" }, { err_code: "X", status_code: 500, err_mess: {} }]) {
            expect(isApiErrorBody(value)).toBe(false);
        }
        expect(formatApiError(null, "Fallback")).toBe("Fallback");
    });
});

// Restore the original transport before another test file starts.
import { afterAll } from "bun:test";
afterAll(() => { fetchSpy.mockRestore(); });
