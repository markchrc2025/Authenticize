import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { pool } from "./db.js";
import { env } from "./env.js";
import { auth } from "./lib/auth.js";
import { runMigrationsWithRetry } from "./migrate.js";

const app = new Hono();

// Cross-origin requests from your apps. Only origins listed in
// TRUSTED_ORIGINS are allowed, and credentials (cookies) are enabled.
app.use(
  "/api/auth/*",
  cors({
    origin: env.trustedOrigins,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

// Shallow health check — used by Sliplane to gate deploys and monitor the
// service. Must return 2xx without auth.
app.get("/health", (c) => c.json({ status: "ok" }));

// Deep health check that also verifies database connectivity.
app.get("/health/db", async (c) => {
  try {
    await pool.query("SELECT 1");
    return c.json({ status: "ok", database: "ok" });
  } catch {
    return c.json({ status: "degraded", database: "unreachable" }, 503);
  }
});

app.get("/", (c) =>
  c.json({
    service: "my-better-auth",
    status: "ok",
    endpoints: { auth: "/api/auth/*", health: "/health" },
  }),
);

// All Better Auth endpoints (sign-up, sign-in, session, OAuth callbacks, ...).
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

async function main() {
  if (env.autoMigrate) {
    await runMigrationsWithRetry();
  }

  const server = serve(
    { fetch: app.fetch, port: env.port, hostname: "0.0.0.0" },
    (info) => {
      console.log(`My Better Auth listening on http://${info.address}:${info.port}`);
      console.log(`Base URL: ${env.baseURL}`);
    },
  );

  // Graceful shutdown so Sliplane's zero-downtime deploys drain cleanly.
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
