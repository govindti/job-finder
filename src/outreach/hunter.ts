import { getActiveProfile } from "../db/profile.js";
import type { ActiveProfile, LinkedinTitle } from "../schemas/profile.js";

// LinkedIn people-search URLs need percent-encoding that keeps "/" safe and
// encodes every other char outside [A-Za-z0-9_.-~] to its UTF-8 bytes —
// matching how LinkedIn keyword queries are expected to be encoded. JS's
// encodeURIComponent leaves ( ! ' ( ) * ) unescaped, so we encode manually.
function pyQuote(str: string, safe = "/"): string {
    const out: string[] = [];
    for (const ch of str) {
        if (/[A-Za-z0-9_.\-~]/.test(ch) || safe.includes(ch)) {
            out.push(ch);
        } else {
            for (const b of new TextEncoder().encode(ch)) {
                out.push("%" + b.toString(16).toUpperCase().padStart(2, "0"));
            }
        }
    }
    return out.join("");
}

export interface LinkedinSearch {
    label: string;
    title: string;
    category: string;
    url: string;
}

const LINKEDIN_BASE = "https://www.linkedin.com/search/results/people/";

/** Build LinkedIn people-search URLs from the profile's search titles. */
export function buildLinkedinSearches(company: string, profile?: ActiveProfile): LinkedinSearch[] {
    const p = profile ?? getActiveProfile();
    const titles: LinkedinTitle[] = p.outreach.linkedin_search_titles ?? [];

    const searches: LinkedinSearch[] = [];
    for (const entry of titles) {
        const title = entry.title ?? "";
        if (!title) continue;
        const label = entry.label || title;
        const category = entry.category || "engineering";
        const keywords = `${company} ${title}`;
        searches.push({
            label,
            title,
            category,
            url: `${LINKEDIN_BASE}?keywords=${pyQuote(keywords)}`,
        });
    }
    return searches;
}

/** Legacy: search URL from a specific person's name. */
export function buildLinkedinSearchUrl(firstName: string, lastName: string, company: string): string {
    const query = `${firstName} ${lastName} ${company}`.trim();
    return `${LINKEDIN_BASE}?keywords=${pyQuote(query)}`;
}

/**
 * Template formatter that tolerates missing tokens — unknown placeholders
 * render empty. `{{`/`}}` escapes are not used by our templates, so a
 * single-pass placeholder replace is sufficient.
 */
function safeFormat(template: string, tokens: Record<string, string>): string {
    return template.replace(/\{([^{}]*)\}/g, (_m, key: string) =>
        Object.prototype.hasOwnProperty.call(tokens, key) ? (tokens[key] ?? "") : "",
    );
}

interface DmJob {
    title?: string | null;
    company?: string | null;
    tech_stack?: string | null;
}

interface DmContact {
    first_name?: string | null;
}

export interface Dms {
    short: string;
    long: string;
}

/** Generate short + long LinkedIn DMs using the profile's templates. */
export function generateDmTemplate(job: DmJob, contact?: DmContact | null, profile?: ActiveProfile): Dms {
    const p = profile ?? getActiveProfile();
    const out = p.outreach;

    const candidateName = out.candidate_name || "[Your Name]";
    const candidateCore = (out.candidate_core_tech ?? []).map((t) => t.toLowerCase());
    const candidateExtra = (out.candidate_extra_tech ?? []).map((t) => t.toLowerCase());
    const bioShortTemplate = out.bio_short || "";
    const achievements = out.achievements ?? [];
    const dmShortTemplate = out.dm_short_template || "";
    const dmLongTemplate = out.dm_long_template || "";

    const firstName = contact?.first_name ? contact.first_name : "";
    const greeting = firstName ? `Hi ${firstName}` : "Hi there";

    let title = (job.title || "this role").trim();
    if (title.includes(" - ")) title = title.split(" - ")[0] as string;
    const company = (job.company || "your team").trim();

    const techStackStr = job.tech_stack || "";
    const techBits = techStackStr
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    const matchedCore = techBits.filter((t) => candidateCore.includes(t));

    let stackPhrase: string;
    if (matchedCore.length) stackPhrase = toTitleCase(matchedCore.slice(0, 2).join("/"));
    else if (candidateCore.length) stackPhrase = toTitleCase(candidateCore.slice(0, 2).join("/"));
    else if (candidateExtra.length) stackPhrase = toTitleCase(candidateExtra.slice(0, 2).join("/"));
    else stackPhrase = "the stack";

    const bioShort = safeFormat(bioShortTemplate, { stack: stackPhrase });
    const achievementsBlock = achievements.join("\n\n");

    const tokens: Record<string, string> = {
        greeting,
        company,
        title,
        stack: stackPhrase,
        bio_short: bioShort,
        achievements: achievementsBlock,
        candidate_name: candidateName,
    };

    let short = safeFormat(dmShortTemplate, tokens).trim();
    const long = safeFormat(dmLongTemplate, tokens).trim();

    // Hard cap short DM (LinkedIn connection note limit = 300 chars).
    if (short.length > 300) short = short.slice(0, 297).trimEnd() + "...";

    return { short, long };
}

/** Upper-case the first letter of each word. */
function toTitleCase(s: string): string {
    return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
