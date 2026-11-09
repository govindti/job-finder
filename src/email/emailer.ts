import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getActiveProfile } from "../db/profile.js";
import {
    getJobs,
    getUnemailedOutreach,
    insertOutreach,
    logEmail,
    markOutreachEmailed,
    outreachExistsForJob,
    setLastOutreachBatchAt,
    type OutreachRow,
    type OutreachUnemailed,
} from "../db/repo.js";
import type { ActiveProfile } from "../schemas/profile.js";
import { buildLinkedinSearches, generateDmTemplate, type LinkedinSearch } from "../outreach/hunter.js";
import { md5Hex } from "../utils/hash.js";
import { utcNowIso } from "../utils/models.js";

// Daily job digest email + the collect → outreach → send pipeline.

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
];

function escapeHtml(s: string | null | undefined): string {
    if (!s) return "";
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/** "%b %d, %Y" from an ISO-ish date string. Falls back to the raw value. */
function formatDate(d: string): string {
    if (!d) return "";
    const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
    if (Number.isNaN(dt.getTime())) return d;
    return `${MONTHS_SHORT[dt.getMonth()]} ${pad2(dt.getDate())}, ${dt.getFullYear()}`;
}

function localDateLong(now: Date): string {
    return `${MONTHS_LONG[now.getMonth()]} ${pad2(now.getDate())}, ${now.getFullYear()}`;
}

function localDateShort(now: Date): string {
    return `${MONTHS_SHORT[now.getMonth()]} ${pad2(now.getDate())}`;
}

function renderCard(i: number, item: OutreachUnemailed): string {
    const title = escapeHtml(item.job_title);
    const company = escapeHtml(item.company);
    const location = escapeHtml(item.location ?? "");
    const salary = escapeHtml(item.salary ?? "");
    const posted = formatDate(item.posted_date ?? "");
    const tech = escapeHtml((item.tech_stack ?? "").slice(0, 100));
    const score = item.relevance_score ?? 0;
    const india = item.india_friendly ?? "unknown";

    const jobUrl = item.job_url || "#";
    const dmShort = escapeHtml(item.dm_short ?? "");

    let searches: Array<Pick<LinkedinSearch, "label" | "url" | "category">> = [];
    try {
        searches = (JSON.parse(item.notes || "[]") as typeof searches) || [];
    } catch {
        searches = [];
    }
    if (!searches.length) {
        searches = [{ label: "Search", url: item.contact_linkedin || "#", category: "engineering" }];
    }

    const indiaColor = (({ yes: "#00b894", maybe: "#fdcb6e", no: "#e17055" } as Record<string, string>)[india] ?? "#8b8fa3");
    const colors: Record<string, string> = { engineering: "#0a66c2", executive: "#6c5ce7", hr: "#00b894" };
    const labels: Record<string, string> = { engineering: "Engineering", executive: "C-Level", hr: "HR / Recruiters" };

    const grouped: Record<string, typeof searches> = {};
    for (const s of searches) {
        const cat = s.category || "engineering";
        (grouped[cat] ||= []).push(s);
    }

    let searchButtons = "";
    for (const cat of ["engineering", "executive", "hr"]) {
        if (!grouped[cat]) continue;
        const groupButtons = grouped[cat]
            .map(
                (s) =>
                    `<a href="${escapeHtml(s.url ?? "#")}" style="display:inline-block;background:${colors[cat]};color:#ffffff;padding:7px 12px;border-radius:5px;text-decoration:none;font-size:11px;font-weight:600;margin:2px 4px 2px 0;">🔍 ${escapeHtml(s.label ?? "")}</a>`,
            )
            .join("");
        searchButtons += `
        <div style="margin-bottom:8px;">
            <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${labels[cat]}</div>
            ${groupButtons}
        </div>
        `;
    }

    return `
    <tr><td style="padding:0 0 20px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:18px 20px;background:#f9fafb;border-bottom:1px solid #e5e7eb;">
            <table width="100%"><tr>
                <td style="font-size:11px;color:#6b7280;letter-spacing:0.5px;text-transform:uppercase;">#${i}</td>
                <td align="right">
                    <span style="background:#6c5ce7;color:white;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;">Score ${score}</span>
                    <span style="background:${indiaColor}22;color:${indiaColor};border:1px solid ${indiaColor};padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-left:4px;">${escapeHtml(india).toUpperCase()}</span>
                </td>
            </tr></table>
            <div style="font-size:18px;font-weight:700;color:#111827;margin-top:8px;">${title}</div>
            <div style="font-size:14px;color:#6b7280;margin-top:2px;">${company} &middot; ${location}</div>
            ${salary ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">${salary}</div>` : ""}
            ${posted ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Posted: ${posted}</div>` : ""}
            ${tech ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;">Tech: ${tech}</div>` : ""}
        </td></tr>

        <tr><td style="padding:16px 20px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Find &amp; Message Someone at ${company}</div>
            <div>${searchButtons}</div>
        </td></tr>

        <tr><td style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f9fafb;">
            <div style="font-size:11px;color:#6b7280;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">LinkedIn DM (copy-paste this)</div>
            <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:13px;line-height:1.6;color:#111827;font-family:monospace;">
                ${dmShort}
            </div>
        </td></tr>

        <tr><td style="padding:16px 20px;text-align:center;">
            <a href="${jobUrl}" style="display:inline-block;background:#6c5ce7;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Apply to Job →</a>
        </td></tr>
    </table>
    </td></tr>
    `;
}

export function buildEmailHtml(items: OutreachUnemailed[], profile: ActiveProfile): string {
    const p = profile;
    const out = p.outreach;
    const candidateName = out.candidate_name || "there";
    const roleWord = out.email_digest_subject_role || "matching";
    const greetingTitle = out.email_greeting || "Your Daily Job Digest";

    const today = localDateLong(new Date());
    const cards = items.map((item, i) => renderCard(i + 1, item)).join("");

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:30px 10px;">
<tr><td align="center">

<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;">

    <tr><td style="padding-bottom:24px;text-align:center;">
        <div style="font-size:26px;font-weight:700;color:#111827;">${escapeHtml(greetingTitle)}</div>
        <div style="font-size:14px;color:#6b7280;margin-top:4px;">${today} &middot; ${items.length} opportunities</div>
    </td></tr>

    <tr><td style="padding:16px 20px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;margin-bottom:20px;">
        <div style="font-size:13px;color:#3730a3;line-height:1.6;">
            <strong>Hey ${escapeHtml(candidateName)} 👋</strong><br>
            Here are ${items.length} fresh ${escapeHtml(roleWord)} roles that match your profile. For each one, I've found the hiring manager's LinkedIn and written a personalized DM.<br><br>
            <strong>Your move:</strong> Click "Open LinkedIn Profile" → send connection request with the DM → apply to the job. Takes ~2 min per job.
        </div>
    </td></tr>

    <tr><td style="height:16px;"></td></tr>

    ${cards}

    <tr><td style="padding:24px 20px;text-align:center;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">
        This is an automated daily digest. Good luck — go get them 💪
    </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
}

export function buildEmailText(items: OutreachUnemailed[], profile: ActiveProfile): string {
    const p = profile;
    const out = p.outreach;
    const candidateName = out.candidate_name || "there";
    const greetingTitle = out.email_greeting || "Your Daily Job Digest";
    const today = localDateLong(new Date());

    const lines: string[] = [
        `${greetingTitle} - ${today}`,
        `${items.length} opportunities for ${candidateName}`,
        "=".repeat(60),
        "",
    ];
    items.forEach((item, idx) => {
        lines.push(
            `#${idx + 1} - ${item.job_title ?? ""} @ ${item.company ?? ""}`,
            `Score: ${item.relevance_score ?? 0} | Location: ${item.location ?? ""}`,
            `Contact: ${item.contact_name ?? ""} (${item.contact_position ?? ""})`,
            `LinkedIn: ${item.contact_linkedin ?? ""}`,
            `Apply: ${item.job_url ?? ""}`,
            "",
            "DM to send:",
            `  ${item.dm_short ?? ""}`,
            "",
            "-".repeat(60),
            "",
        );
    });
    return lines.join("\n");
}

