import { env } from "../config/env.js";
import { exportToSheet, sheetsConfig } from "../email/sheets.js";
import { toInt, toStr, getQuery } from "./util.js";

// ── Google Sheets export routes ─────────────────────────────

export const exportRoutes = {
    "/api/export/sheets": {
        POST: async (req) => {
            const q = getQuery(req);
            const { sheetId, credsPath, credsExists } = sheetsConfig();
            if (!sheetId) {
                return Response.json({ error: "GOOGLE_SHEET_ID not set in .env" });
            }
            if (!credsExists) {
                return Response.json({ error: `Credentials file not found: ${credsPath}` });
            }
            try {
                const result = await exportToSheet({
                    credsFile: credsPath,
                    spreadsheetId: env.GOOGLE_SHEET_ID,
                    sheetName: toStr(q.sheet_name) ?? "Jobs",
                    minScore: toInt(q.min_score, 0, 0, 100),
                    indiaFriendly: toStr(q.india_friendly),
                    source: toStr(q.source),
                    search: toStr(q.search),
                    tech: toStr(q.tech),
                    mode: (toStr(q.mode) ?? "replace") === "append" ? "append" : "replace",
                });
                return Response.json(result);
            } catch (err) {
                return Response.json({ error: String(err) });
            }
        },
    },
    "/api/export/sheets/status": {
        GET: (_req) => {
            const { sheetId, credsExists } = sheetsConfig();
            return Response.json({
                configured: Boolean(env.GOOGLE_SHEET_ID) && credsExists,
                sheet_id: env.GOOGLE_SHEET_ID ? `${sheetId.slice(0, 10)}...` : "",
                creds_exists: credsExists,
            });
        },
    },
} satisfies Bun.Serve.Routes<undefined, string>;
