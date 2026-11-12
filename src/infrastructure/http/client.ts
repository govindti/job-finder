import { logger } from "../../config/logger.js";

// Native fetch (Node 20+) with a timeout, retry and exponential backoff. This
// centralises the per-request timeout + error-isolation pattern so each source
// can stay focused on mapping its payload into Job objects.

export interface HttpOptions {
    /** Milliseconds before the request is aborted. */
    timeoutMs?: number;
    /** Number of *retries* after the first attempt (total = retries + 1). */
    retries?: number;
    /** Base delay for exponential backoff, in ms (doubled each retry). */
    backoffBaseMs?: number;
    headers?: Record<string, string>;
    /** Query params; `undefined` values are dropped. */
    query?: Record<string, string | number | boolean | undefined>;
    method?: "GET" | "POST";
    body?: string;
}

export interface HttpResponse {
    ok: boolean;
    status: number;
    text: string;
}

function buildUrl(url: string, query?: HttpOptions["query"]): string {
    if (!query) return url;
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        searchParams.set(k, String(v));
    }
    const qs = searchParams.toString();
    return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform an HTTP request with timeout + retry/backoff.
 * A response is retried only on transport errors or 5xx / 429 statuses; other
 * non-2xx statuses resolve (with `ok=false`) so callers can decide.
 */
export async function httpFetch(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
    const {
        timeoutMs = 30000,
        retries = 2,
        backoffBaseMs = 500,
        headers = {},
        query,
        method = "GET",
        body,
    } = opts;

    const finalUrl = buildUrl(url, query);
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(finalUrl, {
                method,
                headers,
                body,
                signal: controller.signal,
            });
            const text = await resp.text();

            // Retry on server-side / rate-limit failures, backoff between attempts.
            if ((resp.status >= 500 || resp.status === 429) && attempt < retries) {
                const delay = backoffBaseMs * 2 ** attempt;
                logger.warn({ url: finalUrl, status: resp.status, attempt, delay }, "http retry");
                await sleep(delay);
                continue;
            }
            return { ok: resp.ok, status: resp.status, text };
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                const delay = backoffBaseMs * 2 ** attempt;
                logger.warn({ url: finalUrl, err, attempt, delay }, "http transport retry");
                await sleep(delay);
            }
        } finally {
            clearTimeout(timer);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(`Request failed: ${finalUrl}`);
}

/** Convenience wrapper: fetch then JSON-parse with zod-agnostic `unknown` output. */
export async function httpJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
    const resp = await httpFetch(url, opts);
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`);
    }
    return JSON.parse(resp.text) as T;
}
