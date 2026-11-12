import * as settings from "./legacy-settings.js";
import { profileConfigSchema, type ExperienceBonuses, type ProfileConfig } from "./profiles.types.js";
import { AppError } from "../../common/errors/app-error.js";

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

  if (!isPlainObject(merged.scoring)) throw new AppError("VALIDATION_ERROR", { message: "scoring must be an object" });
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

  return profileConfigSchema.parse(merged) as ProfileConfig;
}

// ── Legacy first-run seed ─────────────────────────────────────────────

export function legacyProfileFromSettings(): ProfileConfig {
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
