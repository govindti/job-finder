"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { Toast } from "@/components/Toast";
import { TagEditor } from "@/components/TagEditor";
import { api } from "@/lib/api";
import { useToast } from "@/lib/useToast";
import type {
    ActiveProfile,
    EmailStatus,
    JsearchQuery,
    LinkedinTitle,
    PresetMeta,
    ProfileConfig,
    ProfileDetail,
    ProfileSummary,
} from "@/lib/types";

type Tab = "search" | "scoring" | "location" | "outreach";

const EXPERIENCE_TARGETS = ["fresher", "junior", "mid", "senior", "any"] as const;
const COUNTRIES = ["IN", "US", "GB", "CA", "DE", "SG"];
const DATE_PERIODS = ["today", "3days", "week", "month", "all"];

interface Meta {
    name: string;
    description: string;
    source: string;
}

function cloneConfig(config: ProfileConfig): ProfileConfig {
    return JSON.parse(JSON.stringify(config)) as ProfileConfig;
}

export default function ProfilePage() {
    const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
    const [presets, setPresets] = useState<PresetMeta[]>([]);
    const [currentId, setCurrentId] = useState<number | null>(null);
    const [config, setConfig] = useState<ProfileConfig | null>(null);
    const [meta, setMeta] = useState<Meta | null>(null);
    const [activeName, setActiveName] = useState("loading...");
    const [tab, setTab] = useState<Tab>("search");
    const [achievementsText, setAchievementsText] = useState("");
    const [senderEmail, setSenderEmail] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    const { toast, showToast } = useToast();

    const loadProfiles = useCallback(async (): Promise<ProfileSummary[]> => {
        const data = await api<{ profiles: ProfileSummary[]; presets: PresetMeta[] }>(
            "/profiles",
        );
        setProfiles(data.profiles ?? []);
        setPresets(data.presets ?? []);
        return data.profiles ?? [];
    }, []);

    const loadActive = useCallback(async (): Promise<ActiveProfile> => {
        const active = await api<ActiveProfile>("/profiles/active");
        setActiveName(active.name || "(none)");
        return active;
    }, []);

    const loadEnvSender = useCallback(async () => {
        try {
            const status = await api<EmailStatus>("/email/status");
            setSenderEmail(status.sender || "");
        } catch {
            setSenderEmail("");
        }
    }, []);

    const selectProfile = useCallback(async (pid: number) => {
        const row = await api<ProfileDetail>(`/profiles/${pid}`);
        setCurrentId(pid);
        setConfig(row.config);
        setMeta({
            name: row.name,
            description: row.description,
            source: row.source,
        });
        setAchievementsText((row.config.outreach.achievements ?? []).join("\n"));
    }, []);

    const boot = useCallback(async () => {
        setLoading(true);
        try {
            const list = await loadProfiles();
            const active = await loadActive();
            const target = active.id ?? list[0]?.id ?? null;
            if (target !== null) await selectProfile(target);
            else {
                setCurrentId(null);
                setConfig(null);
                setMeta(null);
            }
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to load profiles", "error");
        } finally {
            setLoading(false);
        }
        void loadEnvSender();
    }, [loadProfiles, loadActive, selectProfile, loadEnvSender, showToast]);

    useEffect(() => {
        void boot();
    }, [boot]);

    function updatePath(path: string, value: unknown): void {
        setConfig((prev) => {
            if (!prev) return prev;
            const next = cloneConfig(prev);
            const parts = path.split(".");
            let target: Record<string, unknown> = next as unknown as Record<string, unknown>;
            for (let index = 0; index < parts.length - 1; index += 1) {
                const key = parts[index] as string;
                const current = target[key];
                if (typeof current !== "object" || current === null) {
                    target[key] = {};
                }
                target = target[key] as Record<string, unknown>;
            }
            target[parts[parts.length - 1] as string] = value;
            return next;
        });
    }

    function updateScalar(path: string, value: string | number | boolean): void {
        updatePath(path, value);
    }

    function updateWeight(key: keyof ProfileConfig["scoring"]["weights"], value: number): void {
        setConfig((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                scoring: {
                    ...prev.scoring,
                    weights: { ...prev.scoring.weights, [key]: value },
                },
            };
        });
    }

    function updateJsearch(index: number, patch: Partial<JsearchQuery>): void {
        setConfig((prev) => {
            if (!prev) return prev;
            const rows = [...prev.search.jsearch_default_queries];
            rows[index] = { ...rows[index], ...patch };
            return {
                ...prev,
                search: { ...prev.search, jsearch_default_queries: rows },
            };
        });
    }

    function addJsearchRow(): void {
        setConfig((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                search: {
                    ...prev.search,
                    jsearch_default_queries: [
                        ...prev.search.jsearch_default_queries,
                        {
                            query: "",
                            country: "IN",
                            date_posted: "3days",
                            remote_jobs_only: false,
                        },
                    ],
                },
            };
        });
    }

    function removeJsearchRow(index: number): void {
        setConfig((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                search: {
                    ...prev.search,
                    jsearch_default_queries: prev.search.jsearch_default_queries.filter(
                        (_row, rowIndex) => rowIndex !== index,
                    ),
                },
            };
        });
    }

    function updateLinkedin(index: number, patch: Partial<LinkedinTitle>): void {
        setConfig((prev) => {
            if (!prev) return prev;
            const rows = [...prev.outreach.linkedin_search_titles];
            rows[index] = { ...rows[index], ...patch };
            return {
                ...prev,
                outreach: { ...prev.outreach, linkedin_search_titles: rows },
            };
        });
    }

    function addLinkedinRow(): void {
        setConfig((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                outreach: {
                    ...prev.outreach,
                    linkedin_search_titles: [
                        ...prev.outreach.linkedin_search_titles,
                        { title: "", label: "", category: "engineering" },
                    ],
                },
            };
        });
    }

    function removeLinkedinRow(index: number): void {
        setConfig((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                outreach: {
                    ...prev.outreach,
                    linkedin_search_titles: prev.outreach.linkedin_search_titles.filter(
                        (_row, rowIndex) => rowIndex !== index,
                    ),
                },
            };
        });
    }

    async function saveProfile(activate: boolean): Promise<void> {
        if (currentId === null || !config || !meta) {
            showToast("No profile selected", "error");
            return;
        }
        const name = meta.name.trim();
        if (!name) {
            showToast("Name is required", "error");
            return;
        }
        setBusy(activate ? "save-activate" : "save");
        try {
            const payload: ProfileConfig = {
                ...config,
                outreach: {
                    ...config.outreach,
                    achievements: achievementsText
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean),
                },
            };
            await api(`/profiles/${currentId}`, {
                method: "PUT",
                body: {
                    name,
                    description: meta.description.trim(),
                    config: payload,
                },
            });
            if (activate) {
                await api(`/profiles/${currentId}/activate`, { method: "POST" });
                showToast("Saved and activated (JSearch queries synced)");
            } else {
                showToast("Saved");
            }
            await loadProfiles();
            await loadActive();
            setConfig(payload);
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Save failed", "error");
        } finally {
            setBusy(null);
        }
    }

    async function deleteProfile(): Promise<void> {
        if (currentId === null || !meta) return;
        if (!window.confirm(`Delete profile "${meta.name}"? This is not reversible.`)) {
            return;
        }
        setBusy("delete");
        try {
            await api(`/profiles/${currentId}`, { method: "DELETE" });
            showToast("Deleted");
            setCurrentId(null);
            setConfig(null);
            setMeta(null);
            await boot();
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Delete failed", "error");
        } finally {
            setBusy(null);
        }
    }

    async function duplicateProfile(): Promise<void> {
        if (currentId === null || !meta) return;
        const newName = window.prompt("Name for the copy:", `${meta.name} (copy)`);
        if (!newName) return;
        setBusy("duplicate");
        try {
            const result = await api<{ id: number }>(
                `/profiles/${currentId}/duplicate?name=${encodeURIComponent(newName)}`,
                { method: "POST" },
            );
            showToast("Duplicated");
            await loadProfiles();
            await selectProfile(result.id);
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Duplicate failed", "error");
        } finally {
            setBusy(null);
        }
    }

    async function createBlankProfile(): Promise<void> {
        const name = window.prompt("New profile name:");
        if (!name) return;
        setBusy("create");
        try {
            const result = await api<{ id: number }>("/profiles", {
                method: "POST",
                body: { name, description: "", config: {} },
            });
            await loadProfiles();
            await selectProfile(result.id);
            showToast("Created (starts with defaults — customize and save)");
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Create failed", "error");
        } finally {
            setBusy(null);
        }
    }

    async function importPresetFlow(slug: string): Promise<void> {
        const activate = window.confirm(
            `Import preset "${slug}" and activate immediately?\n\n[OK] = activate (JSearch queries will be replaced)\n[Cancel] = import only (without activating)`,
        );
        setBusy("import");
        try {
            const result = await api<{ id: number }>("/profiles/import", {
                method: "POST",
                body: { preset_slug: slug, activate, overwrite: false },
            });
            showToast(activate ? "Imported and activated" : "Imported");
            await loadProfiles();
            await loadActive();
            await selectProfile(result.id);
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Import failed", "error");
        } finally {
            setBusy(null);
        }
    }

    async function rescoreAll(): Promise<void> {
        if (!window.confirm("Re-score all jobs against the active profile?")) return;
        setBusy("rescore");
        try {
            const result = await api<{ updated: number; deleted: number }>(
                "/profiles/rescore-all",
                { method: "POST" },
            );
            showToast(`Re-scored ${result.updated} jobs (deleted ${result.deleted})`);
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Re-score failed", "error");
        } finally {
            setBusy(null);
        }
    }

    function exportActiveProfile(): void {
        if (currentId === null) return;
        window.open(`/api/profiles/${currentId}/export`, "_blank");
    }

    const weightsTotal = config
        ? config.scoring.weights.title +
          config.scoring.weights.tech +
          config.scoring.weights.experience +
          config.scoring.weights.signal
        : 0;

    if (loading) {
        return (
            <>
                <div className="header">
                    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                        <h1>Job Scraper</h1>
                        <Nav />
                    </div>
                </div>
                <div className="loading">
                    <div className="spinner" /> Loading profile...
                </div>
            </>
        );
    }

    return (
        <>
            <div className="header">
                <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                    <h1>Job Scraper</h1>
                    <Nav />
                </div>
                <div className="header-actions">
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        Active: {activeName}
                    </span>
                    <button className="btn btn-outline" onClick={exportActiveProfile}>
                        Export YAML
                    </button>
                    <button
                        className="btn btn-yellow"
                        disabled={busy === "rescore"}
                        onClick={() => void rescoreAll()}
                    >
                        {busy === "rescore" ? "Re-scoring..." : "Re-score All Jobs"}
                    </button>
                    <button
                        className="btn btn-primary"
                        disabled={busy === "save" || busy === "save-activate"}
                        onClick={() => void saveProfile(false)}
                    >
                        {busy === "save" ? "Saving..." : "Save"}
                    </button>
                    <button
                        className="btn btn-green"
                        disabled={busy === "save" || busy === "save-activate"}
                        onClick={() => void saveProfile(true)}
                    >
                        {busy === "save-activate" ? "Saving..." : "Save & Activate"}
                    </button>
                </div>
            </div>

            <div className="profile-layout">
                <aside className="profile-sidebar">
                    <div className="sidebar-head">
                        <div className="sidebar-title">Profiles</div>
                        <button
                            className="btn btn-sm btn-outline"
                            disabled={busy === "create"}
                            onClick={() => void createBlankProfile()}
                        >
                            + New
                        </button>
                    </div>
                    <div className="profile-list">
                        {profiles.length === 0 ? (
                            <div className="help">No profiles. Import a preset below.</div>
                        ) : (
                            profiles.map((profile) => (
                                <div
                                    key={profile.id}
                                    className={`profile-item${
                                        profile.id === currentId ? " selected" : ""
                                    }`}
                                    onClick={() => void selectProfile(profile.id)}
                                >
                                    <div className="name">
                                        {profile.name}
                                        {profile.is_active && (
                                            <span className="active-pill">ACTIVE</span>
                                        )}
                                    </div>
                                    <div className="desc">
                                        {profile.description || profile.source || ""}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="sidebar-head" style={{ marginTop: 24 }}>
                        <div className="sidebar-title">Import Preset</div>
                    </div>
                    <div className="profile-list">
                        {presets.length === 0 ? (
                            <div className="help">No presets found in profiles/ directory.</div>
                        ) : (
                            presets.map((preset) => (
                                <div
                                    key={preset.slug}
                                    className="preset-item"
                                    onClick={() => void importPresetFlow(preset.slug)}
                                >
                                    <div className="name">{preset.name}</div>
                                    <div className="desc">
                                        {preset.description || preset.slug}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </aside>

                <section className="profile-editor">
                    {!config || !meta ? (
                        <div className="empty-state">
                            <h3>No profile selected</h3>
                            <p>Import a preset or create a new profile to get started.</p>
                        </div>
                    ) : (
                        <>
                            <div className="editor-head">
                                <div className="editor-title-row">
                                    <input
                                        type="text"
                                        className="editor-name"
                                        placeholder="Profile name"
                                        value={meta.name}
                                        onChange={(event) =>
                                            setMeta((prev) =>
                                                prev
                                                    ? { ...prev, name: event.target.value }
                                                    : prev,
                                            )
                                        }
                                    />
                                    {meta.source && (
                                        <span className="source-chip">{meta.source}</span>
                                    )}
                                </div>
                                <input
                                    type="text"
                                    className="editor-description"
                                    placeholder="One-line description of this profile"
                                    value={meta.description}
                                    onChange={(event) =>
                                        setMeta((prev) =>
                                            prev
                                                ? { ...prev, description: event.target.value }
                                                : prev,
                                        )
                                    }
                                />
                            </div>

                            <nav className="tab-bar">
                                {(
                                    [
                                        ["search", "Search"],
                                        ["scoring", "Scoring"],
                                        ["location", "Location"],
                                        ["outreach", "Outreach"],
                                    ] as const
                                ).map(([value, label]) => (
                                    <a
                                        key={value}
                                        className={`tab-link${tab === value ? " active" : ""}`}
                                        onClick={() => setTab(value)}
                                    >
                                        {label}
                                    </a>
                                ))}
                            </nav>

                            <div className={`tab-pane${tab === "search" ? " active" : ""}`}>
                                <div className="field">
                                    <label>Default Search Terms</label>
                                    <div className="help">
                                        Keywords you search for (displayed in UI only; not used by
                                        Remotive/RemoteOK which return all software jobs).
                                    </div>
                                    <TagEditor
                                        values={config.search.default_terms}
                                        onChange={(values) =>
                                            updatePath("search.default_terms", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Title Keywords — Positive</label>
                                    <div className="help">
                                        Titles that <strong>boost</strong> the score when matched.
                                    </div>
                                    <TagEditor
                                        values={config.search.title_keywords_positive}
                                        onChange={(values) =>
                                            updatePath("search.title_keywords_positive", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Title Keywords — Negative</label>
                                    <div className="help">
                                        Titles that <strong>penalize</strong> the score (-15 each).
                                    </div>
                                    <TagEditor
                                        values={config.search.title_keywords_negative}
                                        onChange={(values) =>
                                            updatePath("search.title_keywords_negative", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Relevant Tech</label>
                                    <div className="help">
                                        All tech words we scan for in job descriptions. Matched ones
                                        appear as tags on each job.
                                    </div>
                                    <TagEditor
                                        values={config.search.relevant_tech}
                                        onChange={(values) =>
                                            updatePath("search.relevant_tech", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>JSearch Default Queries</label>
                                    <div className="help">
                                        Queries used by &quot;Collect Jobs&quot; for this profile.
                                    </div>
                                    <div className="query-rows">
                                        {config.search.jsearch_default_queries.map(
                                            (query, index) => (
                                                <div className="query-row jsearch" key={index}>
                                                    <input
                                                        className="q-query"
                                                        placeholder="query text"
                                                        value={query.query}
                                                        onChange={(event) =>
                                                            updateJsearch(index, {
                                                                query: event.target.value,
                                                            })
                                                        }
                                                    />
                                                    <select
                                                        className="q-country"
                                                        value={query.country}
                                                        onChange={(event) =>
                                                            updateJsearch(index, {
                                                                country: event.target.value,
                                                            })
                                                        }
                                                    >
                                                        {COUNTRIES.map((country) => (
                                                            <option key={country} value={country}>
                                                                {country}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        className="q-date"
                                                        value={query.date_posted}
                                                        onChange={(event) =>
                                                            updateJsearch(index, {
                                                                date_posted:
                                                                    event.target.value,
                                                            })
                                                        }
                                                    >
                                                        {DATE_PERIODS.map((period) => (
                                                            <option key={period} value={period}>
                                                                {period}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <label className="checkbox-cell">
                                                        <input
                                                            type="checkbox"
                                                            className="q-remote"
                                                            checked={query.remote_jobs_only}
                                                            onChange={(event) =>
                                                                updateJsearch(index, {
                                                                    remote_jobs_only:
                                                                        event.target.checked,
                                                                })
                                                            }
                                                        />
                                                        Remote
                                                    </label>
                                                    <button
                                                        className="row-remove"
                                                        type="button"
                                                        onClick={() => removeJsearchRow(index)}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ),
                                        )}
                                    </div>
                                    <button
                                        className="btn btn-sm btn-outline"
                                        onClick={addJsearchRow}
                                        style={{ marginTop: 8 }}
                                    >
                                        + Add query
                                    </button>
                                </div>
                            </div>

                            <div className={`tab-pane${tab === "scoring" ? " active" : ""}`}>
                                <div className="field">
                                    <label>Experience Target</label>
                                    <div className="help">
                                        Tells the scorer which experience level to reward.
                                    </div>
                                    <div className="radio-row">
                                        {EXPERIENCE_TARGETS.map((target) => (
                                            <label key={target}>
                                                <input
                                                    type="radio"
                                                    name="exp-target"
                                                    value={target}
                                                    checked={
                                                        config.scoring.experience_target ===
                                                        target
                                                    }
                                                    onChange={() =>
                                                        updateScalar(
                                                            "scoring.experience_target",
                                                            target,
                                                        )
                                                    }
                                                />{" "}
                                                {target.charAt(0).toUpperCase() + target.slice(1)}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div className="field-row">
                                    <div className="field">
                                        <label>Min Score to Show (dashboard default)</label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            className="num-input"
                                            value={config.scoring.min_relevance_score}
                                            onChange={(event) =>
                                                updateScalar(
                                                    "scoring.min_relevance_score",
                                                    Number(event.target.value),
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="field">
                                        <label>Min Score to Store</label>
                                        <div className="help">
                                            Jobs scoring below this are dropped at collection
                                            time.
                                        </div>
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            className="num-input"
                                            value={config.scoring.min_score_to_store}
                                            onChange={(event) =>
                                                updateScalar(
                                                    "scoring.min_score_to_store",
                                                    Number(event.target.value),
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="field">
                                    <label>Scoring Weights (should sum to 100)</label>
                                    <div className="weights-grid">
                                        {(
                                            [
                                                ["title", "Title"],
                                                ["tech", "Tech"],
                                                ["experience", "Experience"],
                                                ["signal", "Signals"],
                                            ] as const
                                        ).map(([key, label]) => (
                                            <div key={key}>
                                                <span className="weight-label">{label}</span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="num-input"
                                                    value={config.scoring.weights[key]}
                                                    onChange={(event) =>
                                                        updateWeight(
                                                            key,
                                                            Number(event.target.value),
                                                        )
                                                    }
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <div
                                        className="help"
                                        style={{
                                            marginTop: 6,
                                            color:
                                                weightsTotal === 100
                                                    ? "var(--text-muted)"
                                                    : "var(--yellow)",
                                        }}
                                    >
                                        Total: {weightsTotal}
                                        {weightsTotal === 100 ? "" : " (should be 100)"}
                                    </div>
                                </div>
                                <div className="field">
                                    <label>Core Tech</label>
                                    <div className="help">
                                        Core tech (rewarded more heavily than secondary tech in
                                        scoring).
                                    </div>
                                    <TagEditor
                                        values={config.scoring.core_tech}
                                        onChange={(values) =>
                                            updatePath("scoring.core_tech", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Domain Signals</label>
                                    <div className="help">
                                        Keywords in the job description that indicate it&apos;s the
                                        kind of role you want.
                                    </div>
                                    <TagEditor
                                        values={config.scoring.backend_signals}
                                        onChange={(values) =>
                                            updatePath("scoring.backend_signals", values)
                                        }
                                    />
                                </div>
                            </div>

                            <div className={`tab-pane${tab === "location" ? " active" : ""}`}>
                                <div className="field">
                                    <label>India-Positive Keywords</label>
                                    <div className="help">
                                        Presence of these marks a job as India-friendly.
                                    </div>
                                    <TagEditor
                                        values={config.location.india_positive}
                                        onChange={(values) =>
                                            updatePath("location.india_positive", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>India-Negative Keywords</label>
                                    <div className="help">
                                        Presence of these <strong>excludes</strong> the job from
                                        India.
                                    </div>
                                    <TagEditor
                                        values={config.location.india_negative}
                                        onChange={(values) =>
                                            updatePath("location.india_negative", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Timezone-Compatible</label>
                                    <TagEditor
                                        values={config.location.timezone_compatible}
                                        onChange={(values) =>
                                            updatePath("location.timezone_compatible", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Timezone-Incompatible</label>
                                    <TagEditor
                                        values={config.location.timezone_incompatible}
                                        onChange={(values) =>
                                            updatePath("location.timezone_incompatible", values)
                                        }
                                    />
                                </div>
                            </div>

                            <div className={`tab-pane${tab === "outreach" ? " active" : ""}`}>
                                <div className="field-row">
                                    <div className="field">
                                        <label>Your Name (DM signoff)</label>
                                        <input
                                            type="text"
                                            className="text-input"
                                            value={config.outreach.candidate_name}
                                            onChange={(event) =>
                                                updateScalar(
                                                    "outreach.candidate_name",
                                                    event.target.value,
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="field">
                                        <label>Email Digest — Role Word</label>
                                        <div className="help">
                                            Used in the email body: &quot;N fresh{" "}
                                            <strong>{config.outreach.email_digest_subject_role}</strong>{" "}
                                            roles&quot;.
                                        </div>
                                        <input
                                            type="text"
                                            className="text-input"
                                            value={config.outreach.email_digest_subject_role}
                                            onChange={(event) =>
                                                updateScalar(
                                                    "outreach.email_digest_subject_role",
                                                    event.target.value,
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="field">
                                    <label>Email Greeting (subject-line top)</label>
                                    <input
                                        type="text"
                                        className="text-input"
                                        value={config.outreach.email_greeting}
                                        onChange={(event) =>
                                            updateScalar(
                                                "outreach.email_greeting",
                                                event.target.value,
                                            )
                                        }
                                    />
                                </div>
                                <div className="field-row">
                                    <div className="field">
                                        <label>Sender Email (From address)</label>
                                        <div className="help">
                                            Fixed to <code>SENDER_EMAIL</code> in{" "}
                                            <code>.env</code> — it has to match{" "}
                                            <code>SENDER_APP_PASSWORD</code>. Change it there, not
                                            here.
                                        </div>
                                        <input
                                            type="email"
                                            className="text-input"
                                            value={senderEmail}
                                            readOnly
                                            disabled
                                            placeholder="not set in .env"
                                        />
                                    </div>
                                    <div className="field">
                                        <label>Recipient Email (your inbox)</label>
                                        <div className="help">
                                            Where the daily digest is delivered. Overrides{" "}
                                            <code>RECIPIENT_EMAIL</code> in <code>.env</code>.
                                            Leave blank to use the env value.
                                        </div>
                                        <input
                                            type="email"
                                            className="text-input"
                                            value={config.outreach.recipient_email}
                                            placeholder="e.g. you@gmail.com"
                                            onChange={(event) =>
                                                updateScalar(
                                                    "outreach.recipient_email",
                                                    event.target.value,
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="field">
                                    <label>Candidate Core Tech</label>
                                    <div className="help">
                                        Your strongest skills — used to build the DM&apos;s stack
                                        phrase.
                                    </div>
                                    <TagEditor
                                        values={config.outreach.candidate_core_tech}
                                        onChange={(values) =>
                                            updatePath("outreach.candidate_core_tech", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Candidate Extra Tech</label>
                                    <TagEditor
                                        values={config.outreach.candidate_extra_tech}
                                        onChange={(values) =>
                                            updatePath("outreach.candidate_extra_tech", values)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>LinkedIn Search Titles</label>
                                    <div className="help">
                                        People titles we generate search URLs for (per outreach
                                        item).
                                    </div>
                                    <div className="query-rows">
                                        {config.outreach.linkedin_search_titles.map(
                                            (entry, index) => (
                                                <div className="query-row linkedin" key={index}>
                                                    <input
                                                        className="lt-title"
                                                        placeholder="Title (e.g. Engineering Manager)"
                                                        value={entry.title}
                                                        onChange={(event) =>
                                                            updateLinkedin(index, {
                                                                title: event.target.value,
                                                            })
                                                        }
                                                    />
                                                    <input
                                                        className="lt-label"
                                                        placeholder="Short label"
                                                        value={entry.label}
                                                        onChange={(event) =>
                                                            updateLinkedin(index, {
                                                                label: event.target.value,
                                                            })
                                                        }
                                                    />
                                                    <select
                                                        className="lt-cat"
                                                        value={entry.category}
                                                        onChange={(event) =>
                                                            updateLinkedin(index, {
                                                                category: event.target.value,
                                                            })
                                                        }
                                                    >
                                                        {[
                                                            "engineering",
                                                            "executive",
                                                            "hr",
                                                        ].map((category) => (
                                                            <option
                                                                key={category}
                                                                value={category}
                                                            >
                                                                {category}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        className="row-remove"
                                                        type="button"
                                                        onClick={() => removeLinkedinRow(index)}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ),
                                        )}
                                    </div>
                                    <button
                                        className="btn btn-sm btn-outline"
                                        onClick={addLinkedinRow}
                                        style={{ marginTop: 8 }}
                                    >
                                        + Add title
                                    </button>
                                </div>
                                <div className="field">
                                    <label>Bio (short)</label>
                                    <div className="help">
                                        Used in templates via the <code>{"{bio_short}"}</code>{" "}
                                        token. <code>{"{stack}"}</code> token is expanded inside
                                        this string.
                                    </div>
                                    <input
                                        type="text"
                                        className="text-input"
                                        value={config.outreach.bio_short}
                                        onChange={(event) =>
                                            updateScalar(
                                                "outreach.bio_short",
                                                event.target.value,
                                            )
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>Achievements (one per line)</label>
                                    <div className="help">
                                        Joined and injected as the{" "}
                                        <code>{"{achievements}"}</code> token in the long DM.
                                    </div>
                                    <textarea
                                        rows={5}
                                        className="textarea-input"
                                        value={achievementsText}
                                        onChange={(event) =>
                                            setAchievementsText(event.target.value)
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>DM — Short Template</label>
                                    <div className="help">
                                        Tokens:{" "}
                                        <code>
                                            {
                                                "{greeting} {company} {title} {stack} {bio_short} {candidate_name}"
                                            }
                                        </code>
                                        . Capped at 300 chars.
                                    </div>
                                    <textarea
                                        rows={3}
                                        className="textarea-input"
                                        value={config.outreach.dm_short_template}
                                        onChange={(event) =>
                                            updateScalar(
                                                "outreach.dm_short_template",
                                                event.target.value,
                                            )
                                        }
                                    />
                                </div>
                                <div className="field">
                                    <label>DM — Long Template</label>
                                    <div className="help">
                                        All short-template tokens plus{" "}
                                        <code>{"{achievements}"}</code>.
                                    </div>
                                    <textarea
                                        rows={10}
                                        className="textarea-input"
                                        value={config.outreach.dm_long_template}
                                        onChange={(event) =>
                                            updateScalar(
                                                "outreach.dm_long_template",
                                                event.target.value,
                                            )
                                        }
                                    />
                                </div>
                            </div>

                            <div className="editor-footer">
                                <button
                                    className="btn btn-outline"
                                    disabled={busy === "duplicate"}
                                    onClick={() => void duplicateProfile()}
                                >
                                    {busy === "duplicate" ? "Duplicating..." : "Duplicate"}
                                </button>
                                <button
                                    className="btn btn-outline"
                                    style={{ color: "var(--red)", borderColor: "var(--red)" }}
                                    disabled={busy === "delete"}
                                    onClick={() => void deleteProfile()}
                                >
                                    {busy === "delete" ? "Deleting..." : "Delete"}
                                </button>
                            </div>
                        </>
                    )}
                </section>
            </div>

            <Toast toast={toast} />
        </>
    );
}
