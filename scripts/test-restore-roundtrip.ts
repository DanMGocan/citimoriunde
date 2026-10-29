import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { config, isolatedTestEnvironment } from "../src/lib/config";
import { query } from "../src/lib/db";
import { addCopy } from "../src/domain/catalogue";
import { uploadPhoto } from "../src/domain/images";
import { requestLoan, decideRequest, transitionLoan } from "../src/domain/loans";
import { assertIsolatedDatabase, fixtureMember, fixtureLibrary, closeTestPool } from "../tests/integration/helpers";
import { fingerprintRecords, fingerprintImages } from "./restore-records";

assertIsolatedDatabase();
const target = new URL(config.databaseUrl);
if (!/^community_[a-f0-9]{20}_test$/.test(target.pathname.slice(1)) || config.backupPath !== join(config.storagePath, "..", "backups")) {
  throw new Error("Restore roundtrip requires the disposable database and temporary directories created by test-db.ts.");
}
const env = isolatedTestEnvironment(config.databaseUrl, config.storagePath, config.backupPath, config.authSecret);

function script(name: string, args: string[] = []) {
  return new Promise<string>((done, fail) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), name, ...args], { cwd: resolve("."), env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    const reject = () => {
      if (!failed) { failed = true; child.kill("SIGTERM"); fail(new Error(`Isolated ${name} failed; details redacted.`)); }
    };
    child.once("error", reject);
    child.stdout.on("data", (part: Buffer) => {
      bytes += part.length;
      if (bytes > 1024 * 1024) reject();
      else stdout.push(part);
    });
    child.stderr.on("data", (part: Buffer) => {
      bytes += part.length;
      if (bytes > 1024 * 1024) reject();
    });
    child.once("close", code => {
      if (failed) return;
      if (code !== 0) reject();
      else done(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}

async function run() {
  let fixturePoolClosed = false;
  let observer: Pool | undefined;
  try {
    const library = await fixtureLibrary();
    const owner = await fixtureMember(), borrower = await fixtureMember();
    const copy = await addCopy(owner, { libraryId: library, title: "Carte sintetică pentru verificarea restaurării", authors: ["Autor sintetic"], language: "ro", visibility: "PUBLIC", condition: "good", unspecified: true });
    const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#224e44" } }).jpeg().toBuffer();
    await uploadPhoto(owner, copy.id, image);
    const request = await requestLoan(borrower, { copyId: copy.id });
    const accepted = await decideRequest(owner, { id: request.id, durationDays: 14 }, "ACCEPTED");
    assert.ok(accepted.loanId);
    await transitionLoan(owner, { id: accepted.loanId }, "handover");
    await transitionLoan(borrower, { id: accepted.loanId }, "acknowledge");
    await transitionLoan(borrower, { id: accepted.loanId }, "return");
    await transitionLoan(owner, { id: accepted.loanId }, "receive");
    const loan = (await query("SELECT state,handover_actor,return_actor,handed_over_at,returned_at FROM loans WHERE id=$1", [accepted.loanId])).rows[0];
    assert.equal(loan.state, "RETURNED");
    assert.equal(loan.handover_actor, owner.id);
    assert.equal(loan.return_actor, owner.id);
    assert.ok(loan.handed_over_at && loan.returned_at);
    const originalRecords = await fingerprintRecords(async sql => (await query<{ value: unknown }>(sql)).rows[0]!.value);
    const originalImages = await fingerprintImages(config.storagePath);
    const migrations = (await query<{ count: number }>("SELECT count(*)::int AS count FROM schema_migrations")).rows[0]!.count;
    assert.ok(migrations > 0);
    // All fixture transactions are finished and their connections are closed.
    // No server or worker runs against this database during either subprocess.
    await closeTestPool(); fixturePoolClosed = true;

    observer = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
    const restoreDatabases = async () => (await observer!.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname ~ '^restore_test_[a-f0-9]{20}$' ORDER BY datname")).rows.map(row => row.datname);
    const beforeDatabases = await restoreDatabases();
    await script("scripts/backup.ts");
    const backups = await readdir(config.backupPath, { withFileTypes: true });
    assert.equal(backups.length, 1);
    assert.ok(backups[0]!.isDirectory());
    const restored = JSON.parse(await script("scripts/restore-test.ts", [join(config.backupPath, backups[0]!.name)]));
    assert.equal(restored.restoredToIsolatedDatabase, true);
    assert.equal(restored.mode, "native");
    assert.deepEqual(restored.counts, { libraries: 1, copies: 1, loans: 1, migrations });
    assert.equal(restored.photoRecordsVerified, 1);
    assert.equal(restored.archiveFilesValidated, 3);
    assert.equal(restored.imagesRestoredSeparately, true);
    assert.deepEqual(restored.testFingerprints, { recordsSha256: originalRecords, imagesSha256: originalImages });
    assert.equal(await fingerprintRecords(async sql => (await observer!.query<{ value: unknown }>(sql)).rows[0]!.value), originalRecords);
    assert.equal(await fingerprintImages(config.storagePath), originalImages);
    assert.deepEqual(await restoreDatabases(), beforeDatabases);
    const report = {
      recordedAt: new Date().toISOString(), mode: "native-isolated-roundtrip", sourceDatabaseIsDisposable: true,
      restoredRecordsMatchExactly: true, restoredImageBytesMatchExactly: true, sourceRecordsAndImagesUnchanged: true,
      generatedRestoreDatabaseCleanedUp: true, counts: restored.counts, photoRecordsVerified: 1, imageVariantsVerified: 3,
      externalServices: false, limitations: "Synthetic local database/image recovery only; no production recovery, offsite delivery or operator recovery-time objective is established.",
    };
    await mkdir("test-results", { recursive: true });
    await writeFile("test-results/restore-test.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await observer?.end();
    if (!fixturePoolClosed) await closeTestPool();
  }
}

void run().catch(() => {
  console.error("Isolated backup/restore roundtrip failed; no success recorded. Source and production databases were not restore/drop targets.");
  process.exitCode = 1;
});
