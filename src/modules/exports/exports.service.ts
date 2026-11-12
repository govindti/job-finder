import { AppError } from "../../common/errors/app-error.js";
import { getJobs } from "../jobs/jobs.service.js";
import { exportToSheet, sheetsConfig } from "./sheets.adapter.js";
import type { ExportQuery } from "./exports.dto.js";

export function getSheetsStatus() {
    const { sheetId, credsExists } = sheetsConfig();
    return { configured: Boolean(sheetId) && credsExists, sheet_id: sheetId ? `${sheetId.slice(0, 10)}...` : "", creds_exists: credsExists };
}

export async function exportJobs(input: ExportQuery) {
    const { sheetId, credsPath, credsExists } = sheetsConfig();
    if (!sheetId) throw new AppError("SHEETS_NOT_CONFIGURED");
    if (!credsExists) throw new AppError("SHEETS_CREDENTIALS_MISSING");
    const jobs = await getJobs({
        min_score: input.minScore, india_friendly: input.indiaFriendly,
        source: input.source, search: input.search, tech: input.tech, limit: 500,
    });
    try {
        return await exportToSheet({ credsFile: credsPath, spreadsheetId: sheetId, sheetName: input.sheetName, mode: input.mode, jobs });
    } catch (cause) {
        throw new AppError("SHEETS_EXPORT_FAILED", { cause });
    }
}
