import { getActiveProfile } from "../db/profile.js";
import type { ActiveProfile } from "../schemas/profile.js";
import { pyRound } from "../utils/round.js";

// All scoring preferences come from the active (or passed) profile; the
// experience-detection keyword lists are linguistic patterns and stay
// hardcoded.

export interface ScoreResult {
    score: number;
    tech_stack: string[];
    experience_level: string;
    reasons: string[];
    red_flags: string[];
    india_friendly: string;
    location_note: string;
}

export function extractTechStack(text: string, profile: ActiveProfile): string[] {
    const techList = profile.search.relevant_tech ?? [];
    const lower = text.toLowerCase();
    return techList.filter((tech) => lower.includes(tech));
}

export function estimateExperienceLevel(text: string): string {
    const t = text.toLowerCase();
    const has = (words: string[]) => words.some((w) => t.includes(w));

    if (
        has([
            "intern", "internship", "trainee", "entry level", "entry-level",
            "0-1 year", "0-2 years", "fresher", "new grad", "graduate",
            "campus", "freshers", "b.tech", "b.e.", "mca",
        ])
    ) {
        return "fresher";
    }
    if (has(["senior", "sr.", "lead", "principal", "staff", "8+ years", "10+ years", "15+ years"])) {
        return "senior";
    }
    if (has(["junior", "jr.", "1+ year", "1-2 years"])) {
        return "junior";
    }
    if (
        has([
            "mid", "middle", "3+ years", "2+ years", "4+ years", "5+ years",
            "3-5 years", "2-4 years", "4-6 years",
        ])
    ) {
        return "mid";
    }
    return "mid";
}

export interface IndiaCheck {
    result: string;
    note: string;
}

export function checkIndiaFriendly(location: string, description: string, profile: ActiveProfile): IndiaCheck {
    const locCfg = profile.location;
    const indiaPos = locCfg.india_positive ?? [];
    const indiaNeg = locCfg.india_negative ?? [];
    const tzGoodList = locCfg.timezone_compatible ?? [];
    const tzBadList = locCfg.timezone_incompatible ?? [];

    const fullText = `${location} ${description}`.toLowerCase();
    const locLower = location.toLowerCase();

    const positiveHits = indiaPos.filter((kw) => fullText.includes(kw));
    const negativeHits = indiaNeg.filter((kw) => fullText.includes(kw));
    const tzGood = tzGoodList.filter((kw) => fullText.includes(kw));
    const tzBad = tzBadList.filter((kw) => fullText.includes(kw));

    if (negativeHits.length) {
        return { result: "no", note: `Restricted: ${negativeHits.slice(0, 3).join(", ")}` };
    }
    if (tzBad.length) {
        return { result: "no", note: `Timezone mismatch: ${tzBad.slice(0, 2).join(", ")}` };
    }

    const indiaDirect = [
        "india", "bangalore", "bengaluru", "mumbai", "hyderabad",
        "pune", "delhi", "chennai", "kolkata", "noida", "gurgaon",
        "gurugram", "remote - india",
    ].some((kw) => fullText.includes(kw));
    if (indiaDirect) {
        return { result: "yes", note: `India mentioned: ${positiveHits.slice(0, 3).join(", ")}` };
    }

    const globalKw = [
        "worldwide", "anywhere", "global", "work from anywhere",
        "location independent", "globally distributed",
    ];
    if (globalKw.some((kw) => fullText.includes(kw))) {
        const noteParts = positiveHits.filter((h) => globalKw.includes(h));
        return { result: "yes", note: `Global remote: ${noteParts.slice(0, 3).join(", ")}` };
    }

    if (["apac", "asia", "asia pacific", "asia-pacific"].some((kw) => fullText.includes(kw))) {
        return { result: "yes", note: `APAC region: ${positiveHits.slice(0, 3).join(", ")}` };
    }
    if (tzGood.length) {
        return { result: "maybe", note: `Compatible timezone: ${tzGood.slice(0, 2).join(", ")}` };
    }

    if (
        locLower.includes("remote") &&
        !["us", "usa", "uk", "europe", "eu", "canada", "germany", "france", "spain", "australia"].some((r) =>
            locLower.includes(r),
        )
    ) {
        return { result: "maybe", note: "Remote — no region specified, may accept India" };
    }

    const nonIndiaRegions = [
        "united states", "usa", "us", "canada", "uk",
        "united kingdom", "europe", "eu", "germany",
        "france", "australia", "spain", "netherlands",
    ];
    if (nonIndiaRegions.some((r) => locLower.includes(r))) {
        return { result: "no", note: `Location restricted to: ${location}` };
    }

    return { result: "maybe", note: "No clear location restriction found" };
}

