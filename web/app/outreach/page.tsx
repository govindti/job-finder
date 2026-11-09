"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { Toast } from "@/components/Toast";
import { formatDateTime } from "@/components/Badges";
import { api, qs } from "@/lib/api";
import { useToast } from "@/lib/useToast";
import type {
    DigestPreview,
    EmailStatus,
    HunterStatus,
    LinkedInSearch,
    OutreachItem,
    OutreachStats,
} from "@/lib/types";

type Batch = "new" | "old" | "all";

const STATUS_CLASS: Record<string, string> = {
    pending: "new",
    emailed: "reviewed",
    messaged: "reviewed",
    replied: "applied",
    followed_up: "reviewed",
};

const CATEGORY_COLORS: Record<string, string> = {
    engineering: "#0a66c2",
    executive: "#6c5ce7",
    hr: "#00b894",
};

const CATEGORY_LABELS: Record<string, string> = {
    engineering: "Engineering",
    executive: "C-Level",
    hr: "HR / Recruiters",
};

function parseSearches(item: OutreachItem): LinkedInSearch[] {
    try {
        const parsed = JSON.parse(item.notes || "[]") as unknown;
        if (Array.isArray(parsed) && parsed.length) {
            return parsed.filter(
                (entry): entry is LinkedInSearch =>
                    typeof entry === "object" &&
                    entry !== null &&
                    typeof (entry as { label?: unknown }).label === "string" &&
                    typeof (entry as { url?: unknown }).url === "string",
            );
        }
    } catch {
        /* fall through to the legacy single link */
    }
    return [
        {
            label: "Search LinkedIn",
            url: item.contact_linkedin || "#",
            category: "engineering",
        },
    ];
}