export interface DigestResult {
    sent?: number;
    subject?: string;
    sender?: string;
    recipient?: string;
    error?: string;
    message?: string;
    dry_run?: boolean;
    items_count?: number;
    html_length?: number;
    preview?: Array<{ title: string | null; company: string | null }>;
}

/** Send the daily digest email with the top unemailed outreach items. */
export async function sendDailyDigest(limit?: number, dryRun = false): Promise<DigestResult> {
    const cap = limit ?? env.DAILY_JOBS_COUNT;

    const profile = await getActiveProfile();
    const out = profile.outreach;
    // Sender is fixed to .env (must match SENDER_APP_PASSWORD); only recipient is overridable.
    const sender = env.SENDER_EMAIL;
    const recipient = (out.recipient_email || "").trim() || env.RECIPIENT_EMAIL;

    if (!sender || !env.SENDER_APP_PASSWORD) {
        return { error: "SENDER_EMAIL or SENDER_APP_PASSWORD not configured in .env" };
    }
    if (!recipient) {
        return { error: "Recipient email not configured (set on profile or RECIPIENT_EMAIL in .env)" };
    }

    const items = await getUnemailedOutreach(cap);
    if (!items.length) {
        return { sent: 0, message: "No new outreach items to send" };
    }

    const today = localDateShort(new Date());
    const roleWord = out.email_digest_subject_role || "job";
    const subject = `Daily ${titleCase(roleWord)} Digest - ${items.length} opportunities (${today})`;

    const html = buildEmailHtml(items, profile);
    const text = buildEmailText(items, profile);

    if (dryRun) {
        return {
            dry_run: true,
            items_count: items.length,
            subject,
            sender,
            recipient,
            html_length: html.length,
            preview: items.map((i) => ({ title: i.job_title, company: i.company })),
        };
    }

    try {
        const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            auth: { user: sender, pass: env.SENDER_APP_PASSWORD },
        });
        await transporter.sendMail({ from: sender, to: recipient, subject, text, html });

        const outreachIds = items.map((i) => i.id);
        await markOutreachEmailed(outreachIds);
        await logEmail(recipient, subject, items.length, outreachIds, "sent");
        logger.info(`Sent daily digest: ${items.length} items from ${sender} to ${recipient}`);

        return { sent: items.length, subject, sender, recipient };
    } catch (err) {
        logger.error(`Email send failed: ${String(err)}`);
        await logEmail(recipient, subject, items.length, items.map((i) => i.id), "failed", String(err));
        return { error: String(err) };
    }
}

