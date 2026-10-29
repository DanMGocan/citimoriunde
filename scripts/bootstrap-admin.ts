import { config } from "../src/lib/config";
import { pool, transaction } from "../src/lib/db";
class BootstrapRequirementError extends Error {}
try {
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(73142620)");
    const existing = await client.query("SELECT 1 FROM admin_bootstrap WHERE id=true");
    if (existing.rowCount) throw new BootstrapRequirementError("Admin bootstrap has already been completed. Existing administrators manage roles through the audited UI.");
    const result = await client.query(`SELECT u.id,u."emailVerified",u."twoFactorEnabled",m.adult,m.status
      FROM "user" u JOIN members m ON m.id=u.id
      WHERE lower(u.email)=$1 AND EXISTS(SELECT 1 FROM account a WHERE a."userId"=u.id AND a."providerId"='google' AND length(a."accountId")>0)
      AND EXISTS(SELECT 1 FROM "twoFactor" t WHERE t."userId"=u.id AND t.verified=true) FOR UPDATE OF u,m`, [config.adminBootstrapEmail]);
    const user = result.rows[0];
    if (!user || !user.emailVerified || !user.twoFactorEnabled || !user.adult || user.status !== "ACTIVE") throw new BootstrapRequirementError("Bootstrap requires the configured account to sign in through real Google OAuth, complete adult/profile onboarding, and enrol/verify TOTP first. No account was created or promoted.");
    await client.query("UPDATE members SET role='ADMIN' WHERE id=$1", [user.id]);
    await client.query("INSERT INTO admin_bootstrap(id,user_id) VALUES(true,$1)", [user.id]);
    await client.query("INSERT INTO audit_log(actor_id,action,target_type,target_id,reason) VALUES($1,'ADMIN_BOOTSTRAP','member',$1,'One-time local operator command after verified Google and TOTP enrolment')", [user.id]);
  });
  console.log("One-time admin bootstrap completed. Sign in and verify TOTP again for a fresh admin session.");
} catch (error) { console.error(error instanceof BootstrapRequirementError ? error.message : "Bootstrap failed; check private database/service prerequisites. Details redacted."); process.exitCode = 1; }
finally { await pool.end(); }
