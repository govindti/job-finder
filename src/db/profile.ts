import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getDb } from "../db/connection.js";
import { utcNowIso } from "../utils/models.js";
import { env } from "../config/env.js";
import * as settings from "../config/settings.js";
import type {
  ActiveProfile,
  ExperienceBonuses,
  JsearchQuery,
  ProfileConfig,
} from "../schemas/profile.js";

export const SCHEMA_VERSION = 1;

// ── Defaults ──────────────────────────────────────────────────────────

function defaultExperienceBonuses(): ExperienceBonuses {
  return {
    fresher: { fresher: 15, junior: 10, mid: 0, senior: -5 },
    junior: { fresher: 5, junior: 15, mid: 5, senior: -5 },
    mid: { fresher: -10, junior: 0, mid: 15, senior: 10 },
    senior: { fresher: -15, junior: -5, mid: 10, senior: 15 },
    any: { fresher: 10, junior: 10, mid: 10, senior: 10 },
  };
}

/** A valid, complete default config. */
export function defaultConfig(): ProfileConfig {
  return {
    schema_version: SCHEMA_VERSION,
    search: {
      default_terms: [],
      title_keywords_positive: [],
      title_keywords_negative: [],
      relevant_tech: [],
      jsearch_default_queries: [],
    },
    scoring: {
      experience_target: "mid",
      min_relevance_score: 50,
      min_score_to_store: 25,
      weights: { title: 35, tech: 35, experience: 15, signal: 15 },
      core_tech: [],
      backend_signals: [],
      experience_bonuses: defaultExperienceBonuses(),
    },
    location: {
      india_positive: [],
      india_negative: [],
      timezone_compatible: [],
      timezone_incompatible: [],
    },
    outreach: {
      candidate_name: "",
      candidate_core_tech: [],
      candidate_extra_tech: [],
      linkedin_search_titles: [
        { title: "Engineering Manager", label: "Eng Manager", category: "engineering" },
        { title: "Tech Lead", label: "Tech Lead", category: "engineering" },
        { title: "Head of Engineering", label: "Head of Eng", category: "engineering" },
        { title: "CTO", label: "CTO", category: "executive" },
        { title: "CEO Founder", label: "CEO / Founder", category: "executive" },
        { title: "Technical Recruiter", label: "Tech Recruiter", category: "hr" },
        { title: "HR Manager", label: "HR Manager", category: "hr" },
      ],
      bio_short: "",
      achievements: [],
      dm_short_template: "",
      dm_long_template: "",
      email_digest_subject_role: "software",
      email_greeting: "Your Daily Job Digest",
      recipient_email: "",
    },
  };
}

type Rec = Record<string, unknown>;