export default function OutreachPage() {
    const [items, setItems] = useState<OutreachItem[]>([]);
    const [stats, setStats] = useState<OutreachStats | null>(null);
    const [batch, setBatch] = useState<Batch>("new");
    const [statusFilter, setStatusFilter] = useState("pending");
    const [searchDraft, setSearchDraft] = useState("");
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [lastBatchAt, setLastBatchAt] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
    const [hunter, setHunter] = useState<HunterStatus | null>(null);
    const [activeProfile, setActiveProfile] = useState("…");

    const { toast, showToast } = useToast();

    const loadOutreach = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api<{
                outreach: OutreachItem[];
                count: number;
                last_batch_at: string | null;
            }>(
                `/outreach${qs({
                    status: statusFilter,
                    search,
                    batch,
                })}`,
            );
            const nextItems = data.outreach ?? [];
            setItems(nextItems);
            setLastBatchAt(data.last_batch_at ?? null);
            const ids = new Set(nextItems.map((item) => item.id));
            setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to load outreach", "error");
        } finally {
            setLoading(false);
        }
    }, [batch, statusFilter, search, showToast]);

    const loadStats = useCallback(async () => {
        try {
            setStats(await api<OutreachStats>("/outreach/stats"));
        } catch {
            /* ignore */
        }
    }, []);

    const loadEmailStatus = useCallback(async () => {
        try {
            setEmailStatus(await api<EmailStatus>("/email/status"));
        } catch {
            setEmailStatus(null);
        }
    }, []);

    const loadHunterStatus = useCallback(async () => {
        try {
            setHunter(await api<HunterStatus>("/hunter/status"));
        } catch {
            setHunter(null);
        }
    }, []);

    const loadActiveProfile = useCallback(async () => {
        try {
            const data = await api<{ name: string | null }>("/profiles/active");
            setActiveProfile(data.name || "(none)");
        } catch {
            setActiveProfile("(none)");
        }
    }, []);

    useEffect(() => {
        void loadOutreach();
    }, [loadOutreach]);

    useEffect(() => {
        void loadStats();
        void loadEmailStatus();
        void loadHunterStatus();
        void loadActiveProfile();
    }, [loadStats, loadEmailStatus, loadHunterStatus, loadActiveProfile]);

    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchDraft), 400);
        return () => clearTimeout(timer);
    }, [searchDraft]);

    function switchBatch(next: Batch): void {
        setBatch(next);
        setSelected(new Set());
    }

    function toggleSelectOne(id: string, checked: boolean): void {
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    }

    function toggleSelectAll(checked: boolean): void {
        setSelected(checked ? new Set(items.map((item) => item.id)) : new Set());
    }

    async function bulkDeleteSelected(): Promise<void> {
        if (selected.size === 0) {
            showToast("Nothing selected", "error");
            return;
        }
        if (
            !window.confirm(
                `Delete ${selected.size} outreach item(s)? This is not reversible.`,
            )
        ) {
            return;
        }
        setBusy("delete");
        try {
            const data = await api<{ deleted: number }>("/outreach/bulk-delete", {
                method: "POST",
                body: { ids: [...selected] },
            });
            showToast(`Deleted ${data.deleted} item(s)`);
            setSelected(new Set());
            await Promise.all([loadOutreach(), loadStats()]);
        } catch (err) {
            showToast(
                `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
                "error",
            );
        } finally {
            setBusy(null);
        }
    }

    async function previewEmail(): Promise<void> {
        setBusy("preview");
        try {
            const data = await api<DigestPreview>("/email/send-now?dry_run=true", {
                method: "POST",
            });
            if (data.error) {
                showToast(data.error, "error");
            } else if (data.items_count === 0 || data.sent === 0) {
                showToast(data.message || "No new items to email");
            } else {
                const companies = (data.preview ?? [])
                    .map((entry) => entry.company)
                    .filter(Boolean)
                    .join(", ");
                showToast(`Would send ${data.items_count} items: ${companies}`);
            }
        } catch (err) {
            showToast(
                `Failed: ${err instanceof Error ? err.message : String(err)}`,
                "error",
            );
        } finally {
            setBusy(null);
        }
    }

    async function sendEmailNow(): Promise<void> {
        const who = emailStatus?.candidate_name || "the recipient";
        const to = emailStatus?.recipient || "(recipient)";
        if (!window.confirm(`Send the daily digest email now to ${who} (${to})?`)) return;
        setBusy("send");
        try {
            const data = await api<DigestPreview>("/email/send-now", { method: "POST" });
            if (data.error) {
                showToast(`Failed: ${data.error}`, "error");
            } else if (data.sent) {
                showToast(`✓ Sent ${data.sent} items to ${data.recipient}`);
                await loadOutreach();
            } else {
                showToast(
                    (data.message || "No items to send") +
                        ' — click "Find Contacts for Top Jobs" to generate more.',
                );
            }
        } catch (err) {
            showToast(
                `Failed: ${err instanceof Error ? err.message : String(err)}`,
                "error",
            );
        } finally {
            setBusy(null);
        }
    }

    async function syncOutreach(): Promise<void> {
        setBusy("sync");
        try {
            const data = await api<{ generated?: number; error?: string; message?: string }>(
                "/outreach/generate?min_score=40&limit=15&india_friendly=maybe",
                { method: "POST" },
            );
            if (data.error) {
                showToast(data.error, "error");
            } else if (data.generated === 0) {
                showToast(
                    data.message ||
                        "No new jobs eligible for outreach — try Refresh to collect fresh jobs",
                );
            } else {
                showToast(`Generated ${data.generated} outreach items`);
                switchBatch("new");
            }
            await Promise.all([loadOutreach(), loadStats(), loadHunterStatus()]);
        } catch (err) {
            showToast(
                `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
                "error",
            );
        } finally {
            setBusy(null);
        }
    }

    async function refreshOutreach(): Promise<void> {
        if (
            !window.confirm(
                "Run a fresh Collect Jobs and generate 15 new outreach items? Takes 1–3 minutes.",
            )
        ) {
            return;
        }
        setBusy("refresh");
        try {
            const data = await api<{
                collected?: { new?: number };
                generated?: number;
            }>("/outreach/refresh?limit=15", { method: "POST" });
            showToast(
                `Collected ${data.collected?.new ?? 0} new jobs · generated ${
                    data.generated ?? 0
                } outreach items`,
            );
            switchBatch("new");
            await Promise.all([loadOutreach(), loadStats(), loadHunterStatus()]);
        } catch (err) {
            showToast(
                `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
                "error",
            );
        } finally {
            setBusy(null);
        }
    }

    async function setStatus(id: string, status: string): Promise<void> {
        try {
            await api(`/outreach/${id}/status${qs({ status })}`, { method: "PATCH" });
            showToast(`Marked as ${status}`);
            await Promise.all([loadOutreach(), loadStats()]);
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Update failed", "error");
        }
    }

    async function copyDM(item: OutreachItem, variant: "short" | "long"): Promise<void> {
        const text = variant === "short" ? item.dm_short ?? "" : item.dm_long ?? "";
        try {
            await navigator.clipboard.writeText(text);
            showToast(`${variant} DM copied!`);
        } catch {
            showToast("Could not copy to clipboard", "error");
        }
    }

    const showSelect = batch !== "new";
    const allSelected = items.length > 0 && selected.size === items.length;

    return (
        <>
            <div className="header">
                <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                    <h1>Job Scraper</h1>
                    <Nav />
                </div>
                <div className="header-actions">
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        Profile: {activeProfile}
                    </span>
                    <span
                        style={{
                            fontSize: 12,
                            color: hunter?.configured && !hunter.error ? "var(--text-muted)" : "var(--red)",
                        }}
                    >
                        {!hunter
                            ? "Hunter: loading..."
                            : !hunter.configured
                              ? "Hunter: not configured"
                              : hunter.error
                                ? `Hunter: ${hunter.error}`
                                : `Hunter: ${hunter.used ?? 0}/${
                                      (hunter.used ?? 0) + (hunter.available ?? 0)
                                  } used (${hunter.plan ?? ""})`}
                    </span>
                    <span
                        style={{
                            fontSize: 12,
                            color:
                                emailStatus?.sender_configured && emailStatus.recipient
                                    ? "var(--text-muted)"
                                    : "var(--red)",
                        }}
                    >
                        {!emailStatus
                            ? "📧 Email: loading..."
                            : !emailStatus.sender_configured
                              ? "📧 Email: not configured"
                              : !emailStatus.recipient
                                ? "📧 Recipient not set"
                                : `📧 Daily ${emailStatus.scheduled_hour}:00 IST · ${emailStatus.sender} → ${emailStatus.recipient}`}
                    </span>
                    <button
                        className="btn btn-outline"
                        disabled={busy === "preview"}
                        onClick={() => void previewEmail()}
                    >
                        {busy === "preview" ? "Checking..." : "Preview Email"}
                    </button>
                    <button
                        className="btn btn-yellow"
                        disabled={busy === "send"}
                        onClick={() => void sendEmailNow()}
                    >
                        {busy === "send" ? "Sending..." : "Send Email Now"}
                    </button>
                    <button
                        className="btn btn-outline"
                        title="Generate 15 new outreach items from jobs already in the DB — no collection run"
                        disabled={busy === "sync"}
                        onClick={() => void syncOutreach()}
                    >
                        {busy === "sync" ? "Syncing…" : "⟳ Sync"}
                    </button>
                    <button
                        className="btn btn-green"
                        title="Run a fresh Collect Jobs, then generate 15 new outreach items from the results"
                        disabled={busy === "refresh"}
                        onClick={() => void refreshOutreach()}
                    >
                        {busy === "refresh" ? "Refreshing… (1–3 min)" : "🔄 Refresh"}
                    </button>
                </div>
            </div>

            <div className="stats-bar">
                <div className="stat-card">
                    <div className="label">Total</div>
                    <div className="value">{stats?.total ?? 0}</div>
                </div>
                <div className="stat-card" style={{ borderColor: "var(--blue)" }}>
                    <div className="label">Pending</div>
                    <div className="value" style={{ color: "var(--blue)" }}>
                        {stats?.by_status.pending ?? 0}
                    </div>
                </div>
                <div className="stat-card" style={{ borderColor: "var(--primary)" }}>
                    <div className="label">Emailed</div>
                    <div className="value" style={{ color: "var(--primary)" }}>
                        {stats?.by_status.emailed ?? 0}
                    </div>
                </div>
                <div className="stat-card" style={{ borderColor: "var(--yellow)" }}>
                    <div className="label">Messaged</div>
                    <div className="value" style={{ color: "var(--yellow)" }}>
                        {stats?.by_status.messaged ?? 0}
                    </div>
                </div>
                <div className="stat-card" style={{ borderColor: "var(--green)" }}>
                    <div className="label">Replied</div>
                    <div className="value" style={{ color: "var(--green)" }}>
                        {stats?.by_status.replied ?? 0}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="label">Followed Up</div>
                    <div className="value">{stats?.by_status.followed_up ?? 0}</div>
                </div>
            </div>

            <nav className="tab-bar" style={{ padding: "0 32px" }}>
                {(
                    [
                        ["new", "New (latest batch)"],
                        ["old", "Old"],
                        ["all", "All"],
                    ] as const
                ).map(([value, label]) => (
                    <a
                        key={value}
                        className={`tab-link${batch === value ? " active" : ""}`}
                        onClick={() => switchBatch(value)}
                    >
                        {label}
                    </a>
                ))}
                <span
                    style={{
                        marginLeft: "auto",
                        fontSize: 12,
                        color: "var(--text-muted)",
                        alignSelf: "center",
                    }}
                >
                    {batch === "new"
                        ? lastBatchAt
                            ? `Latest generation: ${formatDateTime(lastBatchAt)} · ${
                                  items.length
                              } items`
                            : 'No generation yet — click "Find Contacts for Top Jobs"'
                        : batch === "old"
                          ? `${items.length} older items`
                          : `${items.length} items total`}
                </span>
            </nav>

            <div className="filters">
                <div className="filter-group">
                    <label>Status</label>
                    <select
                        value={statusFilter}
                        onChange={(event) => {
                            setStatusFilter(event.target.value);
                            setSelected(new Set());
                        }}
                    >
                        <option value="">All</option>
                        <option value="pending">Pending (Ready to Send)</option>
                        <option value="emailed">Emailed (Ready to Message)</option>
                        <option value="messaged">Messaged</option>
                        <option value="replied">Replied</option>
                        <option value="followed_up">Followed Up</option>
                    </select>
                </div>
                <div className="filter-group">
                    <label>Search</label>
                    <input
                        type="text"
                        placeholder="Company, role, contact..."
                        value={searchDraft}
                        onChange={(event) => setSearchDraft(event.target.value)}
                    />
                </div>
                {showSelect && (
                    <div
                        className="filter-group"
                        style={{
                            marginLeft: "auto",
                            flexDirection: "row",
                            alignItems: "flex-end",
                            gap: 8,
                        }}
                    >
                        <label style={{ fontSize: 12 }}>
                            <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={(event) => toggleSelectAll(event.target.checked)}
                            />{" "}
                            Select all
                        </label>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {selected.size} selected
                        </span>
                        <button
                            className="btn btn-outline"
                            style={{ color: "var(--red)", borderColor: "var(--red)" }}
                            disabled={busy === "delete"}
                            onClick={() => void bulkDeleteSelected()}
                        >
                            {busy === "delete" ? "Deleting..." : "Delete Selected"}
                        </button>
                    </div>
                )}
            </div>

            <div className="content">
                {loading ? (
                    <div className="loading">
                        <div className="spinner" /> Loading outreach...
                    </div>
                ) : items.length === 0 ? (
                    <div className="empty-state">
                        <h3>No outreach items yet</h3>
                        <p>
                            Click &quot;Find Contacts for Top Jobs&quot; to scan your top-scoring
                            jobs and pull hiring contacts.
                        </p>
                    </div>
                ) : (
                    items.map((item) => {
                        const searches = parseSearches(item);
                        const grouped: Record<string, LinkedInSearch[]> = {};
                        for (const searchEntry of searches) {
                            const category = searchEntry.category || "engineering";
                            (grouped[category] ||= []).push(searchEntry);
                        }
                        return (
                            <div className="outreach-card" key={item.id}>
                                <div className="outreach-header">
                                    <div style={{ display: "flex", alignItems: "flex-start" }}>
                                        {showSelect && (
                                            <input
                                                type="checkbox"
                                                checked={selected.has(item.id)}
                                                onChange={(event) =>
                                                    toggleSelectOne(
                                                        item.id,
                                                        event.target.checked,
                                                    )
                                                }
                                                style={{
                                                    marginRight: 10,
                                                    transform: "scale(1.2)",
                                                }}
                                            />
                                        )}
                                        <div>
                                            <h3>
                                                {item.job_title}{" "}
                                                <span
                                                    style={{
                                                        color: "var(--text-muted)",
                                                        fontWeight: "normal",
                                                    }}
                                                >
                                                    @ {item.company}
                                                </span>
                                            </h3>
                                            <div
                                                style={{
                                                    color: "var(--text-muted)",
                                                    fontSize: 13,
                                                    marginTop: 4,
                                                }}
                                            >
                                                Created {formatDateTime(item.created_at)}
                                            </div>
                                        </div>
                                    </div>
                                    <span
                                        className={`status-badge status-${
                                            STATUS_CLASS[item.status ?? ""] ?? "reviewed"
                                        }`}
                                    >
                                        {(item.status ?? "pending").replaceAll("_", " ")}
                                    </span>
                                </div>

                                <div className="outreach-contact">
                                    <div
                                        style={{
                                            fontSize: 11,
                                            color: "var(--text-muted)",
                                            textTransform: "uppercase",
                                            letterSpacing: "0.5px",
                                            marginBottom: 8,
                                        }}
                                    >
                                        Find someone at {item.company}
                                    </div>
                                    {Object.entries(grouped).map(([category, group]) => (
                                        <div key={category} style={{ marginBottom: 8 }}>
                                            <div
                                                style={{
                                                    fontSize: 10,
                                                    color: "var(--text-muted)",
                                                    marginBottom: 4,
                                                }}
                                            >
                                                {CATEGORY_LABELS[category] ?? category}
                                            </div>
                                            {group.map((searchEntry, index) => (
                                                <a
                                                    key={`${searchEntry.label}-${index}`}
                                                    href={searchEntry.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="btn btn-sm"
                                                    style={{
                                                        background:
                                                            CATEGORY_COLORS[category] ??
                                                            "#0a66c2",
                                                        color: "white",
                                                        margin: "2px 4px 2px 0",
                                                    }}
                                                >
                                                    🔍 {searchEntry.label}
                                                </a>
                                            ))}
                                        </div>
                                    ))}
                                </div>

                                <div className="outreach-dm">
                                    <div className="dm-label">
                                        LinkedIn DM (short — for connection request):
                                    </div>
                                    <div className="dm-text">{item.dm_short}</div>
                                </div>

                                <details style={{ marginTop: 8 }}>
                                    <summary
                                        style={{
                                            cursor: "pointer",
                                            color: "var(--primary)",
                                            fontSize: 13,
                                        }}
                                    >
                                        Show long version (for direct message)
                                    </summary>
                                    <div
                                        className="dm-text"
                                        style={{ marginTop: 8, whiteSpace: "pre-wrap" }}
                                    >
                                        {item.dm_long}
                                    </div>
                                </details>

                                <div className="outreach-actions">
                                    {item.job_url && (
                                        <a
                                            href={item.job_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="btn btn-primary btn-sm"
                                        >
                                            Apply to Job
                                        </a>
                                    )}
                                    <button
                                        className="btn btn-outline btn-sm"
                                        onClick={() => void copyDM(item, "short")}
                                    >
                                        Copy Short DM
                                    </button>
                                    <button
                                        className="btn btn-outline btn-sm"
                                        onClick={() => void copyDM(item, "long")}
                                    >
                                        Copy Long DM
                                    </button>
                                    {(item.status === "pending" ||
                                        item.status === "emailed") && (
                                        <button
                                            className="btn btn-yellow btn-sm"
                                            onClick={() => void setStatus(item.id, "messaged")}
                                        >
                                            Mark Messaged
                                        </button>
                                    )}
                                    {item.status === "messaged" && (
                                        <>
                                            <button
                                                className="btn btn-green btn-sm"
                                                onClick={() => void setStatus(item.id, "replied")}
                                            >
                                                Mark Replied
                                            </button>
                                            <button
                                                className="btn btn-outline btn-sm"
                                                onClick={() =>
                                                    void setStatus(item.id, "followed_up")
                                                }
                                            >
                                                Mark Followed Up
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <Toast toast={toast} />
        </>
    );
}
