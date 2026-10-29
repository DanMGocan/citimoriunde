import { auth, captureLocalSignupCreation } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, transaction } from "@/lib/db";
import { authCopy } from "@/lib/auth-copy";
import { createHash } from "node:crypto";
import { authSuccessMessage, sanitizeAuthResponse } from "@/lib/auth-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 32768) { void reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const failure = (message: string, code: string, status: number) => Response.json({ message, error: message, code }, { status, headers: { "Cache-Control": "no-store" } });
async function executeAuth(request: Request) {
  let incoming = request;
  let signupPolicyIds: string[] | null = null;
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  // The site does not need provider token/profile APIs or hard account deletion.
  // Keep sensitive provider material and raw Google profile pictures server-side.
  if (["/get-access-token", "/refresh-token", "/account-info", "/delete-user"].some(endpoint => path.endsWith(endpoint))) return failure(authCopy.endpointDisabled, "ENDPOINT_DISABLED", 404);
  if (request.method === "POST") {
    if (path.endsWith("/sign-up/email") && !config.registrationEnabled) return failure(authCopy.registrationDisabled, "REGISTRATION_DISABLED", 403);
    if (request.headers.get("origin") !== new URL(config.appUrl).origin) return failure(authCopy.invalidOrigin, "INVALID_ORIGIN", 403);
    if (Number(request.headers.get("content-length") || 0) > 32768) return failure(authCopy.bodyLimit, "BODY_LIMIT", 413);
    const body = await boundedBody(request);
    if (body === null) return failure(authCopy.bodyLimit, "BODY_LIMIT", 413);
    let data: Record<string, unknown> = {};
    try { if (body) data = JSON.parse(body); if (!data || Array.isArray(data) || typeof data !== "object") throw new Error(); } catch { return failure(authCopy.invalidInput, "INVALID_INPUT", 400); }
    if ("image" in data && data.image != null) return failure(authCopy.iconOnly, "ICON_ONLY", 400);
    if (path.endsWith("/sign-up/email")) {
      if (data.adult !== true || data.acceptedTerms !== true) return failure(authCopy.adultTermsRequired, "ADULT_TERMS_REQUIRED", 400);
      const policies = await query<{ id: string }>("SELECT DISTINCT ON(slug) id FROM legal_documents WHERE slug=ANY($1) AND ((NOT is_draft AND published_at IS NOT NULL AND published_at<=now()) OR $2) ORDER BY slug,version DESC", [["termeni", "confidentialitate", "imprumuturi-daruri"], config.environment !== "production"]);
      if (policies.rowCount !== 3) return failure(authCopy.legalNotReady, "LEGAL_NOT_READY", 403);
      signupPolicyIds = policies.rows.map(policy => policy.id);
      // Assertions are application data, not user-defined Better Auth fields.
      delete data.adult;
      delete data.acceptedTerms;
    }
    // Use the audited authorization-code flow; no arbitrary client token imports or scopes.
    if (data.idToken || data.scopes || data.additionalParams) return failure(authCopy.oauthFlow, "OAUTH_FLOW_REQUIRED", 400);
    if (path.endsWith("/link-social")) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user.emailVerified || Date.now() - new Date(session.session.createdAt).getTime() > 600000) return failure(authCopy.freshSession, "FRESH_VERIFIED_SESSION_REQUIRED", 403);
    }
    if (path.endsWith("/revoke-session")) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return failure(authCopy.sessionRequired, "SESSION_REQUIRED", 401);
      if (typeof data.sessionId !== "string" || data.sessionId.length > 128 || "token" in data) return failure(authCopy.invalidSession, "INVALID_SESSION", 400);
      const selected = await query("SELECT token FROM session WHERE id=$1 AND \"userId\"=$2", [data.sessionId, session.user.id]);
      if (!selected.rowCount) return failure(authCopy.sessionNotFound, "SESSION_NOT_FOUND", 404);
      data = { token: selected.rows[0].token };
    }
    if (path.endsWith("/two-factor/disable")) {
      const session = await auth.api.getSession({ headers: request.headers });
      const member = session ? await query("SELECT role FROM members WHERE id=$1", [session.user.id]) : null;
      if (member?.rows[0]?.role === "ADMIN") return failure(authCopy.adminFactorRequired, "ADMIN_2FA_REQUIRED", 403);
    }
    const headers = new Headers(request.headers); headers.delete("content-length");
    incoming = new Request(request.url, { method: request.method, headers, body: JSON.stringify(data) });
  }
  try {
    const creation = signupPolicyIds ? await captureLocalSignupCreation(() => auth.handler(incoming)) : null;
    const response = creation?.response ?? await auth.handler(incoming);
    if (response.ok && signupPolicyIds && creation?.createdUserId) {
      const result = await response.clone().json();
      if (result?.user?.id !== creation.createdUserId) return failure(authCopy.unavailable, "AUTH_UNAVAILABLE", 503);
      await transaction(async client => {
        const user = (await client.query(`SELECT u.id,u.name FROM "user" u WHERE u.id=$1 AND EXISTS(SELECT 1 FROM account a WHERE a."userId"=u.id AND a."providerId"='credential' AND a.password IS NOT NULL)`, [creation.createdUserId])).rows[0];
        if (!user) throw new Error("New local signup identity was not persisted.");
        const policyCount = await client.query("SELECT count(*)::int AS count FROM legal_documents WHERE id=ANY($1::uuid[])", [signupPolicyIds]);
        if (policyCount.rows[0].count !== 3) throw new Error("Signup policy versions are unavailable.");
        const handle = `cititor_${createHash("sha256").update(user.id).digest("hex").slice(0, 12)}`;
        await client.query("INSERT INTO members(id,display_name,handle,adult) VALUES($1,$2,$3,true) ON CONFLICT(id) DO UPDATE SET adult=true", [user.id, String(user.name).slice(0, 80), handle]);
        await client.query("INSERT INTO legal_acceptances(member_id,document_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING", [user.id, signupPolicyIds]);
        await client.query("INSERT INTO audit_log(actor_id,action,target_type,target_id,data) VALUES($1,'REGISTRATION_ATTESTATION','member',$1,$2)", [user.id, JSON.stringify({ adultSelfAttestation: true, documentIds: signupPolicyIds })]);
      });
    }
    if (request.method === "POST" && path.endsWith("/two-factor/verify-totp") && response.ok) {
      // The authenticated session is read from incoming cookies for OAuth step-up.
      // Credential challenges create their own session; the UI repeats verification once signed in.
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user.twoFactorEnabled) await query("INSERT INTO auth_stepups(session_id,user_id,expires_at) VALUES($1,$2,now()+$3*interval '1 minute') ON CONFLICT(session_id) DO UPDATE SET expires_at=excluded.expires_at", [session.session.id, session.user.id, config.adminStepUpMinutes]);
    }
    response.headers.set("Cache-Control", "no-store");
    if (!response.ok && response.headers.get("content-type")?.includes("json")) {
      const error = await response.clone().json().catch(() => ({}));
      const code = typeof error.code === "string" ? error.code : "AUTH_FAILED";
      const message = response.status === 429 ? authCopy.rateLimit : code === "ACCOUNT_NOT_LINKED" ? authCopy.accountLink : authCopy.failed;
      return Response.json({ message, error: message, code }, { status: response.status, headers: response.headers });
    }
    if (response.ok && response.headers.get("content-type")?.includes("json")) {
      const raw = await response.json();
      if (raw && !Array.isArray(raw) && typeof raw === "object" && typeof raw.message === "string") raw.message = authSuccessMessage(path);
      const safe = sanitizeAuthResponse(raw);
      response.headers.delete("content-length");
      return Response.json(safe, { status: response.status, headers: response.headers });
    }
    return response;
  } catch { return failure(authCopy.unavailable, "AUTH_UNAVAILABLE", 503); }
}
async function handle(request: Request) {
  try { return await executeAuth(request); }
  catch { return failure(authCopy.unavailable, "AUTH_UNAVAILABLE", 503); }
}
export const GET = handle;
export const POST = handle;
