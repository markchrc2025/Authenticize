import { env } from "../env.js";
import { sendViaResend } from "./resend.js";
import { sendViaSmtp } from "./smtp.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * True when an outbound email provider is fully configured. The rest of the
 * platform works without one — email-dependent features (password reset,
 * invites, verification) surface a clear error until it is set up.
 */
export function emailConfigured(): boolean {
  if (!env.email.from) return false;
  if (env.email.provider === "resend") return Boolean(env.email.resendApiKey);
  if (env.email.provider === "smtp") return Boolean(env.email.smtpHost);
  return false;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!emailConfigured()) {
    throw new Error(
      "Email is not configured. Set EMAIL_PROVIDER (resend or smtp), EMAIL_FROM, " +
        "and the provider credentials (RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS).",
    );
  }
  if (env.email.provider === "resend") {
    await sendViaResend(message);
  } else {
    await sendViaSmtp(message);
  }
  console.log(`[email] Sent "${message.subject}" to ${message.to} via ${env.email.provider}`);
}
