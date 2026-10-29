import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

// Test-only exact comparison across the fixture graph; bounded pages also work
// through the fixed SQL/JSON bridge used by the restore verifier.
const tables = ["schema_migrations", "libraries", "works", "editions", "copies", "loans", "copy_photos", "loan_events", "ownership_history", "xp_ledger"] as const;
export async function fingerprintRecords(read: (sql: string) => Promise<unknown>) {
  const hash = createHash("sha256");
  for (const table of tables) {
    const column = table === "schema_migrations" ? "name" : "id";
    let after = "";
    for (;;) {
      const rows = await read(`SELECT COALESCE(json_agg(record), '[]'::json) AS value FROM (SELECT ${column}::text AS key,to_jsonb(t)::text AS data FROM ${table} t WHERE ${column}::text COLLATE "C">'${after}' ORDER BY ${column}::text COLLATE "C" LIMIT 100) record;`);
      if (!Array.isArray(rows) || rows.length > 100) throw new Error("Invalid restore fingerprint page.");
      if (!rows.length) break;
      for (const row of rows) {
        if (!row || typeof row.key !== "string" || !/^[a-z0-9_.-]+$/.test(row.key) || row.key <= after || typeof row.data !== "string") throw new Error("Invalid restore fingerprint record.");
        hash.update(`${table}\0${row.key}\0${row.data}\0`);
        after = row.key;
      }
    }
  }
  return hash.digest("hex");
}

export async function fingerprintImages(directory: string) {
  const hash = createHash("sha256");
  for (const name of (await readdir(directory)).sort()) {
    if (!/^[a-f0-9]{32}-(?:320|640|1200)\.webp$/.test(name)) throw new Error("Unexpected isolated image file.");
    const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 1 || info.size > 16 * 1024 * 1024) throw new Error("Invalid isolated image variant.");
      hash.update(`${name}\0`);
      hash.update(await file.readFile());
      hash.update("\0");
    } finally { await file.close(); }
  }
  return hash.digest("hex");
}
