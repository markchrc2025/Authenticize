import { betterAuth } from "better-auth";
import { pool } from "./db.js";
import { env } from "./env.js";

/**
 * The platform is invite-only (public sign-up disabled), so the first admin
 * account has to come from somewhere: this runs on every boot, after
 * migrations.
 *
 * 1. Any existing user whose email is listed in ADMIN_EMAILS is promoted to
 *    the "admin" role.
 * 2. If the first ADMIN_EMAILS user doesn't exist yet and
 *    ADMIN_INITIAL_PASSWORD is set, the account is created via a transient
 *    Better Auth instance (public APIs only — same database and secret, with
 *    sign-up allowed), then promoted.
 */
export async function ensureAdminUsers(): Promise<void> {
  if (env.adminEmails.length === 0) {
    console.warn(
      "[bootstrap] ADMIN_EMAILS is not set — nobody can access the admin dashboard.",
    );
    return;
  }

  const promoted = await pool.query(
    `UPDATE "user" SET role = 'admin', "updatedAt" = now()
     WHERE lower(email) = ANY($1) AND (role IS NULL OR role <> 'admin')
     RETURNING email`,
    [env.adminEmails],
  );
  for (const row of promoted.rows) {
    console.log(`[bootstrap] Promoted ${row.email} to admin.`);
  }

  const firstAdmin = env.adminEmails[0];
  const existing = await pool.query(
    `SELECT id FROM "user" WHERE lower(email) = $1`,
    [firstAdmin],
  );
  if ((existing.rowCount ?? 0) > 0) return;

  if (!env.adminInitialPassword) {
    console.warn(
      `[bootstrap] No account exists for ${firstAdmin} and ADMIN_INITIAL_PASSWORD is not set — ` +
        "set it (once) so the first admin account can be created.",
    );
    return;
  }

  const bootstrapAuth = betterAuth({
    baseURL: env.baseURL,
    secret: env.secret,
    database: pool,
    emailAndPassword: { enabled: true },
    telemetry: { enabled: false },
  });
  await bootstrapAuth.api.signUpEmail({
    body: {
      email: firstAdmin,
      password: env.adminInitialPassword,
      name: "Administrator",
    },
  });
  await pool.query(
    `UPDATE "user" SET role = 'admin', "updatedAt" = now() WHERE lower(email) = $1`,
    [firstAdmin],
  );
  console.log(
    `[bootstrap] Created admin account for ${firstAdmin}. ` +
      "Sign in and change this password, then remove ADMIN_INITIAL_PASSWORD.",
  );
}
