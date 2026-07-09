import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { pool } from "./db.js";
import { env } from "./env.js";
import { auth } from "./lib/auth.js";

/**
 * The platform is invite-only (public sign-up disabled), so the first admin
 * account has to come from somewhere: this runs on every boot, after
 * migrations.
 *
 * 1. Any existing user whose email is listed in ADMIN_EMAILS is promoted to
 *    the "admin" role.
 * 2. If the first ADMIN_EMAILS user doesn't exist yet and
 *    ADMIN_INITIAL_PASSWORD is set, the account is created via a transient
 *    Better Auth instance (public APIs only), then promoted.
 * 3. If ADMIN_RESET_PASSWORD is set, the password of every existing
 *    ADMIN_EMAILS account is force-reset to it (escape hatch for lockouts).
 */
export async function ensureAdminUsers(): Promise<void> {
  try {
    await reconcileAdmins();
  } catch (error) {
    // Never let admin bootstrap crash the server — a running instance that
    // logs the problem is far better than a crash-loop that fails health
    // checks. Fix the cause (e.g. invalid ADMIN_EMAILS) and redeploy.
    console.error("[bootstrap] Admin bootstrap failed:", error);
  }
}

async function reconcileAdmins(): Promise<void> {
  if (env.adminEmails.length === 0) {
    console.warn(
      "[bootstrap] ADMIN_EMAILS is not set — nobody can access the admin dashboard.",
    );
    return;
  }

  await promoteAdmins();

  const firstAdmin = env.adminEmails[0];
  const exists = await userExists(firstAdmin);

  if (!exists && env.adminInitialPassword) {
    await createUser(firstAdmin, env.adminInitialPassword);
    await promoteAdmins();
    console.log(
      `[bootstrap] Created admin account for ${firstAdmin}. ` +
        "Sign in and change this password, then remove ADMIN_INITIAL_PASSWORD.",
    );
  } else if (!exists && !env.adminResetPassword) {
    console.warn(
      `[bootstrap] No account exists for ${firstAdmin}. Set ADMIN_INITIAL_PASSWORD ` +
        "(to create it) or ADMIN_RESET_PASSWORD (to create + set a known password).",
    );
  }

  // Escape hatch: force-reset admin passwords. Runs every boot while set, so
  // it must be removed once you're back in.
  if (env.adminResetPassword) {
    for (const email of env.adminEmails) {
      if (!(await userExists(email))) {
        await createUser(email, env.adminResetPassword);
      } else {
        await forceSetPassword(email, env.adminResetPassword);
      }
    }
    await promoteAdmins();
    console.warn(
      "[bootstrap] ADMIN_RESET_PASSWORD is set — admin password(s) were reset. " +
        "Sign in, then REMOVE ADMIN_RESET_PASSWORD so it can't reset again on the next deploy.",
    );
  }
}

async function promoteAdmins(): Promise<void> {
  const promoted = await pool.query(
    `UPDATE "user" SET role = 'admin', "updatedAt" = now()
     WHERE lower(email) = ANY($1) AND (role IS NULL OR role <> 'admin')
     RETURNING email`,
    [env.adminEmails],
  );
  for (const row of promoted.rows) {
    console.log(`[bootstrap] Promoted ${row.email} to admin.`);
  }
}

async function userExists(email: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM "user" WHERE lower(email) = $1`,
    [email.toLowerCase()],
  );
  return (res.rowCount ?? 0) > 0;
}

async function createUser(email: string, password: string): Promise<void> {
  // A transient instance with sign-up enabled, so we don't replicate password
  // hashing. Same pool/secret as the main instance.
  const bootstrapAuth = betterAuth({
    baseURL: env.baseURL,
    secret: env.secret,
    database: pool,
    emailAndPassword: { enabled: true },
    telemetry: { enabled: false },
  });
  await bootstrapAuth.api.signUpEmail({
    body: { email, password, name: "Administrator" },
  });
}

/**
 * Force-set the credential password for an existing account, matching Better
 * Auth's own hashing (via the auth context) so login verifies correctly.
 * Creates the credential account if the user has none (e.g. a social-only or
 * half-provisioned account).
 */
async function forceSetPassword(email: string, password: string): Promise<void> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);

  const userRes = await pool.query(
    `SELECT id FROM "user" WHERE lower(email) = $1`,
    [email.toLowerCase()],
  );
  if (userRes.rowCount === 0) return;
  const userId = userRes.rows[0].id as string;

  const updated = await pool.query(
    `UPDATE account SET password = $1, "updatedAt" = now()
     WHERE "userId" = $2 AND "providerId" = 'credential'
     RETURNING id`,
    [hash, userId],
  );
  if (updated.rowCount === 0) {
    await pool.query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
      [randomUUID(), userId, hash],
    );
  }
  console.log(`[bootstrap] Reset password for ${email}.`);
}
