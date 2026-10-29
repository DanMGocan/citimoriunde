import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { config, isolatedTestEnvironment } from "../src/lib/config";
// Only a dedicated pre-existing test maintenance database may bootstrap the disposable target.
// A production DATABASE_URL is never used by this runner, even for migration/fixture setup.
if (!config.testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required and must point to a dedicated private *_test database. No integration tests ran.");
let base: URL;
try { base = new URL(config.testDatabaseUrl); } catch { throw new Error("Invalid TEST_DATABASE_URL; no database was touched."); }
if (!["postgres:","postgresql:"].includes(base.protocol) || !/^[a-z0-9_]+_test$/.test(decodeURIComponent(base.pathname.slice(1)))) throw new Error("Refusing TEST_DATABASE_URL without an explicit *_test database name. No database was touched.");
const { Pool } = await import("pg");
const maintenance = new Pool({ connectionString: base.href, max: 1, connectionTimeoutMillis: 5000 });
const databaseName = `community_${randomBytes(10).toString("hex")}_test`;
const target = new URL(base.href); target.pathname = `/${databaseName}`;
const temp = await mkdtemp(join(tmpdir(), "community-tests-"));
const images = join(temp,"images"), backups = join(temp,"backups");
await mkdir(images,{mode:0o700}); await mkdir(backups,{mode:0o700});
const env = isolatedTestEnvironment(target.href, images, backups, randomBytes(48).toString("base64url"));
let created = false;
function child(args: string[]) {
  return new Promise<number>((done, fail) => {
    const runner = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), ...args], { cwd: resolve("."), env, stdio: "inherit" });
    runner.once("error", () => fail(new Error("Test subprocess could not start; details redacted.")));
    runner.once("close", code => done(code ?? 1));
  });
}
try {
  await maintenance.query(`CREATE DATABASE "${databaseName}"`); created = true;
  const migrated = await child(["scripts/migrate.ts"]);
  if (migrated !== 0) throw new Error("Isolated test migrations failed; tests did not run.");
  if(process.argv.includes('--load')){process.exitCode=await child(['scripts/load-test.ts']);}
  else if(process.argv.includes('--restore')){process.exitCode=await child(['scripts/test-restore-roundtrip.ts']);}
  else if(process.argv.includes('--browser')){
    // Repeated fixture logins share one local IP. Production/default throttling
    // is exercised by the integration suite; keep UI journeys within a test-only
    // budget without changing deployment settings or waiting out rate windows.
    env.AUTH_RATE_LIMIT='100';
    if(await child(['scripts/browser-setup.ts'])!==0)throw new Error('Browser fixtures failed.');
    // Build once, before starting the one browser worker. Production rendering is
    // used against APP_ENV=test and the disposable database, never deployment data.
    env.NODE_ENV='production';env.NODE_OPTIONS='--max-old-space-size=1536';
    if(await child(['scripts/build.ts'])!==0)throw new Error('Browser production build failed.');
    Object.assign(env,JSON.parse(await readFile(join(temp,'browser-fixtures.json'),'utf8')));
    env.NODE_OPTIONS='--max-old-space-size=512';
    process.exitCode=await child(['node_modules/@playwright/test/cli.js','test','--workers=1',...process.argv.slice(2).filter(argument=>argument!=='--browser')]);
  }
  else {
  // A merge barrier, merge transaction and two concurrent submissions need four
  // connections. With a two-connection pool the observer could wait behind the
  // very transaction it must release. Browser/load subprocesses retain pool2.
  env.DB_POOL_MAX="4";
  const suites = (await readdir(resolve("tests/integration"))).filter(name => name.endsWith(".test.ts")).sort().map(name => `tests/integration/${name}`);
  if (!suites.length) throw new Error("No integration test suites found; no success recorded.");
  process.exitCode = await child(["--test", "--test-concurrency=1", ...suites]);
  }
} catch {
  console.error("Isolated integration test setup or execution failed; source and production databases were not migrated or truncated.");
  process.exitCode = 1;
} finally {
  if (created) {
    try { await maintenance.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
    catch { console.error("Disposable test database cleanup failed; ask the operator to remove only the created community_*_test database. Details redacted."); process.exitCode = 1; }
  }
  await maintenance.end();
  await rm(temp,{recursive:true,force:true});
}
