"use client";

import type { Job } from "@/lib/types";

export function scoreClass(score: number | null | undefined): string {
    const value = score ?? 0;
    if (value >= 60) return "score-high";
    if (value >= 35) return "score-mid";
    return "score-low";
}

export function statusClass(status: string | null | undefined): string {
    const known = ["new", "reviewed", "applied", "stale"];
    return `status-${status && known.includes(status) ? status : "new"}`;
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
    return <div className={`score-badge ${scoreClass(score)}`}>{score ?? 0}</div>;
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
    return (
        <span className={`status-badge ${statusClass(status)}`}>
            {status ?? "new"}
        </span>
    );
}

const INDIA_LABELS: Record<string, string> = {
    yes: "India OK",
    maybe: "Maybe India",
    no: "Not India",
    unknown: "Unknown",
};

export function IndiaBadge({
    value,
    note,
}: {
    value: string | null | undefined;
    note?: string | null;
}) {
    const key = value && INDIA_LABELS[value] ? value : "unknown";
    return (
        <span className={`india-${key}`} title={note ?? undefined}>
            {INDIA_LABELS[key]}
        </span>
    );
}

export function formatDate(value: string | null | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export function formatSeconds(total: number): string {
    const rounded = Math.max(0, Math.round(total));
    if (rounded < 60) return `${rounded}s`;
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function techTags(job: Job, max?: number): string[] {
    const tags = (job.tech_stack ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    return max ? tags.slice(0, max) : tags;
}
