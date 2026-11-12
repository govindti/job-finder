"use client";

import { formatApiError } from "../lib/api-error";

import { useCallback, useEffect, useRef, useState } from "react";
import { Nav } from "@/components/Nav";
import { Modal } from "@/components/Modal";
import { Toast } from "@/components/Toast";
import {
    IndiaBadge,
    ScoreBadge,
    StatusBadge,
    formatDate,
    formatSeconds,
    scoreClass,
    statusClass,
    techTags,
} from "@/components/Badges";
import { api, qs } from "@/lib/api";
import { useToast } from "@/lib/useToast";
import type {
    CollectionStats,
    Job,
    JobStats,
    JSearchStatus,
    SearchQuery,
    SheetsStatus,
} from "@/lib/types";

interface Filters {
    source: string;
    status: string;
    min_score: number;
    search: string;
    location: string;
    tech: string;
    india_friendly: string;
}

const EMPTY_FILTERS: Filters = {
    source: "",
    status: "",
    min_score: 0,
    search: "",
    location: "",
    tech: "",
    india_friendly: "",
};

const PAGE_SIZE = 50;

export default function JobsPage() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [stats, setStats] = useState<JobStats | null>(null);
    const [sources, setSources] = useState<string[]>([]);
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [searchDraft, setSearchDraft] = useState("");
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);

    const [collecting, setCollecting] = useState(false);
    const [collectElapsed, setCollectElapsed] = useState(0);
    const [collectEstimate, setCollectEstimate] = useState<number | null>(null);
    const collectTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const [activeProfile, setActiveProfile] = useState("…");
    const [jsearch, setJsearch] = useState<JSearchStatus | null>(null);
    const [sheetsConfigured, setSheetsConfigured] = useState(true);

    const [selectedJob, setSelectedJob] = useState<Job | null>(null);
    const [queriesOpen, setQueriesOpen] = useState(false);
    const [queries, setQueries] = useState<SearchQuery[]>([]);
    const [newQuery, setNewQuery] = useState({
        query: "",
        country: "IN",
        date_posted: "3days",
        remote_jobs_only: false,
    });
    const [exportOpen, setExportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportForm, setExportForm] = useState({
        sheet_name: "Jobs",
        min_score: 50,
        india_friendly: "",
        mode: "replace",
    });

    const { toast, showToast } = useToast();

    const loadJobs = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api<{ jobs: Job[]; count: number }>(
                `/jobs${qs({
                    source: filters.source,
                    status: filters.status,
                    min_score: filters.min_score || 0,
                    search: filters.search,
                    location: filters.location,
                    tech: filters.tech,
                    india_friendly: filters.india_friendly,
                    limit: PAGE_SIZE,
                    offset,
                })}`,
            );
            setJobs(data.jobs ?? []);
        } catch (err) {
            showToast(formatApiError(err, "Failed to load jobs"), "error");
        } finally {
            setLoading(false);
        }
    }, [filters, offset, showToast]);

    const loadStats = useCallback(async () => {
        try {
            setStats(await api<JobStats>("/stats"));
        } catch {
            /* dashboard still works without stats */
        }
    }, []);

    const loadSources = useCallback(async () => {
        try {
            const data = await api<{ sources: string[] }>("/sources");
            setSources(data.sources ?? []);
        } catch {
            /* ignore */
        }
    }, []);

    const loadJSearchStatus = useCallback(async () => {
        try {
            setJsearch(await api<JSearchStatus>("/jsearch/status"));
        } catch {
            setJsearch(null);
        }
    }, []);

    const loadSheetsStatus = useCallback(async () => {
        try {
            const data = await api<SheetsStatus>("/export/sheets/status");
            setSheetsConfigured(Boolean(data.configured));
        } catch {
            setSheetsConfigured(false);
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
        void loadStats();
        void loadSources();
        void loadJSearchStatus();
        void loadSheetsStatus();
        void loadActiveProfile();
    }, [loadStats, loadSources, loadJSearchStatus, loadSheetsStatus, loadActiveProfile]);

    useEffect(() => {
        void loadJobs();
    }, [loadJobs]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setFilters((prev) =>
                prev.search === searchDraft ? prev : { ...prev, search: searchDraft },
            );
            setOffset(0);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchDraft]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === "Escape") {
                setSelectedJob(null);
                setQueriesOpen(false);
                setExportOpen(false);
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    useEffect(() => {
        return () => {
            if (collectTimer.current) clearInterval(collectTimer.current);
        };
    }, []);

    function setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
        setFilters((prev) => ({ ...prev, [key]: value }));
        setOffset(0);
    }

    function resetFilters(): void {
        setFilters(EMPTY_FILTERS);
        setSearchDraft("");
        setOffset(0);
    }

    async function estimateCollectionTime(): Promise<number> {
        let jsearchCount = 0;
        let activeCompanies = 0;
        try {
            const data = await api<{ queries: SearchQuery[] }>("/search-queries");
            jsearchCount = (data.queries ?? []).filter(
                (query) => query.enabled !== false && query.query,
            ).length;
        } catch {
            /* ignore */
        }
        try {
            const data = await api<{ by_status?: Record<string, number> }>("/companies/stats");
            activeCompanies = data.by_status?.active ?? 0;
        } catch {
            /* ignore */
        }
        const base = 15;
        const jsearch = jsearchCount * 4;
        const companyWaves = Math.ceil(activeCompanies / 5) * 3;
        return Math.max(10, base + jsearch + companyWaves);
    }

    async function collectJobs(): Promise<void> {
        if (collecting) return;
        setCollecting(true);
        setCollectElapsed(0);
        const estimate = await estimateCollectionTime();
        setCollectEstimate(estimate);
        const start = Date.now();
        if (collectTimer.current) clearInterval(collectTimer.current);
        collectTimer.current = setInterval(() => {
            setCollectElapsed(Math.floor((Date.now() - start) / 1000));
        }, 500);

        try {
            const result = await api<CollectionStats>("/collect", { method: "POST" });
            showToast(
                `Collection complete — ${result.new ?? 0} new jobs, ${
                    result.outreach_generated ?? 0
                } outreach items ready to email`,
            );
            await Promise.all([
                loadJobs(),
                loadStats(),
                loadSources(),
                loadJSearchStatus(),
            ]);
        } catch (err) {
            showToast(
                `Collection failed: ${formatApiError(err)}`,
                "error",
            );
        } finally {
            if (collectTimer.current) {
                clearInterval(collectTimer.current);
                collectTimer.current = null;
            }
            setCollecting(false);
        }
    }

    async function updateStatus(jobId: string, status: string): Promise<void> {
        try {
            await api(`/jobs/${jobId}/status${qs({ status })}`, { method: "PATCH" });
            showToast(`Status updated to ${status}`);
            setSelectedJob((prev) => (prev && prev.id === jobId ? { ...prev, status } : prev));
            await loadJobs();
        } catch (err) {
            showToast(formatApiError(err, "Status update failed"), "error");
        }
    }

    async function toggleMark(jobId: string): Promise<void> {
        try {
            const data = await api<{ mark_for_email: boolean }>(
                `/jobs/${jobId}/mark-for-email`,
                { method: "POST" },
            );
            showToast(data.mark_for_email ? "📧 Marked for email" : "Unmarked");
            setJobs((prev) =>
                prev.map((job) =>
                    job.id === jobId
                        ? { ...job, mark_for_email: data.mark_for_email ? 1 : 0 }
                        : job,
                ),
            );
            setSelectedJob((prev) =>
                prev && prev.id === jobId
                    ? { ...prev, mark_for_email: data.mark_for_email ? 1 : 0 }
                    : prev,
            );
        } catch (err) {
            showToast(formatApiError(err, "Could not toggle mark"), "error");
        }
    }

    async function loadQueries(): Promise<void> {
        try {
            const data = await api<{ queries: SearchQuery[] }>("/search-queries");
            setQueries(data.queries ?? []);
        } catch (err) {
            showToast(formatApiError(err, "Failed to load queries"), "error");
        }
    }

    async function openQueries(): Promise<void> {
        setQueriesOpen(true);
        await loadQueries();
    }

    async function patchQuery(
        id: number,
        field: keyof SearchQuery,
        value: string | boolean,
    ): Promise<void> {
        setQueries((prev) =>
            prev.map((query) => (query.id === id ? { ...query, [field]: value } : query)),
        );
        try {
            await api(`/search-queries/${id}`, {
                method: "PATCH",
                body: { [field]: value },
            });
        } catch (err) {
            showToast(formatApiError(err, "Update failed"), "error");
            await loadQueries();
        }
    }

    async function addQuery(): Promise<void> {
        if (!newQuery.query.trim()) {
            showToast("Query cannot be empty", "error");
            return;
        }
        try {
            await api("/search-queries", {
                method: "POST",
                body: { ...newQuery, query: newQuery.query.trim() },
            });
            setNewQuery({
                query: "",
                country: "IN",
                date_posted: "3days",
                remote_jobs_only: false,
            });
            showToast("Query added");
            await loadQueries();
        } catch (err) {
            showToast(formatApiError(err, "Could not add query"), "error");
        }
    }

    async function deleteQuery(id: number): Promise<void> {
        if (!window.confirm("Delete this query?")) return;
        try {
            await api(`/search-queries/${id}`, { method: "DELETE" });
            showToast("Query deleted");
            await loadQueries();
        } catch (err) {
            showToast(formatApiError(err, "Delete failed"), "error");
        }
    }

    async function doExport(): Promise<void> {
        setExporting(true);
        try {
            const data = await api<{ exported: number }>(
                `/export/sheets${qs({
                    sheet_name: exportForm.sheet_name,
                    min_score: exportForm.min_score,
                    india_friendly: exportForm.india_friendly,
                    mode: exportForm.mode,
                })}`,
                { method: "POST" },
            );
            showToast(`Exported ${data.exported ?? 0} jobs to Google Sheets!`);
            setExportOpen(false);
        } catch (err) {
            showToast(
                `Export failed: ${formatApiError(err)}`,
                "error",
            );
        } finally {
            setExporting(false);
        }
    }

    const indiaStats = stats?.by_india ?? {};
    const jsearchColor =
        jsearch && jsearch.configured
            ? jsearch.month / jsearch.monthly_limit >= 0.8
                ? "var(--red)"
                : jsearch.month / jsearch.monthly_limit >= 0.5
                  ? "var(--yellow)"
                  : "var(--green)"
            : "var(--red)";

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
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {jsearch ? (
                            jsearch.configured ? (
                                <span title={`Today: ${jsearch.today} calls`}>
                                    JSearch:{" "}
                                    <span style={{ color: jsearchColor, fontWeight: 600 }}>
                                        {jsearch.month}/{jsearch.monthly_limit}
                                    </span>{" "}
                                    this month ({jsearch.remaining} left)
                                </span>
                            ) : (
                                <span style={{ color: "var(--red)" }}>JSearch: not configured</span>
                            )
                        ) : (
                            "JSearch: loading..."
                        )}
                    </span>
                    <button className="btn btn-outline" onClick={() => void openQueries()}>
                        Search Queries
                    </button>
                    <button
                        className="btn btn-green"
                        title={
                            sheetsConfigured
                                ? undefined
                                : "Google Sheets not configured — add GOOGLE_SHEET_ID + credentials.json"
                        }
                        style={sheetsConfigured ? undefined : { opacity: 0.6 }}
                        onClick={() => setExportOpen(true)}
                    >
                        Export to Sheets
                    </button>
                    <button
                        className="btn btn-primary"
                        disabled={collecting}
                        onClick={() => void collectJobs()}
                    >
                        {collecting ? "Collecting..." : "Collect Jobs"}
                    </button>
                </div>
            </div>

            <div className="stats-bar">
                <div className="stat-card">
                    <div className="label">Total Jobs</div>
                    <div className="value">{stats?.total ?? 0}</div>
                </div>
                <div className="stat-card">
                    <div className="label">Avg Score</div>
                    <div className="value">{stats?.avg_score ?? 0}</div>
                </div>
                <div className="stat-card" style={{ borderColor: "var(--green)" }}>
                    <div className="label">India Friendly</div>
                    <div className="value" style={{ color: "var(--green)" }}>
                        {indiaStats.yes ?? 0}
                    </div>
                </div>
                <div className="stat-card" style={{ borderColor: "var(--yellow)" }}>
                    <div className="label">Maybe India</div>
                    <div className="value" style={{ color: "var(--yellow)" }}>
                        {indiaStats.maybe ?? 0}
                    </div>
                </div>
                <div className="stat-card" style={{ borderColor: "var(--red)" }}>
                    <div className="label">Not India</div>
                    <div className="value" style={{ color: "var(--red)" }}>
                        {indiaStats.no ?? 0}
                    </div>
                </div>
                {Object.entries(stats?.by_source ?? {}).map(([source, count]) => (
                    <div className="stat-card" key={source}>
                        <div className="label">{source}</div>
                        <div className="value">{count}</div>
                    </div>
                ))}
            </div>

            <div className="filters">
                <div className="filter-group">
                    <label>Search</label>
                    <input
                        type="text"
                        placeholder="Title, company..."
                        value={searchDraft}
                        onChange={(event) => setSearchDraft(event.target.value)}
                    />
                </div>
                <div className="filter-group">
                    <label>Source</label>
                    <select
                        value={filters.source}
                        onChange={(event) => setFilter("source", event.target.value)}
                    >
                        <option value="">All Sources</option>
                        {sources.map((source) => (
                            <option key={source} value={source}>
                                {source}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="filter-group">
                    <label>Status</label>
                    <select
                        value={filters.status}
                        onChange={(event) => setFilter("status", event.target.value)}
                    >
                        <option value="">All</option>
                        <option value="new">New</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="applied">Applied</option>
                        <option value="stale">Stale</option>
                    </select>
                </div>
                <div className="filter-group">
                    <label>Min Score</label>
                    <select
                        value={filters.min_score}
                        onChange={(event) => setFilter("min_score", Number(event.target.value))}
                    >
                        <option value={0}>Any</option>
                        <option value={30}>30+</option>
                        <option value={50}>50+</option>
                        <option value={60}>60+</option>
                        <option value={70}>70+</option>
                    </select>
                </div>
                <div className="filter-group">
                    <label>India Remote</label>
                    <select
                        value={filters.india_friendly}
                        onChange={(event) => setFilter("india_friendly", event.target.value)}
                    >
                        <option value="">All</option>
                        <option value="yes">India Friendly</option>
                        <option value="maybe">India + Maybe</option>
                        <option value="no">Not India</option>
                    </select>
                </div>
                <div className="filter-group">
                    <label>Location</label>
                    <input
                        type="text"
                        placeholder="e.g. Remote, USA"
                        value={filters.location}
                        onChange={(event) => setFilter("location", event.target.value)}
                    />
                </div>
                <div className="filter-group">
                    <label>Tech</label>
                    <input
                        type="text"
                        placeholder="e.g. python, django"
                        value={filters.tech}
                        onChange={(event) => setFilter("tech", event.target.value)}
                    />
                </div>
                <div className="filter-group" style={{ justifyContent: "flex-end" }}>
                    <label>&nbsp;</label>
                    <button className="btn btn-outline" onClick={resetFilters}>
                        Reset
                    </button>
                </div>
                {collecting && (
                    <div className="collect-loader">
                        <div
                            className="spinner"
                            style={{ width: 16, height: 16, borderWidth: 2 }}
                        />
                        <div className="collect-loader-text">
                            <div className="collect-loader-title">Collecting jobs…</div>
                            <div className="collect-loader-sub">
                                {formatSeconds(collectElapsed)} / est.{" "}
                                {collectEstimate === null
                                    ? "—"
                                    : collectElapsed > collectEstimate
                                      ? `${formatSeconds(collectEstimate)} (almost there…)`
                                      : formatSeconds(collectEstimate)}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="content">
                <div className="job-list">
                    {loading ? (
                        <div className="loading">
                            <div className="spinner" /> Loading jobs...
                        </div>
                    ) : jobs.length === 0 ? (
                        <div className="empty-state">
                            <h3>No jobs found</h3>
                            <p>
                                Click &quot;Collect Jobs&quot; to fetch from all sources, or adjust
                                your filters.
                            </p>
                        </div>
                    ) : (
                        jobs.map((job) => (
                            <div className="job-card" key={job.id}>
                                <input
                                    type="checkbox"
                                    className="mark-email"
                                    title="Mark for email"
                                    checked={Boolean(job.mark_for_email)}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={() => void toggleMark(job.id)}
                                    style={{
                                        marginRight: 8,
                                        transform: "scale(1.2)",
                                        cursor: "pointer",
                                    }}
                                />
                                <div
                                    className={`score-badge ${scoreClass(job.relevance_score)}`}
                                    onClick={() => setSelectedJob(job)}
                                    style={{ cursor: "pointer" }}
                                >
                                    {job.relevance_score ?? 0}
                                </div>
                                <div
                                    className="job-info"
                                    onClick={() => setSelectedJob(job)}
                                    style={{ cursor: "pointer" }}
                                >
                                    <h3>{job.title}</h3>
                                    <div className="job-meta">
                                        <span>{job.company}</span>
                                        <span>{job.location}</span>
                                        <span>{job.source}</span>
                                        {job.salary && <span>{job.salary}</span>}
                                        {job.posted_date && (
                                            <span>{formatDate(job.posted_date)}</span>
                                        )}
                                        <IndiaBadge
                                            value={job.india_friendly}
                                            note={job.location_note}
                                        />
                                        {job.last_seen && (
                                            <span
                                                style={{
                                                    fontSize: 11,
                                                    color: "var(--text-muted)",
                                                }}
                                            >
                                                Last seen: {formatDate(job.last_seen)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="job-tags">
                                        {techTags(job, 6).map((tag) => (
                                            <span className="tag" key={tag}>
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="job-actions">
                                    <span className={`status-badge ${statusClass(job.status)}`}>
                                        {job.status}
                                    </span>
                                    {job.mark_for_email ? (
                                        <span
                                            style={{
                                                color: "var(--yellow)",
                                                fontSize: 11,
                                            }}
                                        >
                                            📧 Marked
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="pagination">
                    <button
                        className="btn btn-outline btn-sm"
                        disabled={offset === 0}
                        onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                    >
                        Previous
                    </button>
                    <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setOffset((value) => value + PAGE_SIZE)}
                    >
                        Next
                    </button>
                </div>
            </div>

            <Modal open={selectedJob !== null} onClose={() => setSelectedJob(null)}>
                {selectedJob && (
                    <>
                        <h2>{selectedJob.title}</h2>
                        <div className="modal-company">
                            {selectedJob.company} — {selectedJob.location}
                        </div>
                        <div className="modal-details">
                            <div
                                className={`score-badge ${scoreClass(
                                    selectedJob.relevance_score,
                                )}`}
                                style={{
                                    width: 40,
                                    height: 40,
                                    fontSize: 14,
                                }}
                            >
                                {selectedJob.relevance_score ?? 0}
                            </div>
                            <StatusBadge status={selectedJob.status} />
                            <IndiaBadge
                                value={selectedJob.india_friendly}
                                note={selectedJob.location_note}
                            />
                            <span className="tag">{selectedJob.source}</span>
                            {selectedJob.salary && (
                                <span className="tag">{selectedJob.salary}</span>
                            )}
                            {selectedJob.experience_level && (
                                <span className="tag">{selectedJob.experience_level}</span>
                            )}
                        </div>
                        {selectedJob.location_note && (
                            <div className="location-note">
                                Location: {selectedJob.location_note}
                            </div>
                        )}
                        <div className="job-tags" style={{ marginBottom: 12 }}>
                            {techTags(selectedJob).map((tag) => (
                                <span className="tag" key={tag}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                        <div
                            className="modal-desc"
                            dangerouslySetInnerHTML={{
                                __html:
                                    selectedJob.description ||
                                    "<em>No description available</em>",
                            }}
                        />
                        <div className="modal-actions">
                            <button
                                className="btn btn-outline"
                                onClick={() => void updateStatus(selectedJob.id, "reviewed")}
                            >
                                Mark Reviewed
                            </button>
                            <button
                                className="btn btn-green"
                                onClick={() => void updateStatus(selectedJob.id, "applied")}
                            >
                                Mark Applied
                            </button>
                            <button
                                className="btn btn-yellow"
                                onClick={() => void updateStatus(selectedJob.id, "stale")}
                            >
                                Mark Stale
                            </button>
                            {selectedJob.url && (
                                <a
                                    href={selectedJob.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-primary"
                                >
                                    Apply
                                </a>
                            )}
                            <button
                                className="btn btn-outline"
                                onClick={() => setSelectedJob(null)}
                            >
                                Close
                            </button>
                        </div>
                    </>
                )}
            </Modal>

            <Modal open={queriesOpen} onClose={() => setQueriesOpen(false)} width={720}>
                <h2>JSearch Queries</h2>
                <p
                    style={{
                        color: "var(--text-muted)",
                        margin: "8px 0 16px",
                        fontSize: 13,
                    }}
                >
                    These queries run every time you click &quot;Collect Jobs&quot;. Each enabled
                    query uses 1 JSearch credit. Toggle to enable/disable.
                </p>
                {queries.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", padding: 12 }}>
                        No queries yet. Add one below.
                    </div>
                ) : (
                    <table
                        style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            fontSize: 13,
                        }}
                    >
                        <thead>
                            <tr
                                style={{
                                    borderBottom: "1px solid var(--border)",
                                    color: "var(--text-muted)",
                                    fontSize: 11,
                                    textTransform: "uppercase",
                                }}
                            >
                                <th style={{ textAlign: "left", padding: "8px 4px" }}>On</th>
                                <th style={{ textAlign: "left", padding: "8px 4px" }}>Query</th>
                                <th style={{ textAlign: "left", padding: "8px 4px" }}>Country</th>
                                <th style={{ textAlign: "left", padding: "8px 4px" }}>Posted</th>
                                <th style={{ textAlign: "left", padding: "8px 4px" }}>Remote</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {queries.map((query) => (
                                <tr key={query.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                    <td style={{ padding: "8px 4px" }}>
                                        <input
                                            type="checkbox"
                                            checked={query.enabled}
                                            onChange={(event) =>
                                                void patchQuery(
                                                    query.id,
                                                    "enabled",
                                                    event.target.checked,
                                                )
                                            }
                                        />
                                    </td>
                                    <td style={{ padding: "8px 4px" }}>
                                        <input
                                            type="text"
                                            defaultValue={query.query}
                                            onBlur={(event) =>
                                                void patchQuery(
                                                    query.id,
                                                    "query",
                                                    event.target.value,
                                                )
                                            }
                                            style={{
                                                background: "var(--surface2)",
                                                border: "1px solid var(--border)",
                                                color: "var(--text)",
                                                padding: "4px 8px",
                                                borderRadius: 4,
                                                width: "100%",
                                                fontSize: 13,
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: "8px 4px" }}>
                                        <select
                                            value={query.country}
                                            onChange={(event) =>
                                                void patchQuery(
                                                    query.id,
                                                    "country",
                                                    event.target.value,
                                                )
                                            }
                                            style={{
                                                background: "var(--surface2)",
                                                border: "1px solid var(--border)",
                                                color: "var(--text)",
                                                padding: "4px 6px",
                                                borderRadius: 4,
                                                fontSize: 13,
                                            }}
                                        >
                                            {["IN", "US", "GB", "CA", "DE", "SG"].map((country) => (
                                                <option key={country} value={country}>
                                                    {country}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td style={{ padding: "8px 4px" }}>
                                        <select
                                            value={query.date_posted}
                                            onChange={(event) =>
                                                void patchQuery(
                                                    query.id,
                                                    "date_posted",
                                                    event.target.value,
                                                )
                                            }
                                            style={{
                                                background: "var(--surface2)",
                                                border: "1px solid var(--border)",
                                                color: "var(--text)",
                                                padding: "4px 6px",
                                                borderRadius: 4,
                                                fontSize: 13,
                                            }}
                                        >
                                            {["today", "3days", "week", "month", "all"].map(
                                                (period) => (
                                                    <option key={period} value={period}>
                                                        {period}
                                                    </option>
                                                ),
                                            )}
                                        </select>
                                    </td>
                                    <td style={{ padding: "8px 4px" }}>
                                        <input
                                            type="checkbox"
                                            checked={query.remote_jobs_only}
                                            onChange={(event) =>
                                                void patchQuery(
                                                    query.id,
                                                    "remote_jobs_only",
                                                    event.target.checked,
                                                )
                                            }
                                        />
                                    </td>
                                    <td style={{ padding: "8px 4px" }}>
                                        <button
                                            className="btn btn-outline btn-sm"
                                            onClick={() => void deleteQuery(query.id)}
                                        >
                                            ×
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                <div
                    style={{
                        borderTop: "1px solid var(--border)",
                        paddingTop: 16,
                        marginTop: 16,
                    }}
                >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                        Add New Query
                    </div>
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            alignItems: "flex-end",
                        }}
                    >
                        <div className="filter-group" style={{ flex: 2, minWidth: 200 }}>
                            <label>Query</label>
                            <input
                                type="text"
                                placeholder="e.g. python backend senior"
                                value={newQuery.query}
                                onChange={(event) =>
                                    setNewQuery((prev) => ({
                                        ...prev,
                                        query: event.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="filter-group">
                            <label>Country</label>
                            <select
                                value={newQuery.country}
                                onChange={(event) =>
                                    setNewQuery((prev) => ({
                                        ...prev,
                                        country: event.target.value,
                                    }))
                                }
                            >
                                {["IN", "US", "GB", "CA", "DE", "SG"].map((country) => (
                                    <option key={country} value={country}>
                                        {country}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="filter-group">
                            <label>Posted</label>
                            <select
                                value={newQuery.date_posted}
                                onChange={(event) =>
                                    setNewQuery((prev) => ({
                                        ...prev,
                                        date_posted: event.target.value,
                                    }))
                                }
                            >
                                {["today", "3days", "week", "month", "all"].map((period) => (
                                    <option key={period} value={period}>
                                        {period}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="filter-group">
                            <label style={{ fontSize: 12 }}>
                                <input
                                    type="checkbox"
                                    checked={newQuery.remote_jobs_only}
                                    onChange={(event) =>
                                        setNewQuery((prev) => ({
                                            ...prev,
                                            remote_jobs_only: event.target.checked,
                                        }))
                                    }
                                    style={{ marginRight: 4 }}
                                />{" "}
                                Remote only
                            </label>
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={() => void addQuery()}>
                            Add
                        </button>
                    </div>
                </div>
                <div className="modal-actions" style={{ marginTop: 16 }}>
                    <button className="btn btn-outline" onClick={() => setQueriesOpen(false)}>
                        Close
                    </button>
                </div>
            </Modal>

            <Modal open={exportOpen} onClose={() => setExportOpen(false)} width={500}>
                <h2>Export to Google Sheets</h2>
                <p style={{ color: "var(--text-muted)", margin: "8px 0 16px" }}>
                    Push filtered jobs to your Google Sheet for n8n workflows.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="filter-group">
                        <label>Sheet Tab Name</label>
                        <input
                            type="text"
                            value={exportForm.sheet_name}
                            onChange={(event) =>
                                setExportForm((prev) => ({
                                    ...prev,
                                    sheet_name: event.target.value,
                                }))
                            }
                            style={{ width: "100%" }}
                        />
                    </div>
                    <div className="filter-group">
                        <label>Min Score</label>
                        <select
                            value={exportForm.min_score}
                            onChange={(event) =>
                                setExportForm((prev) => ({
                                    ...prev,
                                    min_score: Number(event.target.value),
                                }))
                            }
                            style={{ width: "100%" }}
                        >
                            <option value={0}>All</option>
                            <option value={30}>30+</option>
                            <option value={50}>50+</option>
                            <option value={60}>60+</option>
                            <option value={70}>70+</option>
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>India Remote</label>
                        <select
                            value={exportForm.india_friendly}
                            onChange={(event) =>
                                setExportForm((prev) => ({
                                    ...prev,
                                    india_friendly: event.target.value,
                                }))
                            }
                            style={{ width: "100%" }}
                        >
                            <option value="">All</option>
                            <option value="yes">India Friendly Only</option>
                            <option value="maybe">India + Maybe</option>
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>Mode</label>
                        <select
                            value={exportForm.mode}
                            onChange={(event) =>
                                setExportForm((prev) => ({
                                    ...prev,
                                    mode: event.target.value,
                                }))
                            }
                            style={{ width: "100%" }}
                        >
                            <option value="replace">Replace (clear sheet + rewrite)</option>
                            <option value="append">Append (add new rows)</option>
                        </select>
                    </div>
                </div>
                <div className="modal-actions" style={{ marginTop: 20 }}>
                    <button className="btn btn-outline" onClick={() => setExportOpen(false)}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-green"
                        disabled={exporting}
                        onClick={() => void doExport()}
                    >
                        {exporting ? "Exporting..." : "Export Now"}
                    </button>
                </div>
            </Modal>

            <Toast toast={toast} />
        </>
    );
}
