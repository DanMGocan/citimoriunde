import { authCopy } from "./auth-copy.ts";
const sensitive = new Set(["token", "sessionToken", "accessToken", "refreshToken", "idToken", "access_token", "refresh_token", "id_token", "password", "passwordHash", "hashedPassword", "ipAddress", "userAgent"]);
// Session cookies remain HttpOnly. The supported server API still receives bearer
// tokens internally; browser responses receive identifiers for revocation only.
export function sanitizeAuthResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuthResponse);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitive.has(key)).map(([key, entry]) => [key, sanitizeAuthResponse(entry)]));
}
export function authSuccessMessage(path: string) {
  return path.endsWith("/request-password-reset") ? authCopy.resetRequested : path.endsWith("/send-verification-email") ? authCopy.verificationRequested : path.endsWith("/change-email") ? authCopy.emailChanged : authCopy.completed;
}
