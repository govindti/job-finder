// ── Time helpers ──────────────────────────────────────────────────────

// Timestamps are naive UTC (no trailing Z), e.g. 2026-11-01T12:34:56.789012.
// This shape makes lexicographic comparisons in SQL
// (last_seen < cutoff, created_at >= batch) behave correctly.
export function utcNowIso(): string {
    return new Date().toISOString().replace("Z", "");
}

export function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace("Z", "");
}
