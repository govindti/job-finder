export interface ApiOptions extends Omit<RequestInit, "body"> {
    body?: unknown;
}

interface ErrorBody {
    detail?: string;
    error?: string;
}

/** Small typed wrapper around fetch for the native Bun API (proxied by Next). */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
    const { body, headers, ...rest } = opts;
    const finalHeaders: Record<string, string> = {
        ...(headers as Record<string, string> | undefined),
    };

    let requestBody: BodyInit | undefined;
    if (body !== undefined) {
        requestBody = typeof body === "string" ? body : JSON.stringify(body);
        if (!finalHeaders["Content-Type"]) {
            finalHeaders["Content-Type"] = "application/json";
        }
    }

    const resp = await fetch(`/api${path}`, {
        ...rest,
        headers: finalHeaders,
        body: requestBody,
    });

    const text = await resp.text();
    let data: unknown = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }

    if (!resp.ok) {
        const err = (data ?? {}) as ErrorBody;
        const detail =
            err.detail ||
            err.error ||
            (typeof data === "string" ? data : "") ||
            resp.statusText;
        throw new Error(`${resp.status}: ${detail}`);
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
