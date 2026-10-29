import { safeEffectiveConfig } from "../src/lib/config";
import { pool } from "../src/lib/db";
import { launchReadiness } from "../src/domain/readiness";
try {
  const readiness = await launchReadiness();
  console.log(JSON.stringify({ applicationRuns: true, ...readiness, safeConfiguration: safeEffectiveConfig() }, null, 2));
  if (!readiness.readyForPublicLaunch) process.exitCode = 2;
} catch { console.error("Application/database readiness failed; details redacted."); process.exitCode = 1; }
finally { await pool.end(); }
