import { pathToFileURL } from "node:url";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "./lib/auth.js";
import { ensureSignInMethodsTable } from "./lib/sign-in-methods.js";

export async function runMigrations(): Promise<void> {
  const { toBeCreated, toBeAdded, runMigrations: run } = await getMigrations(
    auth.options,
  );

  if (toBeCreated.length === 0 && toBeAdded.length === 0) {
    console.log("[migrate] Database schema is up to date.");
  } else {
    const tables = [...toBeCreated, ...toBeAdded].map((t) => t.table).join(", ");
    console.log(`[migrate] Applying schema changes for: ${tables}`);
    await run();
    console.log("[migrate] Migrations applied.");
  }

  // App-owned tables outside Better Auth's schema (created idempotently).
  await ensureSignInMethodsTable();
}

// The database may still be booting when the container starts (fresh deploys,
// restarts), so retry before giving up.
export async function runMigrationsWithRetry(
  attempts = 5,
  delayMs = 3000,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await runMigrations();
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(
        `[migrate] Attempt ${attempt}/${attempts} failed (${
          error instanceof Error ? error.message : String(error)
        }). Retrying in ${delayMs / 1000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("[migrate] Failed:", error);
      process.exit(1);
    });
}
