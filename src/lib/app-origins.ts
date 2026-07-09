import { pool } from "../db.js";

/**
 * better-auth stores `string[]` fields as JSON text in SQL databases; be
 * lenient and accept real arrays, JSON strings, or comma-separated strings.
 */
export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through to comma-split
    }
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

let cache: { at: number; origins: string[] } = { at: 0, origins: [] };
const TTL_MS = 30_000;

/**
 * Origins derived from the redirect URIs of every enabled OAuth client.
 * Registering an app in the dashboard automatically trusts its origin for
 * CORS and Better Auth origin checks. Cached briefly; the admin API
 * invalidates the cache on any client mutation.
 */
export async function getRegisteredClientOrigins(): Promise<string[]> {
  if (Date.now() - cache.at < TTL_MS) return cache.origins;
  try {
    const res = await pool.query(
      `SELECT "redirectUris" FROM "oauthClient" WHERE COALESCE(disabled, false) = false`,
    );
    const origins = new Set<string>();
    for (const row of res.rows) {
      for (const uri of parseStringArray(row.redirectUris)) {
        try {
          origins.add(new URL(uri).origin);
        } catch {
          // ignore unparseable redirect URIs
        }
      }
    }
    cache = { at: Date.now(), origins: [...origins] };
  } catch {
    // Table may not exist yet (before first migration) — serve stale/empty
    // rather than failing the request.
  }
  return cache.origins;
}

export function invalidateClientOriginsCache(): void {
  cache = { at: 0, origins: cache.origins };
}