function isPlainObject(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Deep merge override onto base (arrays/scalars replaced, objects recursed).
function deepMerge(base: Rec, override: Rec): Rec {
  const out: Rec = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (k in out && isPlainObject(out[k]) && isPlainObject(v)) {
      out[k] = deepMerge(out[k] as Rec, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Deep-merge submitted config onto defaults so every expected key exists.
 * Enforces the experience_target enum and coerces weights to non-negative ints.
 */
export function validateConfig(config: unknown): ProfileConfig {
  const base = defaultConfig() as unknown as Rec;
  const merged = deepMerge(base, isPlainObject(config) ? config : {}) as unknown as ProfileConfig;

  const validTargets = ["fresher", "junior", "mid", "senior", "any"] as const;
  if (!validTargets.includes(merged.scoring.experience_target)) {
    merged.scoring.experience_target = "mid";
  }

  const defaults = defaultConfig();
  const w = (merged.scoring.weights ?? {}) as Partial<Record<keyof typeof defaults.scoring.weights, unknown>>;
  const normalized = { ...defaults.scoring.weights };
  for (const k of ["title", "tech", "experience", "signal"] as const) {
    const val = w[k];
    const n = typeof val === "number" ? Math.trunc(val) : Number.parseInt(String(val ?? ""), 10);
    normalized[k] = Number.isNaN(n) ? defaults.scoring.weights[k] : Math.max(0, n);
  }
  merged.scoring.weights = normalized;

  return merged;
}

// ── Cache ─────────────────────────────────────────────────────────────

const activeCache: { id: number | null; name: string | null; config: ProfileConfig | null } = {
  id: null,
  name: null,
  config: null,
};

export function invalidateCache(): void {
  activeCache.id = null;
  activeCache.name = null;
  activeCache.config = null;
}

function cacheSet(pid: number, name: string, config: ProfileConfig): void {
  activeCache.id = pid;
  activeCache.name = name;
  activeCache.config = config;
}

// ── Internal DB helpers ───────────────────────────────────────────────

interface ProfileDbRow {
  id: number;
  name: string;
  description: string;
  config_json: string;
  created_at: string;
  updated_at: string;
  source: string;
}

function readActiveProfileId(): number | null {
  const d = getDb();
  const row = d
    .prepare("SELECT value FROM app_settings WHERE key = 'active_profile_id'")
    .get() as { value: string } | undefined;
  if (!row) return null;
  const n = Number.parseInt(row.value, 10);
  return Number.isNaN(n) ? null : n;
}

function readProfileRow(pid: number): ProfileDbRow | undefined {
  return getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(pid) as
    | ProfileDbRow
    | undefined;
}

// ── Public API ────────────────────────────────────────────────────────

export function getActiveProfile(): ActiveProfile {
  if (activeCache.config !== null) {
    return { ...activeCache.config, _id: activeCache.id, _name: activeCache.name };
  }

  const pid = readActiveProfileId();
  if (pid === null) {
    return { ...defaultConfig(), _id: null, _name: "(none)" };
  }
  const row = readProfileRow(pid);
  if (!row) {
    return { ...defaultConfig(), _id: null, _name: "(none)" };
  }
  const config = validateConfig(JSON.parse(row.config_json));
  cacheSet(row.id, row.name, config);
  return { ...config, _id: row.id, _name: row.name };
}

export interface ProfileSummary {
  id: number;
  name: string;
  description: string;
  source: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export function listProfiles(): ProfileSummary[] {
  const activeId = readActiveProfileId();
  const rows = getDb()
    .prepare("SELECT id, name, description, source, created_at, updated_at FROM profiles ORDER BY id")
    .all() as Array<Omit<ProfileSummary, "is_active">>;
  return rows.map((r) => ({ ...r, is_active: r.id === activeId }));
}

export interface ProfileDetail {
  id: number;
  name: string;
  description: string;
  source: string;
  created_at: string;
  updated_at: string;
  config: ProfileConfig;
}

export function getProfile(pid: number): ProfileDetail | undefined {
  const row = readProfileRow(pid);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    config: validateConfig(JSON.parse(row.config_json)),
  };
}

export function createProfile(name: string, config: unknown, description = "", source = "custom"): number {
  const ts = utcNowIso();
  const cfg = validateConfig(config);
  const info = getDb()
    .prepare(
      "INSERT INTO profiles (name, description, config_json, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(name, description, JSON.stringify(cfg), ts, ts, source);
  return Number(info.lastInsertRowid);
}

export function updateProfile(
  pid: number,
  opts: { config?: unknown; name?: string; description?: string },
): void {
  const d = getDb();
  const updates: string[] = [];
  const params: unknown[] = [];
  if (opts.config !== undefined) {
    updates.push("config_json = ?");
    params.push(JSON.stringify(validateConfig(opts.config)));
  }
  if (opts.name !== undefined) {
    updates.push("name = ?");
    params.push(opts.name);
  }
  if (opts.description !== undefined) {
    updates.push("description = ?");
    params.push(opts.description);
  }
  if (!updates.length) return;
  updates.push("updated_at = ?");
  params.push(utcNowIso());
  params.push(pid);
  d.prepare(`UPDATE profiles SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  if (readActiveProfileId() === pid) invalidateCache();
}

export function activateProfile(pid: number): void {
  const row = readProfileRow(pid);
  if (!row) throw new Error(`Profile ${pid} not found`);
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('active_profile_id', ?, ?)",
    )
    .run(String(pid), utcNowIso());
  invalidateCache();
}

export function deleteProfile(pid: number): void {
  if (readActiveProfileId() === pid) {
    throw new Error("Cannot delete the active profile. Activate another first.");
  }
  getDb().prepare("DELETE FROM profiles WHERE id = ?").run(pid);
}

export function duplicateProfile(pid: number, newName?: string): number {
  const row = readProfileRow(pid);
  if (!row) throw new Error(`Profile ${pid} not found`);
  const name = newName || `${row.name} (copy)`;
  return createProfile(name, JSON.parse(row.config_json), row.description, "custom");
}

// ── Preset import / export ────────────────────────────────────────────

export interface PresetMeta {
  slug: string;
  name: string;
  description: string;
}

export function listPresets(): PresetMeta[] {
  const dir = env.PROFILES_DIR;
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  const presets: PresetMeta[] = [];
  for (const file of files) {
    const meta = readPresetMeta(path.join(dir, file));
    if (meta) presets.push(meta);
  }
  return presets;
}

function readPresetMeta(filePath: string): PresetMeta | null {
  let data: Rec;
  try {
    data = (YAML.parse(fs.readFileSync(filePath, "utf-8")) as Rec) ?? {};
  } catch {
    return null;
  }
  const slug = path.basename(filePath, ".yaml");
  return {
    slug,
    name: typeof data.name === "string" ? data.name : slug,
    description: typeof data.description === "string" ? data.description : "",
  };
}

export function importPreset(slug: string, activate = false, overwrite = false): number {
  const filePath = path.join(env.PROFILES_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) throw new Error(`Preset not found: ${filePath}`);
  const data = (YAML.parse(fs.readFileSync(filePath, "utf-8")) as Rec) ?? {};

  const name = typeof data.name === "string" ? data.name : slug;
  const description = typeof data.description === "string" ? data.description : "";
  const config: Rec = {};
  for (const [k, v] of Object.entries(data)) {
    if (k !== "name" && k !== "description") config[k] = v;
  }
  const cfg = validateConfig(config);

  const d = getDb();
  const existing = d.prepare("SELECT id FROM profiles WHERE name = ?").get(name) as
    | { id: number }
    | undefined;
  const ts = utcNowIso();
  let pid: number;

  if (existing && overwrite) {
    pid = existing.id;
    d.prepare(
      "UPDATE profiles SET description = ?, config_json = ?, updated_at = ?, source = ? WHERE id = ?",
    ).run(description, JSON.stringify(cfg), ts, `preset:${slug}`, existing.id);
  } else if (existing) {
    const newName = `${name} (imported ${ts.slice(0, 10)})`;
    const info = d
      .prepare(
        "INSERT INTO profiles (name, description, config_json, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(newName, description, JSON.stringify(cfg), ts, ts, `preset:${slug}`);
    pid = Number(info.lastInsertRowid);
  } else {
    const info = d
      .prepare(
        "INSERT INTO profiles (name, description, config_json, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(name, description, JSON.stringify(cfg), ts, ts, `preset:${slug}`);
    pid = Number(info.lastInsertRowid);
  }

  if (activate) activateProfile(pid);
  return pid;
}

export function exportProfile(pid: number): string {
  const row = readProfileRow(pid);
  if (!row) throw new Error(`Profile ${pid} not found`);
  const config = validateConfig(JSON.parse(row.config_json));
  const out = { name: row.name, description: row.description, ...config };
  return YAML.stringify(out, { lineWidth: 100 });
}

// ── Legacy first-run seed ─────────────────────────────────────────────

function legacyProfileFromSettings(): ProfileConfig {
  const cfg = defaultConfig();
  cfg.search.default_terms = [...settings.DEFAULT_SEARCH_TERMS];
  cfg.search.title_keywords_positive = [...settings.TITLE_KEYWORDS_POSITIVE];
  cfg.search.title_keywords_negative = [...settings.TITLE_KEYWORDS_NEGATIVE];
  cfg.search.relevant_tech = [...settings.RELEVANT_TECH];
  cfg.search.jsearch_default_queries = [
    { query: "python django backend developer", country: "IN", date_posted: "3days", remote_jobs_only: false },
    { query: "python backend engineer", country: "IN", date_posted: "3days", remote_jobs_only: false },
    { query: "django developer", country: "IN", date_posted: "3days", remote_jobs_only: false },
    { query: "fastapi developer", country: "IN", date_posted: "week", remote_jobs_only: false },
    { query: "python backend remote", country: "IN", date_posted: "week", remote_jobs_only: true },
    { query: "backend engineer python", country: "US", date_posted: "week", remote_jobs_only: true },
  ];

  cfg.location.india_positive = [...settings.LOCATION_INDIA_POSITIVE];
  cfg.location.india_negative = [...settings.LOCATION_INDIA_NEGATIVE];
  cfg.location.timezone_compatible = [...settings.TIMEZONE_COMPATIBLE];
  cfg.location.timezone_incompatible = [...settings.TIMEZONE_INCOMPATIBLE];

  cfg.scoring.experience_target = "mid";
  cfg.scoring.min_relevance_score = settings.MIN_RELEVANCE_SCORE;
  cfg.scoring.min_score_to_store = 25;
  cfg.scoring.core_tech = ["python", "django", "fastapi", "flask"];
  cfg.scoring.backend_signals = [
    "api", "backend", "back-end", "server-side", "microservice",
    "database", "rest", "graphql", "endpoint",
  ];

  cfg.outreach.candidate_name = "Parmanand";
  cfg.outreach.candidate_core_tech = ["python", "django", "fastapi", "drf"];
  cfg.outreach.candidate_extra_tech = ["postgresql", "redis", "aws", "docker", "microservices"];
  cfg.outreach.bio_short = "3+ years building {stack} backends";
  cfg.outreach.achievements = [
    "Backend Developer at DoctusTech, a healthcare SaaS serving 5,000+ US medical professionals.",
    "Architected the Django/DRF platform, integrated 3 microservices, cut API response times 50% with Redis caching.",
    "Previously built multitenant SaaS + Stripe integrations processing 2,000+ monthly transactions.",
  ];
  cfg.outreach.dm_short_template =
    "{greeting}, I noticed {company} is hiring for {title}. I have {bio_short} — shipped a healthcare SaaS serving 5,000+ users with sub-200ms APIs. Would love to connect.";
  cfg.outreach.dm_long_template =
    "{greeting},\n\nNoticed {company} is hiring for {title}. The stack caught my eye — I've been shipping {stack} backends for 3+ years.\n\n{achievements}\n\nOpen to a 15-min chat to see if there's a fit?\n\nThanks,\n{candidate_name}";
  cfg.outreach.email_digest_subject_role = "backend";
  cfg.outreach.email_greeting = "Your Daily Job Digest";
  return cfg;
}

/** Idempotent: seed "Backend Python (legacy)" + activate when profiles is empty. */
export function ensureFirstRunSeed(): number | null {
  const d = getDb();
  const count = (d.prepare("SELECT COUNT(*) AS c FROM profiles").get() as { c: number }).c;
  if (count > 0) return null;
  const ts = utcNowIso();
  const cfg = legacyProfileFromSettings();
  const info = d
    .prepare(
      "INSERT INTO profiles (name, description, config_json, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, 'legacy')",
    )
    .run(
      "Backend Python (legacy)",
      "Seeded from pre-profile hardcoded settings. Edit or switch to another preset.",
      JSON.stringify(cfg),
      ts,
      ts,
    );
  const pid = Number(info.lastInsertRowid);
  d.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('active_profile_id', ?, ?)",
  ).run(String(pid), ts);
  return pid;
}

// ── JSearch-query CRUD against the active profile ─────────────────────

export interface ActiveProfileQuery extends JsearchQuery {
  id: number;
}

function loadActiveProfileConfig(): { pid: number | null; cfg: ProfileConfig } {
  const pid = readActiveProfileId();
  if (pid === null) return { pid: null, cfg: defaultConfig() };
  const row = readProfileRow(pid);
  if (!row) return { pid: null, cfg: defaultConfig() };
  return { pid, cfg: validateConfig(JSON.parse(row.config_json)) };
}

export function getActiveProfileQueries(): ActiveProfileQuery[] {
  const { cfg } = loadActiveProfileConfig();
  const raw = cfg.search.jsearch_default_queries ?? [];
  return raw.map((q, idx) => ({
    id: idx,
    query: q.query ?? "",
    country: q.country ?? "IN",
    date_posted: q.date_posted ?? "3days",
    remote_jobs_only: Boolean(q.remote_jobs_only),
    enabled: q.enabled ?? true,
  }));
}

export function addActiveProfileQuery(
  query: string,
  country = "IN",
  datePosted = "3days",
  remoteJobsOnly = false,
): number {
  const { pid, cfg } = loadActiveProfileConfig();
  if (pid === null) throw new Error("No active profile");
  const queries = [...(cfg.search.jsearch_default_queries ?? [])];
  queries.push({ query, country, date_posted: datePosted, remote_jobs_only: remoteJobsOnly, enabled: true });
  cfg.search.jsearch_default_queries = queries;
  updateProfile(pid, { config: cfg });
  return queries.length - 1;
}

export function updateActiveProfileQuery(
  qid: number,
  fields: Partial<Pick<JsearchQuery, "query" | "country" | "date_posted" | "remote_jobs_only" | "enabled">>,
): void {
  const { pid, cfg } = loadActiveProfileConfig();
  if (pid === null) throw new Error("No active profile");
  const queries = [...(cfg.search.jsearch_default_queries ?? [])];
  const target = queries[qid];
  if (!target) throw new Error(`Query index ${qid} out of range`);
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      (target as unknown as Record<string, unknown>)[k] = v;
    }
  }
  cfg.search.jsearch_default_queries = queries;
  updateProfile(pid, { config: cfg });
}

export function deleteActiveProfileQuery(qid: number): void {
  const { pid, cfg } = loadActiveProfileConfig();
  if (pid === null) throw new Error("No active profile");
  const queries = [...(cfg.search.jsearch_default_queries ?? [])];
  if (qid < 0 || qid >= queries.length) throw new Error(`Query index ${qid} out of range`);
  queries.splice(qid, 1);
  cfg.search.jsearch_default_queries = queries;
  updateProfile(pid, { config: cfg });
}
