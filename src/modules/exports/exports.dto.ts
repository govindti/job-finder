import { getQuery, toInt, toStr } from "../../common/http/request.js";

export function parseExportQuery(req: Request) {
    const q = getQuery(req);
    return {
        sheetName: toStr(q.sheet_name) ?? "Jobs",
        minScore: toInt(q.min_score, 0, 0, 100),
        indiaFriendly: toStr(q.india_friendly),
        source: toStr(q.source), search: toStr(q.search), tech: toStr(q.tech),
        mode: (toStr(q.mode) === "append" ? "append" : "replace") as "append" | "replace",
    };
}

export type ExportQuery = ReturnType<typeof parseExportQuery>;
