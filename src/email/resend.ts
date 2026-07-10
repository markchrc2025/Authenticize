import { env } from "../env.js";
import type { EmailMessage } from "./index.js";

/**
 * Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Plain fetch — no SDK dependency. RESEND_API_URL is overridable for tests.
 */
export async function sendViaResend(message: EmailMessage): Promise<void> {
  const res = await fetch(`${env.email.resendApiUrl}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.email.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.email.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body.slice(0, 300)}`);
  }
}
