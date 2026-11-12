export interface CollectionStats {
    fetched: number;
    new: number;
    updated: number;
    filtered_out: number;
    sources: Record<string, number>;
    companies_crawled?: number;
    companies_failed?: number;
    deleted_stale?: number;
    board_sources?: Record<string, number>;
    outreach_generated?: number;
}
