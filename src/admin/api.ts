import { APIError } from "better-auth/api";
import { Hono } from "hono";
import { pool } from "../db.js";
import { env } from "../env.js";
import {
  invalidateClientOriginsCache,
  parseStringArray,
} from "../lib/app-origins.js";
import { auth, isAdminUser } from "../lib/auth.js";

/**
 * Platform admin API consumed by the dashboard. Everything here requires an
 * authenticated session with admin access; the Better Auth endpoints called
 * underneath additionally enforce their own permission checks.
 */
export const adminApi = new Hono();

adminApi.onError((err, c) => {
  if (err instanceof APIError) {
    const status = typeof err.statusCode === "number" ? err.statusCode : 500;
    const body =
      err.body && typeof err.body === "object"
        ? err.body
        : { message: err.message };
    return c.json(body, status as never);
  }
  console.error("[admin-api] Unhandled error:", err);
  return c.json({ message: "Internal server error" }, 500);
});

adminApi.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session || !isAdminUser(session.user)) {
    return c.json({ message: "Admin access required" }, 403);
  }
  await next();
});

adminApi.get("/stats", async (c) => {
  const [users, sessions, apps] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM "user"`),
    pool.query(`SELECT count(*)::int AS n FROM "session" WHERE "expiresAt" > now()`),
    pool.query(`SELECT count(*)::int AS n FROM "oauthClient"`),
  ]);
  return c.json({
    users: users.rows[0].n,
    activeSessions: sessions.rows[0].n,
    apps: apps.rows[0].n,
  });
});

adminApi.get("/config", (c) =>
  c.json({
    issuer: env.baseURL,
    discovery: `${env.baseURL}/.well-known/openid-configuration`,
    authBasePath: "/api/auth",
    inviteOnly: true,
    cookieDomain: env.cookieDomain ?? null,
    socialProviders: {
      github: Boolean(env.github.clientId && env.github.clientSecret),
      google: Boolean(env.google.clientId && env.google.clientSecret),
    },
  }),
);

function mapClientRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name ?? null,
    type: row.type ?? "web",
    redirectUris: parseStringArray(row.redirectUris),
    postLogoutRedirectUris: parseStringArray(row.postLogoutRedirectUris),
    scopes: parseStringArray(row.scopes),
    grantTypes: parseStringArray(row.grantTypes),
    disabled: Boolean(row.disabled),
    skipConsent: Boolean(row.skipConsent),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// List all registered apps. Read directly from the database: the Better Auth
// list endpoint scopes to the session user, but platform apps are created
// ownerless via the server-only admin endpoint.
adminApi.get("/apps", async (c) => {
  const res = await pool.query(
    `SELECT id, "clientId", name, type, "redirectUris", "postLogoutRedirectUris",
            scopes, "grantTypes", disabled, "skipConsent", "createdAt", "updatedAt"
     FROM "oauthClient"
     ORDER BY "createdAt" DESC NULLS LAST`,
  );
  return c.json({ apps: res.rows.map(mapClientRow) });
});

// Register a new app. Returns the client credentials — the client_secret is
// only ever returned by this response (stored hashed).
adminApi.post("/apps", async (c) => {
  const body = await c.req.json<{
    name?: string;
    redirect_uris?: string[];
    type?: "web" | "native" | "user-agent-based";
    skip_consent?: boolean;
    scope?: string;
    grant_types?: ("authorization_code" | "client_credentials" | "refresh_token")[];
    client_uri?: string;
    logo_uri?: string;
    post_logout_redirect_uris?: string[];
  }>();

  if (!body.name?.trim()) {
    return c.json({ message: "name is required" }, 400);
  }
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return c.json({ message: "redirect_uris must be a non-empty array" }, 400);
  }

  const type = body.type ?? "web";
  // Even the server-only admin endpoint runs assertClientPrivileges, so the
  // admin's session headers must be forwarded.
  const created = await auth.api.adminCreateOAuthClient({
    headers: c.req.raw.headers,
    body: {
      client_name: body.name.trim(),
      redirect_uris: body.redirect_uris,
      type,
      // Public clients (SPA/native) authenticate with PKCE only.
      token_endpoint_auth_method: type === "web" ? "client_secret_basic" : "none",
      // First-party apps skip the consent screen by default.
      skip_consent: body.skip_consent ?? true,
      ...(body.scope ? { scope: body.scope } : {}),
      ...(body.grant_types ? { grant_types: body.grant_types } : {}),
      ...(body.client_uri ? { client_uri: body.client_uri } : {}),
      ...(body.logo_uri ? { logo_uri: body.logo_uri } : {}),
      ...(body.post_logout_redirect_uris
        ? { post_logout_redirect_uris: body.post_logout_redirect_uris }
        : {}),
    },
  });
  invalidateClientOriginsCache();
  return c.json(created, 201);
});

// Update app settings (name, redirect URIs, consent behavior, ...).
adminApi.patch("/apps/:clientId", async (c) => {
  const update = await c.req.json<Record<string, unknown>>();
  const updated = await auth.api.adminUpdateOAuthClient({
    headers: c.req.raw.headers,
    body: {
      client_id: c.req.param("clientId"),
      update,
    },
  });
  invalidateClientOriginsCache();
  return c.json(updated);
});

// Enable/disable an app without deleting it. (Not part of the plugin's
// update schema, so toggled directly.)
adminApi.post("/apps/:clientId/disabled", async (c) => {
  const { disabled } = await c.req.json<{ disabled?: boolean }>();
  if (typeof disabled !== "boolean") {
    return c.json({ message: "disabled must be a boolean" }, 400);
  }
  const res = await pool.query(
    `UPDATE "oauthClient" SET disabled = $1, "updatedAt" = now()
     WHERE "clientId" = $2 RETURNING "clientId"`,
    [disabled, c.req.param("clientId")],
  );
  if (res.rowCount === 0) {
    return c.json({ message: "Unknown client" }, 404);
  }
  invalidateClientOriginsCache();
  return c.json({ clientId: c.req.param("clientId"), disabled });
});

// Rotate the client secret. Returns the new secret — shown once.
adminApi.post("/apps/:clientId/rotate-secret", async (c) => {
  const rotated = await auth.api.rotateClientSecret({
    body: { client_id: c.req.param("clientId") },
    headers: c.req.raw.headers,
  });
  return c.json(rotated);
});

adminApi.delete("/apps/:clientId", async (c) => {
  await auth.api.deleteOAuthClient({
    body: { client_id: c.req.param("clientId") },
    headers: c.req.raw.headers,
  });
  invalidateClientOriginsCache();
  return c.json({ deleted: true });
});
