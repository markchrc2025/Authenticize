import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const secret = required("BETTER_AUTH_SECRET");
if (secret.length < 32) {
  console.warn(
    "[env] BETTER_AUTH_SECRET should be at least 32 characters. Generate one with: openssl rand -base64 32",
  );
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret,
  databaseUrl: required("DATABASE_URL"),
  trustedOrigins: csv(process.env.TRUSTED_ORIGINS),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  autoMigrate: (process.env.AUTO_MIGRATE ?? "true").toLowerCase() !== "false",

  // Emails allowed to administer the platform (dashboard + admin APIs).
  // The first entry is created automatically on first boot when
  // ADMIN_INITIAL_PASSWORD is set.
  adminEmails: csv(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD || undefined,

  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
};
