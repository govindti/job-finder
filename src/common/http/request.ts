import { AppError } from "../errors/app-error.js";

export const MAX_BODY_BYTES = 100 * 1024;
const bodies = new WeakMap<Request, Promise<Uint8Array>>();
export type Query = Record<string, string | string[]>;

export function toInt(raw: unknown, fallback: number, min?: number, max?: number): number {
    let value = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : fallback;
    if (Number.isNaN(value)) value = fallback;
    if (min !== undefined) value = Math.max(min, value);
    if (max !== undefined) value = Math.min(max, value);
    return value;
}

export function toBool(raw: unknown, fallback = false): boolean {
    if (raw === undefined || raw === null) return fallback;
    const value = String(raw).toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return fallback;
}

export function toStr(raw: unknown): string | null {
    return raw === undefined || raw === null || String(raw) === "" ? null : String(raw);
}

export function getQuery(req: Request): Query {
    const query: Query = Object.create(null);
    for (const [key, value] of new URL(req.url).searchParams) {
        const existing = query[key];
        query[key] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
    }
    return query;
}

export function parseIntegerId(raw: unknown, label: string, min = 1): number {
    const text = String(raw);
    const id = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(id) || id < min) {
        throw new AppError("VALIDATION_ERROR", { message: `${label} must be an integer greater than or equal to ${min}` });
    }
    return id;
}

export function requiredString(raw: unknown, label: string): string {
    const value = toStr(raw);
    if (value === null) throw new AppError("VALIDATION_ERROR", { message: `${label} is required` });
    return value;
}

async function consumeBody(req: Request): Promise<Uint8Array> {
    if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) {
        if (req.body) void req.body.cancel().catch(() => { });
        throw new AppError("REQUEST_TOO_LARGE");
    }
    if (!req.body) return new Uint8Array();
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY_BYTES) {
                void reader.cancel().catch(() => { });
                throw new AppError("REQUEST_TOO_LARGE");
            }
            chunks.push(value);
        }
    } catch (cause) {
        if (cause instanceof AppError) throw cause;
        throw new AppError("INVALID_REQUEST", { cause });
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

/** The route guard and DTO reader share one bounded read of the request stream. */
export function readBody(req: Request): Promise<Uint8Array> {
    let body = bodies.get(req);
    if (!body) {
        body = consumeBody(req);
        bodies.set(req, body);
    }
    return body;
}

export async function readJson(req: Request): Promise<unknown> {
    const bytes = await readBody(req);
    const contentType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json" || bytes.length === 0) return {};
    try {
        const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (body === null || typeof body !== "object") throw new Error("Expected object or array");
        return body;
    } catch (cause) {
        throw new AppError("INVALID_JSON", { cause });
    }
}
