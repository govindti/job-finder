import type { ActiveProfile } from "../profiles/profiles.types.js";
import type { OutreachUnemailed } from "../outreach/outreach.types.js";
import type { LinkedinSearch } from "../outreach/linkedin.js";

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

export function localDateShort(now: Date): string {
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

/** Title-case a word (capitalise the first letter of each token). */
export function titleCase(s: string): string {
    return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
