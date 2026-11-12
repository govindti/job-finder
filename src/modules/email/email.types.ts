export interface EmailLogRow {
    id: number;
    sent_at: string;
    recipient: string;
    subject: string | null;
    items_count: number | null;
    outreach_ids: string | null;
    status: string | null;
    error: string | null;
}
