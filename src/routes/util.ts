import type { NextFunction, Request, RequestHandler, Response } from "express";

// Small query-param coercion helpers (defaults + min/max bounds), an error
// responder that returns a {detail} JSON body, and the async wrapper Express 4
// needs because it does not catch rejected promises itself.

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

/** Respond with a {detail} JSON error body. */
export function detail(res: Response, status: number, msg: string): Response {
    return res.status(status).json({ detail: msg });
}

/**
 * Express 4 does not forward rejected promises to the error handler, so every
 * async route handler is wrapped: a rejection becomes `next(err)`.
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}
