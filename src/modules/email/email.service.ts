import nodemailer from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { getActiveProfile } from "../profiles/profiles.service.js";
import { getUnemailedOutreach, markOutreachEmailed } from "../outreach/outreach.service.js";
import { logEmail, getEmailLogs } from "./email.repository.js";
import { AppError } from "../../common/errors/app-error.js";
import { buildEmailHtml, buildEmailText, localDateShort, titleCase } from "./email.template.js";

export interface DigestResult {
    sent?: number;
    subject?: string;
    sender?: string;
    recipient?: string;
    message?: string;
    dry_run?: boolean;
    items_count?: number;
    html_length?: number;
    preview?: Array<{ title: string | null; company: string | null }>;
}

export async function getEmailStatus() {
    const logs = await getEmailLogs(10);
    const out = (await getActiveProfile()).outreach;
    const profileRecipient = (out.recipient_email || "").trim();
    const envRecipient = env.RECIPIENT_EMAIL;
    return {
        sender_configured: Boolean(env.SENDER_EMAIL) && Boolean(env.SENDER_APP_PASSWORD),
        sender: env.SENDER_EMAIL,
        sender_source: env.SENDER_EMAIL ? "env" : "none",
        recipient: profileRecipient || envRecipient,
        recipient_source: profileRecipient ? "profile" : envRecipient ? "env" : "none",
        candidate_name: out.candidate_name || "",
        scheduled_hour: env.DAILY_EMAIL_HOUR,
        timezone: env.DAILY_EMAIL_TIMEZONE,
        recent_sends: logs,
    };
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
        throw new AppError("EMAIL_NOT_CONFIGURED");
    }
    if (!recipient) {
        throw new AppError("RECIPIENT_NOT_CONFIGURED");
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
        try {
            await logEmail(recipient, subject, items.length, items.map((i) => i.id), "failed", String(err));
        } catch (logError) {
            logger.error({ err: logError }, "Unable to log failed delivery");
        }
        throw new AppError("EMAIL_DELIVERY_FAILED", { cause: err });
    }
}
