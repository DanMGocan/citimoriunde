import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "../src/lib/config";
import { pool, query, transaction } from "../src/lib/db";
import { processMaintenance, processDomainJob } from "../src/domain/maintenance";
import { authEmailCopy, notificationEmailCopy } from "../src/lib/auth-copy";
import { createMailTransport } from "../src/lib/mail";
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { stopping = true; });
const transport = createMailTransport();
async function deliver(job: { id: string; type: string; payload: Record<string, unknown> }) {
  if (await processDomainJob(job)) return;
  if (!transport || !config.smtpFrom) throw new Error("SMTP_DISABLED");
  if (job.type === "auth_email") {
    if (Number(job.payload.expiresAt || 0) <= Date.now()) return;
    const url = String(job.payload.url || "");
    if (!url.startsWith(`${config.appUrl}/`)) throw new Error("INVALID_EMAIL_LINK");
    const reset = job.payload.template === "reset";
    await transport.sendMail({ from: config.smtpFrom, to: String(job.payload.to),
      ...authEmailCopy(config.appName,url,reset),
      messageId: `<${job.id}@${new URL(config.appUrl).hostname}>`,
    });
    return;
  }
  if (job.type === "notification_email") {
    const memberId = String(job.payload.memberId || job.payload.member_id || "");
    const result = await query(`SELECT u.email FROM "user" u JOIN members m ON m.id=u.id WHERE u.id=$1 AND u."emailVerified" AND m.status='ACTIVE'`, [memberId]);
    if (!result.rowCount) return;
    const category = String(job.payload.type || "service");
    if (category !== "service") {
      const preference = await query("SELECT 1 FROM notification_preferences WHERE member_id=$1 AND category=$2 AND email=true", [memberId, category]);
      if (!preference.rowCount) return;
    }
    await transport.sendMail({ from: config.smtpFrom, to: result.rows[0].email, ...notificationEmailCopy(config.appName,config.appUrl),
      messageId: `<${job.id}@${new URL(config.appUrl).hostname}>`,
    });
    return;
  }
  throw new Error("UNSUPPORTED_JOB_TYPE");
}
let maintenanceAt = 0;
console.log("Worker started with concurrency 1; payloads and credentials are never logged.");
try {
  while (!stopping) {
    await writeFile("/tmp/community-worker-heartbeat", String(Date.now()), { mode: 0o600 });
    if (stopping) break;
    if (Date.now() >= maintenanceAt) {
      try { await processMaintenance(); } catch { console.error("Maintenance failed; details redacted. Will retry."); }
      maintenanceAt = Date.now() + 60000;
      // Stale claims return to the durable queue after a worker crash.
      await query("UPDATE jobs SET status='PENDING',locked_at=NULL WHERE status='RUNNING' AND locked_at < now()-interval '10 minutes'");
      await query("UPDATE jobs SET payload='{}'::jsonb,status='CANCELLED' WHERE type='auth_email' AND status IN ('PENDING','FAILED') AND created_at < now()-interval '2 hours'");
    }
    if (stopping) break;
    const job = await transaction(async client => {
      const result = await client.query("SELECT * FROM jobs WHERE status='PENDING' AND run_at<=now() ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!result.rowCount) return null;
      await client.query("UPDATE jobs SET status='RUNNING',locked_at=now(),attempts=attempts+1 WHERE id=$1", [result.rows[0].id]);
      return { ...result.rows[0], attempts: result.rows[0].attempts + 1 };
    });
    if (stopping) {
      // A signal may arrive while the claim transaction is awaiting PostgreSQL.
      // Release only our still-running claim; concurrent cancellation stays terminal.
      if (job) await query("UPDATE jobs SET status='PENDING',locked_at=NULL,attempts=GREATEST(0,attempts-1) WHERE id=$1 AND status='RUNNING'", [job.id]);
      break;
    }
    if (!job) { await delay(config.workerPollMs); continue; }
    try {
      await deliver(job);
      await query("UPDATE jobs SET status='DONE',last_error=NULL,locked_at=NULL,payload='{}'::jsonb WHERE id=$1 AND status='RUNNING'", [job.id]);
    } catch (error) {
      const safeError = error instanceof Error && ["SMTP_DISABLED","INVALID_EMAIL_LINK","UNSUPPORTED_JOB_TYPE"].includes(error.message) ? error.message : "DELIVERY_FAILED";
      const exhausted = job.attempts >= config.workerMaxAttempts;
      await query("UPDATE jobs SET status=$2,locked_at=NULL,last_error=$3,run_at=now()+$4*interval '1 second' WHERE id=$1 AND status='RUNNING'", [job.id, exhausted ? "FAILED" : "PENDING", safeError, Math.min(3600, 30 * 2 ** job.attempts)]);
      console.error(`Job ${exhausted ? "failed" : "will retry"}; type=${job.type}; code=${safeError}`);
    }
  }
} catch { console.error("Worker stopped after an operational failure; details redacted."); process.exitCode = 1; }
finally { transport?.close(); await pool.end(); console.log("Worker stopped gracefully."); }