/** Title-case a word (capitalise the first letter of each token). */
function titleCase(s: string): string {
    return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/**
 * Create outreach items for the highest-scoring jobs without one yet.
 * `seenAfter` scopes generation to a specific collection run. Returns the count.
 */
export async function generateOutreachForTopJobs(
    limit = 15,
    minScore = 40,
    indiaFriendly: string | null = "maybe",
    seenAfter: string | null = null,
): Promise<number> {
    const profile = await getActiveProfile();
    const profileId = profile._id;

    const topJobs = await getJobs({
        min_score: minScore,
        india_friendly: indiaFriendly,
        seen_after: seenAfter,
        limit: limit * 5,
    });
    const candidates: typeof topJobs = [];
    for (const job of topJobs) {
        if (candidates.length >= limit) break;
        if (!(await outreachExistsForJob(job.id))) candidates.push(job);
    }

    // All items in this run share one timestamp so batch filtering is exact.
    const batchTs = utcNowIso();
    let generated = 0;

    for (const job of candidates) {
        try {
            const searches = buildLinkedinSearches(job.company, profile);
            const dms = generateDmTemplate(job, null, profile);
            const primaryUrl = searches[0]?.url ?? "";

            const outreachId = md5Hex(`${job.id}|linkedin`);
            const row: OutreachRow = {
                id: outreachId,
                job_id: job.id,
                job_title: job.title,
                company: job.company,
                company_domain: job.company_domain ?? "",
                contact_name: "[Search LinkedIn]",
                contact_position: "Engineering Manager / Tech Lead / Head of Eng",
                contact_linkedin: primaryUrl,
                dm_short: dms.short,
                dm_long: dms.long,
                status: "pending",
                messaged_at: "",
                replied_at: "",
                followed_up_at: "",
                created_at: batchTs,
                notes: JSON.stringify(searches),
                emailed_at: "",
                profile_id: profileId,
            };
            await insertOutreach(row);
            generated += 1;
        } catch (err) {
            logger.warn(`  Skipped ${job.company}: ${String(err)}`);
            continue;
        }
    }

    if (generated > 0) await setLastOutreachBatchAt(batchTs);
    return generated;
}

// Defined in scheduler/pipeline to avoid a collector import cycle here.
export interface PipelineResult {
    collection: { new: number };
    outreach_generated: number;
    email: DigestResult | { skipped: boolean };
}

/** Full daily pipeline: collect → generate outreach → send email. */
export async function runDailyPipeline(send = true): Promise<PipelineResult> {
    // Lazy import keeps the collector module out of this file's import cycle.
    const { runCollection } = await import("../sources/collector.js");

    logger.info("=== Daily Pipeline Start ===");

    logger.info("Step 1: Collecting jobs...");
    const collectStats = await runCollection(true);
    logger.info(`  Fetched: ${collectStats.fetched}, New: ${collectStats.new}`);

    logger.info("Step 2: Generating outreach...");
    const generated = await generateOutreachForTopJobs();
    logger.info(`  Generated ${generated} new outreach items`);

    let emailResult: DigestResult | { skipped: boolean } = { skipped: true };
    if (send) {
        logger.info("Step 3: Sending email...");
        emailResult = await sendDailyDigest();
        logger.info(`  Email: ${JSON.stringify(emailResult)}`);
    }

    logger.info("=== Daily Pipeline Complete ===");
    return {
        collection: { new: collectStats.new },
        outreach_generated: generated,
        email: emailResult,
    };
}
