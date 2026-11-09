import { Router } from "express";
import { env } from "../config/env.js";
import { exportToSheet, sheetsConfig } from "../email/sheets.js";
import { toInt, toStr } from "./util.js";

// ── Google Sheets export routes ─────────────────────────────
export const exportRouter = Router();

exportRouter.post("/export/sheets", async (req, res) => {
    const q = req.query;
    const { sheetId, credsPath, credsExists } = sheetsConfig();
    if (!sheetId) {
        res.json({ error: "GOOGLE_SHEET_ID not set in .env" });
        return;
    }
    if (!credsExists) {
        res.json({ error: `Credentials file not found: ${credsPath}` });
        return;
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
        res.json(result);
    } catch (err) {
        res.json({ error: String(err) });
    }
});

exportRouter.get("/export/sheets/status", (_req, res) => {
    const { sheetId, credsExists } = sheetsConfig();
    res.json({
        configured: Boolean(env.GOOGLE_SHEET_ID) && credsExists,
        sheet_id: env.GOOGLE_SHEET_ID ? `${sheetId.slice(0, 10)}...` : "",
        creds_exists: credsExists,
    });
});
