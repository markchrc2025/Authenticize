import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";
import type { EmailMessage } from "./index.js";

// Generic SMTP transport. Covers Amazon SES (email-smtp.<region>.amazonaws.com
// with SES SMTP credentials), Gmail app passwords, and any other relay —
// switching providers is purely an env-var change.
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.email.smtpHost,
      port: env.email.smtpPort,
      secure: env.email.smtpSecure,
      auth: env.email.smtpUser
        ? { user: env.email.smtpUser, pass: env.email.smtpPass }
        : undefined,
    });
  }
  return transporter;
}

export async function sendViaSmtp(message: EmailMessage): Promise<void> {
  await getTransporter().sendMail({
    from: env.email.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
