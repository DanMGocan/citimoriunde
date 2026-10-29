import { spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../src/lib/config";
import { walkImagesArchive } from "../src/lib/restore-archive";
import { postgresCliConnection } from "./postgres-cli";
import { fingerprintRecords, fingerprintImages } from "./restore-records";

const isolatedDatabaseName = /^restore_test_[a-f0-9]{20}$/;

function run(command: string, args: string[], options: { input?: Readable | string; capture?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<string>((done, fail) => {
    const child = spawn(command, args, { stdio: [options.input ? "pipe" : "ignore", options.capture ? "pipe" : "ignore", "ignore"], ...(options.env ? { env: options.env } : {}) });
    const parts: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    const reject = () => { if (!failed) { failed = true; child.kill("SIGTERM"); fail(new Error(`${command} failed or is unavailable; details redacted.`)); } };
    child.once("error", reject);
    if (options.capture) child.stdout!.on("data", (part: Buffer) => {
      bytes += part.length;
      if (bytes > 1024 * 1024) reject();
      else parts.push(part);
    });
    if (typeof options.input === "string") { child.stdin!.once("error", reject); child.stdin!.end(options.input); }
    else if (options.input) void pipeline(options.input, child.stdin!).catch(reject);
    child.once("close", code => {
      if (failed) return;
      if (code !== 0) reject();
      else done(Buffer.concat(parts).toString("utf8").trim());
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const compose = argv.includes("--compose");
  const paths = argv.filter(value => value !== "--compose");
  if (paths.length !== 1 || argv.filter(value => value === "--compose").length > 1 || paths[0]!.startsWith("-")) {
    throw new Error("Usage: npx tsx scripts/restore-test.ts /absolute/path/to/backup [--compose]");
  }
  const backup = resolve(paths[0]!);
  const manifestHandle = await open(resolve(backup, "manifest.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  let dump: FileHandle | undefined;
  let images: FileHandle | undefined;
  let temporary = "";
  let created = false;
  let nativeManagement: import("pg").Pool | undefined;
  let nativeRestored: import("pg").Pool | undefined;
  const db = new URL(config.databaseUrl);
  let dbName: string;
  do { dbName = `restore_test_${randomBytes(10).toString("hex")}`; } while (dbName === decodeURIComponent(db.pathname.slice(1)) || dbName === config.postgresDb);
  if (!isolatedDatabaseName.test(dbName)) throw new Error("Invalid isolated restore target.");
  const connection = postgresCliConnection(config.databaseUrl, dbName);
  const nativeEnv: NodeJS.ProcessEnv = { NODE_ENV: config.environment, PATH: config.systemPath, PGPASSWORD: connection.password };
  // Only generated database identifiers enter these fixed scripts/SQL. The source
  // database and passwords stay in the database container's existing environment.
  const composePsql = (target: string, sql: string) => run("docker", ["compose", "exec", "-T", "database", "sh", "-c", 'test "$1" != "$POSTGRES_DB" || exit 64; PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"', "restore-drill", target], { input: sql, capture: true });
  const composeManagement = (sql: string) => run("docker", ["compose", "exec", "-T", "database", "sh", "-c", 'test "$1" != "$POSTGRES_DB" || exit 64; PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"', "restore-drill", dbName], { input: sql });
  try {
    const info = await manifestHandle.stat();
    if (!info.isFile() || info.size > 16384) throw new Error("Invalid backup manifest.");
    const manifest = JSON.parse(await manifestHandle.readFile("utf8"));
    if (manifest.format !== 1 || manifest.containsPersonalData !== true || !manifest.hashes || typeof manifest.hashes !== "object") throw new Error("Unsupported backup manifest.");
    dump = await open(resolve(backup, "database.dump"), constants.O_RDONLY | constants.O_NOFOLLOW);
    images = await open(resolve(backup, "images.tar.gz"), constants.O_RDONLY | constants.O_NOFOLLOW);
    for (const [name, handle] of [["database.dump", dump], ["images.tar.gz", images]] as const) {
      if (!(await handle.stat()).isFile() || !/^[a-f0-9]{64}$/.test(manifest.hashes[name] ?? "")) throw new Error("Invalid backup file or checksum.");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream("", { fd: handle.fd, start: 0, autoClose: false })) hash.update(chunk);
      if (hash.digest("hex") !== manifest.hashes[name]) throw new Error("Backup checksum mismatch; no database restore attempted.");
    }
    const archive = await walkImagesArchive(images);
    temporary = await mkdtemp("/tmp/community-restore-");
    const imageTarget = resolve(temporary, "images");
    await mkdir(imageTarget, { mode: 0o700 });
    await walkImagesArchive(images, (name, body) => writeFile(resolve(imageTarget, name), body, { mode: 0o600, flag: "wx" }));
    if (!compose) {
      const { Pool } = await import("pg");
      nativeManagement = new Pool({ connectionString: config.databaseUrl, max: 1 });
    }
    // Cleanup is allowed only after CREATE DATABASE succeeds. A failed creation
    // must never cause deletion of a coincidentally existing database.
    if (compose) {
      await composeManagement(`CREATE DATABASE "${dbName}";`);
      created = true;
      await run("docker", ["compose", "exec", "-T", "database", "sh", "-c", 'test "$1" != "$POSTGRES_DB" || exit 64; PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-acl --exit-on-error', "restore-drill", dbName], { input: createReadStream("", { fd: dump.fd, start: 0, autoClose: false }) });
    } else {
      await nativeManagement!.query(`CREATE DATABASE "${dbName}"`);
      created = true;
      await run("pg_restore", [...connection.args, "--no-owner", "--no-acl", "--exit-on-error"], { env: nativeEnv, input: createReadStream("", { fd: dump.fd, start: 0, autoClose: false }) });
      const { Pool } = await import("pg");
      const targetUrl = new URL(config.databaseUrl);
      targetUrl.pathname = `/${dbName}`;
      nativeRestored = new Pool({ connectionString: targetUrl.href, max: 1 });
    }
    async function jsonQuery(sql: string): Promise<unknown> {
      if (compose) return JSON.parse(await composePsql(dbName, sql));
      return (await nativeRestored!.query<{ value: unknown }>(sql)).rows[0]!.value;
    }
    const counts = await jsonQuery(`SELECT json_build_object('libraries',(SELECT count(*) FROM libraries),'copies',(SELECT count(*) FROM copies),'loans',(SELECT count(*) FROM loans),'migrations',(SELECT count(*) FROM schema_migrations),'photos',(SELECT count(*) FROM copy_photos),'invalidReturns',(SELECT count(*) FROM loans WHERE state='RETURNED' AND (return_actor IS NULL OR return_actor<>lender_id OR returned_at IS NULL)),'invalidHandovers',(SELECT count(*) FROM loans WHERE state IN ('ON_LOAN','RETURN_PENDING','RETURNED','DONATED') AND (handed_over_at IS NULL OR handover_actor IS DISTINCT FROM lender_id OR due_at IS NULL))) AS value;`) as Record<string, number>;
    if (!counts || !["libraries", "copies", "loans", "migrations", "photos", "invalidReturns", "invalidHandovers"].every(key => Number.isSafeInteger(counts[key]) && counts[key]! >= 0) || !counts.migrations || counts.invalidReturns || counts.invalidHandovers) throw new Error("Restored schema/lifecycle invariants failed.");
    let photoRecordsVerified = 0;
    let after = "";
    for (;;) {
      // Bounded keyset pagination; the cursor is a validated hex storage key.
      const photos = await jsonQuery(`SELECT COALESCE(json_agg(row_to_json(photo)), '[]'::json) AS value FROM (SELECT storage_key AS "storageKey",bytes::text AS bytes FROM copy_photos WHERE storage_key>'${after}' ORDER BY storage_key LIMIT 100) photo;`) as { storageKey: string; bytes: string }[];
      if (!Array.isArray(photos) || photos.length > 100) throw new Error("Invalid restored photo results.");
      if (!photos.length) break;
      for (const photo of photos) {
        if (!/^[a-f0-9]{32}$/.test(photo.storageKey) || photo.storageKey <= after || !/^\d+$/.test(photo.bytes)) throw new Error("Invalid restored storage record.");
        let bytes = 0;
        for (const width of [320, 640, 1200]) bytes += (await stat(resolve(imageTarget, `${photo.storageKey}-${width}.webp`))).size;
        if (!Number.isSafeInteger(Number(photo.bytes)) || bytes !== Number(photo.bytes)) throw new Error("Restored photo byte count mismatch.");
        after = photo.storageKey;
        photoRecordsVerified++;
      }
    }
    if (photoRecordsVerified !== counts.photos) throw new Error("Restored photo record count mismatch.");
    // Only the isolated harness needs exact synthetic-row/file comparison.
    // Production drills continue to return counts and invariant checks.
    const testFingerprints = config.environment === "test" ? { recordsSha256: await fingerprintRecords(jsonQuery), imagesSha256: await fingerprintImages(imageTarget) } : undefined;
    return { restoredToIsolatedDatabase: true, mode: compose ? "compose-private-database" : "native", counts: { libraries: counts.libraries, copies: counts.copies, loans: counts.loans, migrations: counts.migrations }, photoRecordsVerified, archiveFilesValidated: archive.files, imagesRestoredSeparately: true, sourceDatabaseUntouched: true, ...(testFingerprints ? { testFingerprints } : {}) };
  } finally {
    let cleanupFailed = false;
    try { await nativeRestored?.end(); } catch { cleanupFailed = true; }
    if (created) {
      try {
        if (compose) await composeManagement(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
        else await nativeManagement!.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      } catch { cleanupFailed = true; console.error(`Isolated restore database cleanup failed: ${dbName}. Production was not a restore/drop target.`); }
    }
    try { await nativeManagement?.end(); } catch { cleanupFailed = true; }
    await Promise.allSettled([manifestHandle.close(), dump?.close(), images?.close()]);
    if (temporary) {
      try { await rm(temporary, { recursive: true, force: true }); }
      catch { cleanupFailed = true; console.error(`Protected temporary restore files need operator cleanup: ${temporary}.`); }
    }
    if (cleanupFailed) throw new Error("Isolated restore cleanup did not complete.");
  }
}

void main().then(result => console.log(JSON.stringify(result))).catch(() => {
  console.error("Restore verification failed; no success recorded. The source database was never a restore/drop target.");
  process.exitCode = 1;
});
