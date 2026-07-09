import { betterAuth } from "better-auth";
import { pool } from "../db.js";
import { env } from "../env.js";

export const auth = betterAuth({
  appName: "My Better Auth",
  baseURL: env.baseURL,
  secret: env.secret,
  database: pool,

  // Origins of the apps that are allowed to call this auth server.
  trustedOrigins: env.trustedOrigins,

  emailAndPassword: {
    enabled: true,
  },

  // Social providers are only registered when their credentials are set,
  // so the server runs fine before you configure any of them.
  socialProviders: {
    ...(env.github.clientId && env.github.clientSecret
      ? {
          github: {
            clientId: env.github.clientId,
            clientSecret: env.github.clientSecret,
          },
        }
      : {}),
    ...(env.google.clientId && env.google.clientSecret
      ? {
          google: {
            clientId: env.google.clientId,
            clientSecret: env.google.clientSecret,
          },
        }
      : {}),
  },

  // When COOKIE_DOMAIN is set (e.g. ".example.com"), the session cookie is
  // shared across every subdomain, so app.example.com and admin.example.com
  // can reuse the session issued by auth.example.com.
  ...(env.cookieDomain
    ? {
        advanced: {
          crossSubDomainCookies: {
            enabled: true,
            domain: env.cookieDomain,
          },
        },
      }
    : {}),

  telemetry: {
    enabled: false,
  },
});
