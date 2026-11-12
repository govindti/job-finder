// Query coercion and JSON helpers shared by native Bun request handlers.

export function toInt(raw: unknown, def: number, min?: number, max?: number): number {
    let n = def;
    if (typeof raw === "number") n = raw;
    else if (typeof raw === "string" && raw.trim() !== "") {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isNaN(parsed)) n = parsed;
    }
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
}

export function toBool(raw: unknown, def = false): boolean {
    if (raw === undefined || raw === null) return def;
    const s = String(raw).toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return def;
}

/** Trim-to-null string query param (empty/missing -> null, like Optional[str]). */
export function toStr(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    const s = String(raw);
    return s === "" ? null : s;
}

/** Respond with the existing API error shape. */
export function detail(status: number, msg: string): Response {
    return Response.json({ detail: msg }, { status });
}

export class HttpError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = "HttpError";
    }
}

export function getQuery(req: Request): Record<string, string | string[]> {
    const query: Record<string, string | string[]> = Object.create(null);
    for (const [key, value] of new URL(req.url).searchParams) {
        const existing = query[key];
        query[key] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
    }
    return query;
}

/** Preserve JSON-only body parsing, including empty bodies and strict objects/arrays. */
export async function readJson(req: Request): Promise<unknown> {
    const contentType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return {};
    const text = await req.text();
    if (!text) return {};
    try {
        const body: unknown = JSON.parse(text);
        if (body === null || typeof body !== "object") throw new Error("Expected an object or array");
        return body;
    } catch {
        throw new HttpError(400, "Invalid JSON body");
    }
}
