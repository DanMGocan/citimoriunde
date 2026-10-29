import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pool } from "../src/lib/db";
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(73142619)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const files = (await readdir(resolve("migrations"))).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  for (const name of files) {
    const sql = await readFile(resolve("migrations", name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query("SELECT checksum FROM schema_migrations WHERE name=$1", [name]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration checksum changed: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try { await client.query(sql.replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "")); await client.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [name, checksum]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    console.log(`Applied ${name}`);
  }
} finally { await client.query("SELECT pg_advisory_unlock(73142619)").catch(() => {}); client.release(); await pool.end(); }
