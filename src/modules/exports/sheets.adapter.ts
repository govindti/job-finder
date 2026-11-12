import fs from "node:fs";
import { google } from "googleapis";
import { env, resolveCredsPath } from "../../config/env.js";
import { type JobRow } from "../jobs/jobs.types.js";

// Google Sheets export via googleapis (Sheets v4). Header order and the A1:N1
// bold formatting are fixed for a consistent output.

const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
];

const HEADERS = [
    "Title", "Company", "Location", "India Friendly", "Location Note",
    "Relevance Score", "Tech Stack", "Experience Level", "Salary",
    "Job URL", "Source", "Posted Date", "Status", "Company Domain",
];

function jobToRow(job: JobRow): Array<string | number> {
    return [
        job.title ?? "",
        job.company ?? "",
        job.location ?? "",
        job.india_friendly ?? "unknown",
        job.location_note ?? "",
        job.relevance_score ?? 0,
        job.tech_stack ?? "",
        job.experience_level ?? "",
        job.salary ?? "",
        job.url ?? "",
        job.source ?? "",
        job.posted_date ?? "",
        job.status ?? "new",
        job.company_domain ?? "",
    ];
}

export interface ExportOptions {
    credsFile: string;
    spreadsheetId: string;
    sheetName?: string;
    jobs: JobRow[];
    mode?: "replace" | "append";
}

export interface ExportResult {
    exported: number;
    sheet_name: string;
    spreadsheet_id: string;
    mode: string;
}

export async function exportToSheet(opts: ExportOptions): Promise<ExportResult> {
    const sheetName = opts.sheetName ?? "Jobs";
    const mode = opts.mode ?? "replace";

    const auth = new google.auth.GoogleAuth({
        keyFile: opts.credsFile,
        scopes: SCOPES,
    });
    const sheets = google.sheets({ version: "v4", auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: opts.spreadsheetId });
    let sheet = meta.data.sheets?.find((s) => s.properties?.title === sheetName);
    if (!sheet) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: opts.spreadsheetId,
            requestBody: {
                requests: [{ addSheet: { properties: { title: sheetName, gridProperties: { rowCount: 1000, columnCount: HEADERS.length } } } }],
            },
        });
        const refetch = await sheets.spreadsheets.get({ spreadsheetId: opts.spreadsheetId });
        sheet = refetch.data.sheets?.find((s) => s.properties?.title === sheetName);
    }
    const sheetId = sheet?.properties?.sheetId ?? 0;

    const rows = opts.jobs.map(jobToRow);

    if (mode === "replace") {
        await sheets.spreadsheets.values.clear({
            spreadsheetId: opts.spreadsheetId,
            range: `${sheetName}`,
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: opts.spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [HEADERS, ...rows] },
        });
    } else {
        const existing = await sheets.spreadsheets.values.get({
            spreadsheetId: opts.spreadsheetId,
            range: `${sheetName}!A1:N1`,
        });
        const hasHeader = (existing.data.values?.length ?? 0) > 0;
        if (!hasHeader) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: opts.spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [HEADERS] },
            });
        }
        if (rows.length) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: opts.spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: rows },
            });
        }
    }

    // Auto-format the header row bold with a dark background.
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: opts.spreadsheetId,
        requestBody: {
            requests: [
                {
                    repeatCell: {
                        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
                        cell: {
                            userEnteredFormat: {
                                textFormat: { bold: true },
                                backgroundColor: { red: 0.15, green: 0.15, blue: 0.2 },
                            },
                        },
                        fields: "userEnteredFormat(textFormat,backgroundColor)",
                    },
                },
            ],
        },
    });

    return { exported: rows.length, sheet_name: sheetName, spreadsheet_id: opts.spreadsheetId, mode };
}

/** Shared config-presence check used by the status + export endpoints. */
export function sheetsConfig(): { sheetId: string; credsPath: string; credsExists: boolean } {
    const credsPath = resolveCredsPath();
    return {
        sheetId: env.GOOGLE_SHEET_ID,
        credsPath,
        credsExists: fs.existsSync(credsPath),
    };
}