export function scoreJob(
    title: string,
    description: string,
    location = "",
    profile?: ActiveProfile,
): ScoreResult {
    const p = profile ?? getActiveProfile();
    const search = p.search;
    const scoring = p.scoring;
    const weights = scoring.weights;
    const wTitle = Math.trunc(weights.title);
    const wTech = Math.trunc(weights.tech);
    const wExp = Math.trunc(weights.experience);
    const wSignal = Math.trunc(weights.signal);

    const posTitles = search.title_keywords_positive ?? [];
    const negTitles = search.title_keywords_negative ?? [];
    const coreTechList = scoring.core_tech ?? [];
    const signalList = scoring.backend_signals ?? [];
    const expBonuses = scoring.experience_bonuses ?? {};
    const expTarget = scoring.experience_target ?? "mid";

    let score = 0;
    const reasons: string[] = [];
    const redFlags: string[] = [];
    const fullText = `${title} ${description}`.toLowerCase();
    const titleLower = title.toLowerCase();

    // Title relevance
    const titleMatches = posTitles.filter((kw) => titleLower.includes(kw));
    if (titleMatches.length) {
        const pts = Math.min(titleMatches.length * 12, wTitle);
        score += pts;
        reasons.push(`Title match: ${titleMatches.slice(0, 6).join(", ")}`);
    }

    const titleNegatives = negTitles.filter((kw) => titleLower.includes(kw));
    if (titleNegatives.length) {
        const penalty = titleNegatives.length * 15;
        score -= penalty;
        redFlags.push(`Title contains: ${titleNegatives.slice(0, 4).join(", ")}`);
    }

    // Tech stack: core vs secondary, ~70/30 budget split of the tech weight.
    const techFound = extractTechStack(fullText, p);
    const coreTech = techFound.filter((t) => coreTechList.includes(t));
    const secondaryTech = techFound.filter((t) => !coreTechList.includes(t));

    const coreBudget = Math.max(0, pyRound(wTech * 0.71));
    const secondaryBudget = Math.max(0, wTech - coreBudget);

    if (coreTech.length) {
        score += Math.min(coreTech.length * 12, coreBudget);
        reasons.push(`Core tech: ${coreTech.join(", ")}`);
    }
    if (secondaryTech.length) {
        score += Math.min(secondaryTech.length * 3, secondaryBudget);
        reasons.push(`Related tech: ${secondaryTech.slice(0, 8).join(", ")}`);
    }

    // Experience: bonus table scaled by (wExp / 15).
    const expLevel = estimateExperienceLevel(fullText);
    const row = expBonuses[expTarget] ?? {};
    const rawBonus = Math.trunc(row[expLevel] ?? 0);
    const scaledBonus = pyRound(rawBonus * (wExp / 15));
    if (scaledBonus > 0) {
        score += scaledBonus;
        reasons.push(`Experience match: ${expLevel} (target=${expTarget}) +${scaledBonus}`);
    } else if (scaledBonus < 0) {
        score += scaledBonus;
        redFlags.push(`Experience mismatch: ${expLevel} (target=${expTarget}) ${scaledBonus}`);
    } else {
        reasons.push(`Experience: ${expLevel} (target=${expTarget})`);
    }

    // Domain signals.
    const signalMatches = signalList.filter((s) => fullText.includes(s));
    if (signalMatches.length) {
        score += Math.min(signalMatches.length * 4, wSignal);
        reasons.push(`Signals: ${signalMatches.slice(0, 5).join(", ")}`);
    }

    const indiaCheck = checkIndiaFriendly(location, description, p);

    score = Math.max(0, Math.min(100, score));

    return {
        score,
        tech_stack: techFound,
        experience_level: expLevel,
        reasons,
        red_flags: redFlags,
        india_friendly: indiaCheck.result,
        location_note: indiaCheck.note,
    };
}
