import { isApiErrorBody } from "../../src/common/errors/error-codes";
import { ApiError } from "./api-error";

export interface ApiOptions extends Omit<RequestInit, "body"> {
    body?: unknown;
}

/** Small typed wrapper around fetch for the native Bun API (proxied by Next). */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
    const { body, headers, ...rest } = opts;
    const finalHeaders = new Headers(headers);

    let requestBody: BodyInit | undefined;
    if (body !== undefined) {
        requestBody = typeof body === "string" ? body : JSON.stringify(body);
        if (!finalHeaders.has("Content-Type")) finalHeaders.set("Content-Type", "application/json");
    }

    let resp: Response;
    let text: string;
    try {
        resp = await fetch(`/api${path}`, { ...rest, headers: finalHeaders, body: requestBody });
        text = await resp.text();
    } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        throw new ApiError({
            err_code: aborted ? "REQUEST_ABORTED" : "NETWORK_ERROR", status_code: 0,
            err_mess: aborted ? "The request was canceled." : "Unable to reach the API. Check your connection and try again.",
        });
    }
    let data: unknown = null;
    let invalidJson = false;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            invalidJson = true;
            data = text;
        }
    }

    if (!resp.ok) {
        if (isApiErrorBody(data) && data.status_code === resp.status) throw new ApiError(data);
        throw new ApiError({ err_code: "HTTP_ERROR", status_code: resp.status, err_mess: `The API request failed (HTTP ${resp.status}). Please try again later.` });
    }

    if (invalidJson && resp.headers.get("content-type")?.includes("application/json")) {
        throw new ApiError({ err_code: "INVALID_RESPONSE", status_code: resp.status, err_mess: "The API returned an invalid response." });
    }
    return data as T;
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === "") continue;
        search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : "";
}
