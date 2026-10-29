import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { config, type AppConfig } from "./config";
import { pool, query } from "./db";
import { authCopy } from "./auth-copy";

// Only the HTTP signup wrapper creates this server-owned context. The library's
// real creation hook captures the ID; duplicate-email synthetic responses never
// mark an existing account as newly created. No private data is logged or sent
// to the browser, and provider/profile onboarding remains a separate assertion.
const localSignupContext = new AsyncLocalStorage<{ createdUserId: string | null }>();
export async function captureLocalSignupCreation(handler: () => Promise<Response>) {
  const state = { createdUserId: null as string | null };
  const response = await localSignupContext.run(state, handler);
  return { response, createdUserId: state.createdUserId };
}

async function queueAuthEmail(settings: AppConfig, type: "verification" | "reset", email: string, url: string) {
  if (settings.mailMode !== "smtp" || !settings.smtpHost || !settings.smtpFrom) {
    // Tokens are never sent to stdout or exposed by a development API.
    if (settings.environment === "production") throw new APIError("SERVICE_UNAVAILABLE", { message: authCopy.emailUnavailable });
  }
  const dedupe = createHash("sha256").update(`${type}:${url}`).digest("hex");
  await query("INSERT INTO jobs(type,dedupe_key,payload,status,attempts,run_at) VALUES('auth_email',$1,$2,'PENDING',0,now()) ON CONFLICT(dedupe_key) DO NOTHING", [
    `auth:${dedupe}`, JSON.stringify({ template: type, to: email, url, expiresAt: Date.now() + 3600000 }),
  ]);
}
export function createAuth(settings: AppConfig = config) {
return betterAuth({
  appName: settings.appName,
  baseURL: settings.appUrl,
  basePath: "/api/auth",
  secret: settings.authSecret,
  database: pool,
  trustedOrigins: [settings.appUrl],
  logger: { disabled: true },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({ ...coreFields, twoFactorEnabled: false, ...additionalFields, id }),
    sendResetPassword: async ({ user, url }) => { await queueAuthEmail(settings, "reset", user.email, url); },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: 3600,
    sendVerificationEmail: async ({ user, url }) => { await queueAuthEmail(settings, "verification", user.email, url); },
  },
  socialProviders: settings.googleEnabled ? {
    google: {
      clientId: settings.googleClientId, clientSecret: settings.googleClientSecret,
      disableDefaultScope: true, scope: ["openid", "email", "profile"],
      requireEmailVerification: true, disableIdTokenSignIn: true, includeGrantedScopes: false,
      prompt: "select_account",
      mapProfileToUser: () => ({ image: undefined }),
    },
  } : {},
  account: {
    encryptOAuthTokens: true,
    accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: false, updateUserInfoOnLink: false },
  },
  user: { deleteUser: { enabled: false }, changeEmail: { enabled: true } },
  session: {
    expiresIn: settings.sessionDays * 86400,
    updateAge: 86400,
    freshAge: 600,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true, storage: "database", window: 60, max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: settings.authRateLimit },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 5 },
      "/two-factor/*": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: settings.environment === "production",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: settings.environment === "production" },
    ipAddress: { ipAddressHeaders: settings.trustedProxy ? ["x-real-ip"] : [] },
    database: { generateId: () => crypto.randomUUID() },
  },
  databaseHooks: {
    user: {
      create: { before: async (user) => {
        const invited = user.email.toLowerCase() === settings.adminBootstrapEmail && user.emailVerified;
        if (!settings.registrationEnabled && !invited) throw new APIError("FORBIDDEN", { message: authCopy.registrationDisabled });
        if (settings.environment === "production" && settings.registrationEnabled) {
          const published = await query("SELECT count(DISTINCT slug)::int AS count FROM legal_documents WHERE NOT is_draft AND published_at IS NOT NULL AND published_at<=now() AND slug=ANY($1)", [["termeni","confidentialitate","cookie-uri","reguli-comunitate","siguranta","imprumuturi-daruri","raportare-contestatii","operator-contact"]]);
          if (published.rows[0].count !== 8) throw new APIError("FORBIDDEN", { message: authCopy.registrationDisabled });
        }
        return { data: { ...user, image: null } };
      }, after: async (user) => {
        const signup = localSignupContext.getStore();
        if (signup) signup.createdUserId = user.id;
      } },
      update: { before: async (user) => ({ data: { ...user, image: null } }) },
    },
    session: { create: { before: async (session) => {
      const blocked = await query("SELECT 1 FROM members WHERE id=$1 AND status <> 'ACTIVE'", [session.userId]);
      if (blocked.rowCount) throw new APIError("FORBIDDEN", { message: authCopy.accountRestricted });
      return { data: session };
    } } },
  },
  plugins: [twoFactor({ issuer: settings.appName, allowPasswordless: true, skipVerificationOnEnable: false })],
});
}
export const auth = createAuth();

// OAuth sessions need a separate server-side step-up because the library's 2FA
// plugin only challenges credential sign-ins by default. Markers never survive a new session.
export async function hasAdminStepUp(userId: string, sessionId: string) {
  const result = await query("SELECT 1 FROM auth_stepups WHERE session_id=$1 AND user_id=$2 AND expires_at>now()", [sessionId, userId]);
  return Boolean(result.rowCount);
}
