export function groupCount(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) {
        const k = (r[key] ?? "") as string;
        out[k] = r.count as number;
    }
    return out;
}
