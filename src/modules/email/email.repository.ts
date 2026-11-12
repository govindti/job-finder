import { query } from "../../infrastructure/database/connection.js";
import { utcNowIso } from "../../common/utils/time.js";
import type { EmailLogRow } from "./email.types.js";

export async function logEmail(
    recipient: string,
    subject: string,
    itemsCount: number,
    outreachIds: string[],
    status = "sent",
    error = "",
): Promise<void> {
    await query(
        `INSERT INTO email_log (sent_at, recipient, subject, items_count, outreach_ids, status, error)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [utcNowIso(), recipient, subject, itemsCount, outreachIds.join(","), status, error],
    );
}

export async function getEmailLogs(limit = 30): Promise<EmailLogRow[]> {
    const res = await query<EmailLogRow>(
        "SELECT * FROM email_log ORDER BY sent_at DESC LIMIT $1",
        [limit],
    );
    return res.rows;
}
