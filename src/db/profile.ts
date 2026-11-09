import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { query, queryOne } from "../db/connection.js";
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
// Read-through only: the snapshot is filled from PostgreSQL on demand and
// dropped by every profile mutation, so a stale config cannot outlive the
// write that changed it.

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

async function readActiveProfileId(): Promise<number | null> {
  const row = await queryOne<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'active_profile_id'",
  );
  if (!row) return null;
  const n = Number.parseInt(row.value, 10);
  return Number.isNaN(n) ? null : n;
}

function readProfileRow(pid: number): Promise<ProfileDbRow | undefined> {
  return queryOne<ProfileDbRow>("SELECT * FROM profiles WHERE id = $1", [pid]);
}

// ── Public API ────────────────────────────────────────────────────────

export async function getActiveProfile(): Promise<ActiveProfile> {
  if (activeCache.config !== null) {
    return { ...activeCache.config, _id: activeCache.id, _name: activeCache.name };
  }
  return refreshActiveProfile();
}

/**
 * Drop the cached snapshot and reload the active profile. Called once at
 * bootstrap and after every profile write.
 */
export async function refreshActiveProfile(): Promise<ActiveProfile> {
  invalidateCache();

  const pid = await readActiveProfileId();
  if (pid === null) {
    return { ...defaultConfig(), _id: null, _name: "(none)" };
  }
  const row = await readProfileRow(pid);
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

export async function listProfiles(): Promise<ProfileSummary[]> {
  const activeId = await readActiveProfileId();
  const res = await query<Omit<ProfileSummary, "is_active">>(
    "SELECT id, name, description, source, created_at, updated_at FROM profiles ORDER BY id",
  );
  return res.rows.map((r) => ({ ...r, is_active: r.id === activeId }));
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

export async function getProfile(pid: number): Promise<ProfileDetail | undefined> {
  const row = await readProfileRow(pid);
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

export async function createProfile(
  name: string,
  config: unknown,
  description = "",
  source = "custom",
): Promise<number> {
  const ts = utcNowIso();
  const cfg = validateConfig(config);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO profiles (name, description, config_json, created_at, updated_at, source)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, description, JSON.stringify(cfg), ts, ts, source],
  );
  if (!row) throw new Error("Failed to insert profile");
  return row.id;
}

export async function updateProfile(
  pid: number,
  opts: { config?: unknown; name?: string; description?: string },
): Promise<void> {
  const updates: string[] = [];
  const params: unknown[] = [];
  if (opts.config !== undefined) {
    params.push(JSON.stringify(validateConfig(opts.config)));
    updates.push(`config_json = $${params.length}`);
  }
  if (opts.name !== undefined) {
    params.push(opts.name);
    updates.push(`name = $${params.length}`);
  }
  if (opts.description !== undefined) {
    params.push(opts.description);
    updates.push(`description = $${params.length}`);
  }
  if (!updates.length) return;
  params.push(utcNowIso());
  updates.push(`updated_at = $${params.length}`);
  params.push(pid);
  await query(`UPDATE profiles SET ${updates.join(", ")} WHERE id = $${params.length}`, params);

  if ((await readActiveProfileId()) === pid) await refreshActiveProfile();
}

export async function activateProfile(pid: number): Promise<void> {
  const row = await readProfileRow(pid);
  if (!row) throw new Error(`Profile ${pid} not found`);
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('active_profile_id', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [String(pid), utcNowIso()],
  );
  await refreshActiveProfile();
}

export async function deleteProfile(pid: number): Promise<void> {
  if ((await readActiveProfileId()) === pid) {
    throw new Error("Cannot delete the active profile. Activate another first.");
  }
  await query("DELETE FROM profiles WHERE id = $1", [pid]);
}

export async function duplicateProfile(pid: number, newName?: string): Promise<number> {
  const row = await readProfileRow(pid);
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

export async function importPreset(
  slug: string,
  activate = false,
  overwrite = false,
): Promise<number> {
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

  const existing = await queryOne<{ id: number }>("SELECT id FROM profiles WHERE name = $1", [
    name,
  ]);
  const ts = utcNowIso();
  let pid: number;

  if (existing && overwrite) {
    pid = existing.id;
    await query(
      "UPDATE profiles SET description = $1, config_json = $2, updated_at = $3, source = $4 WHERE id = $5",
      [description, JSON.stringify(cfg), ts, `preset:${slug}`, existing.id],
    );
  } else {
    const newName = existing ? `${name} (imported ${ts.slice(0, 10)})` : name;
    const row = await queryOne<{ id: number }>(
      `INSERT INTO profiles (name, description, config_json, created_at, updated_at, source)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [newName, description, JSON.stringify(cfg), ts, ts, `preset:${slug}`],
    );
    if (!row) throw new Error(`Failed to import preset ${slug}`);
    pid = row.id;
  }

  if (activate) await activateProfile(pid);
  return pid;
}

export async function exportProfile(pid: number): Promise<string> {
  const row = await readProfileRow(pid);
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
export async function ensureFirstRunSeed(): Promise<number | null> {
  const countRow = await queryOne<{ c: number }>("SELECT COUNT(*)::int AS c FROM profiles");
  if ((countRow?.c ?? 0) > 0) return null;
  const ts = utcNowIso();
  const cfg = legacyProfileFromSettings();
  const row = await queryOne<{ id: number }>(
    `INSERT INTO profiles (name, description, config_json, created_at, updated_at, source)
     VALUES ($1, $2, $3, $4, $5, 'legacy') RETURNING id`,
    [
      "Backend Python (legacy)",
      "Seeded from pre-profile hardcoded settings. Edit or switch to another preset.",
      JSON.stringify(cfg),
      ts,
      ts,
    ],
  );
  if (!row) throw new Error("Failed to seed the legacy profile");
  const pid = row.id;
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('active_profile_id', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [String(pid), ts],
  );
  invalidateCache();
  return pid;
}

// ── JSearch-query CRUD against the active profile ─────────────────────

export interface ActiveProfileQuery extends JsearchQuery {
  id: number;
}

async function loadActiveProfileConfig(): Promise<{ pid: number | null; cfg: ProfileConfig }> {
  const pid = await readActiveProfileId();
  if (pid === null) return { pid: null, cfg: defaultConfig() };
  const row = await readProfileRow(pid);
  if (!row) return { pid: null, cfg: defaultConfig() };
  return { pid, cfg: validateConfig(JSON.parse(row.config_json)) };
}

export async function getActiveProfileQueries(): Promise<ActiveProfileQuery[]> {
  const { cfg } = await loadActiveProfileConfig();
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

export async function addActiveProfileQuery(
  query: string,
  country = "IN",
  datePosted = "3days",
  remoteJobsOnly = false,
): Promise<number> {
  const { pid, cfg } = await loadActiveProfileConfig();
  if (pid === null) throw new Error("No active profile");
  const queries = [...(cfg.search.jsearch_default_queries ?? [])];
  queries.push({ query, country, date_posted: datePosted, remote_jobs_only: remoteJobsOnly, enabled: true });
  cfg.search.jsearch_default_queries = queries;
  await updateProfile(pid, { config: cfg });
  return queries.length - 1;
}

export async function updateActiveProfileQuery(
  qid: number,
  fields: Partial<Pick<JsearchQuery, "query" | "country" | "date_posted" | "remote_jobs_only" | "enabled">>,
): Promise<void> {
  const { pid, cfg } = await loadActiveProfileConfig();
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
  await updateProfile(pid, { config: cfg });
}

export async function deleteActiveProfileQuery(qid: number): Promise<void> {
  const { pid, cfg } = await loadActiveProfileConfig();
  if (pid === null) throw new Error("No active profile");
  const queries = [...(cfg.search.jsearch_default_queries ?? [])];
  if (qid < 0 || qid >= queries.length) throw new Error(`Query index ${qid} out of range`);
  queries.splice(qid, 1);
  cfg.search.jsearch_default_queries = queries;
  await updateProfile(pid, { config: cfg });
}
