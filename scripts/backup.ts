import { spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { config } from "../src/lib/config";
import { postgresCliConnection } from "./postgres-cli";
if (config.storageDriver !== "local") throw new Error("S3 requires an operator-managed bucket backup; this local script refuses an incomplete backup.");
const compose = process.argv.includes("--compose");
const backupId = new Date().toISOString().replace(/[:.]/g, "-");
const path = resolve(config.backupPath, backupId);
await mkdir(path, { recursive: true, mode: 0o700 });
function run(command: string, args: string[], output?: string, env?: NodeJS.ProcessEnv) {
  return new Promise<void>((done, fail) => {
    const process = spawn(command, args, { stdio: ["ignore", output ? "pipe" : "ignore", "ignore"], ...(env ? { env } : {}) });
    let closed = false;
    let finished = !output;
    const complete = () => { if (closed && finished) done(); };
    if (output) {
      const stream = createWriteStream(output, { mode: 0o600 });
      stream.once("finish", () => { finished = true; complete(); });
      stream.once("error", () => { process.kill("SIGTERM"); fail(new Error("Backup file write failed; details redacted.")); });
      process.stdout!.pipe(stream);
    }
    process.on("error", () => fail(new Error(`${command} is unavailable; no backup success was recorded.`)));
    process.on("close", code => { if (code !== 0) fail(new Error(`${command} failed; details redacted.`)); else { closed = true; complete(); } });
  });
}
let stopped = false;
try {
  if (compose) {
    await run("docker", ["compose", "stop", "web", "worker"]); stopped = true;
    await run("docker", ["compose", "exec", "-T", "database", "sh", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl'], resolve(path, "database.dump"));
    await run("docker", ["compose", "run", "--rm", "--no-deps", "--entrypoint", "tar", "web", "-C", "/app/storage/images", "-czf", "-", "."], resolve(path, "images.tar.gz"));
  } else {
    const db = postgresCliConnection(config.databaseUrl);
    await run("pg_dump", [...db.args, "-Fc", "--no-owner", "--no-acl"], resolve(path, "database.dump"), { NODE_ENV: config.environment, PATH: config.systemPath, PGPASSWORD: db.password });
    await run("tar", ["-C", config.storagePath, "-czf", resolve(path, "images.tar.gz"), "."]);
  }
  const hashes: Record<string,string> = {};
  for (const file of ["database.dump", "images.tar.gz"]) { await chmod(resolve(path,file), 0o600); const hash = createHash("sha256"); for await (const chunk of createReadStream(resolve(path,file))) hash.update(chunk); hashes[file] = hash.digest("hex"); }
  await writeFile(resolve(path, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), format: 1, hashes, consistency: compose ? "web-and-worker-stopped" : "operator-must-pause-writes", containsPersonalData: true }, null, 2), { mode: 0o600 });
  if (config.backupOffsiteDestination) {
    // rsync uses argv, no shell interpolation; SSH setup remains under operator control.
    if (/^[-\s]/.test(config.backupOffsiteDestination)) throw new Error("Invalid offsite destination.");
    await run("rsync", ["-a", "--protect-args", "--", `${path}/`, `${config.backupOffsiteDestination.replace(/\/$/, "")}/${backupId}/`]);
  }
  console.log(`Backup created at ${path}${config.backupOffsiteDestination ? "; offsite copy completed" : "; configure offsite destination before launch"}.`);
} catch (error) { console.error(error instanceof Error ? error.message : "Backup failed."); process.exitCode = 1; }
finally { if (stopped) await run("docker", ["compose", "start", "web", "worker"]); }
