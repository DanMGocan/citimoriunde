// Executes the checked-in worker with mocked filesystem, queue, domain and mail
// boundaries. No deployment configuration, PostgreSQL or SMTP is accessed.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), babel = require("@babel/core");
const root = path.resolve(__dirname, "..");
const source = babel.transformSync(fs.readFileSync(path.join(root, "scripts/worker.ts"), "utf8"), {
  filename: "scripts/worker.ts", configFile: false, babelrc: false,
  plugins: ["@babel/plugin-transform-typescript", "@babel/plugin-transform-modules-commonjs"],
}).code;

async function scenario(mode) {
  const listeners = new Map(), events = [], queries = [];
  let status = "PENDING", attempts = 0, claims = 0, sends = 0, closes = 0, ended = 0;
  const signal = () => listeners.get("SIGTERM")();
  const job = {
    id: "synthetic-job", type: "auth_email", attempts: 0,
    payload: { to: "reader@example.invalid", url: "https://community.example.invalid/api/auth/verify-email?token=synthetic", expiresAt: Date.now() + 3600000 },
  };
  const config = { appUrl: "https://community.example.invalid", appName: "Synthetic community", smtpFrom: "sender@example.invalid", workerPollMs: 1000, workerMaxAttempts: 5 };
  const client = { async query(sql) {
    queries.push(sql);
    if (sql.startsWith("SELECT * FROM jobs")) { claims++; events.push("claim"); return { rowCount: 1, rows: [{ ...job, attempts }] }; }
    if (sql.includes("attempts=attempts+1")) {
      status = "RUNNING"; attempts++; events.push("claim-updated");
      if (mode === "claim") signal();
      return { rowCount: 1, rows: [] };
    }
    throw new Error("Unexpected claim query");
  } };
  const db = {
    pool: { async end() { ended++; events.push("pool-ended"); } },
    async transaction(callback) {
      const claimed = await callback(client); events.push("claim-committed");
      if (mode === "cancelled") { status = "CANCELLED"; signal(); }
      return claimed;
    },
    async query(sql) {
      queries.push(sql);
      if (sql.includes("attempts=GREATEST(0,attempts-1)")) {
        assert.match(sql, /SET status='PENDING',locked_at=NULL,attempts=GREATEST\(0,attempts-1\)/);
        assert.match(sql, /WHERE id=\$1 AND status='RUNNING'/);
        events.push("release-attempt");
        if (status === "RUNNING") { status = "PENDING"; attempts = Math.max(0, attempts - 1); }
      } else if (sql.includes("status='DONE'")) {
        assert.equal(status, "RUNNING"); status = "DONE"; events.push("done");
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const transport = {
    async sendMail() { sends++; events.push("send-started"); signal(); await Promise.resolve(); events.push("send-finished"); },
    close() { closes++; events.push("transport-closed"); },
  };
  const mocks = {
    "node:fs/promises": { async writeFile() { events.push("heartbeat"); if (mode === "heartbeat") signal(); } },
    "node:timers/promises": { async setTimeout() { throw new Error("Unexpected idle poll"); } },
    "../src/lib/config": { config }, "../src/lib/db": db,
    "../src/domain/maintenance": {
      async processMaintenance() { events.push("maintenance"); if (mode === "maintenance") signal(); },
      async processDomainJob() { events.push("domain-delivery-check"); return false; },
    },
    "../src/lib/auth-copy": { authEmailCopy() { return { subject: "Synthetic", text: "Synthetic" }; }, notificationEmailCopy() { throw new Error("Unexpected notification"); } },
    "../src/lib/mail": { createMailTransport() { return transport; } },
  };
  const processMock = { exitCode: undefined, once(name, listener) { listeners.set(name, listener); } };
  const logs = [];
  await vm.runInNewContext(`(async () => {\n${source}\n})()`, {
    exports: {}, require(name) { assert.ok(Object.hasOwn(mocks, name)); return mocks[name]; },
    process: processMock, URL, console: { log(value) { logs.push(value); }, error(value) { logs.push(value); } },
  }, { filename: "scripts/worker.ts" });
  assert.equal(processMock.exitCode, undefined); assert.equal(closes, 1); assert.equal(ended, 1);
  assert.doesNotMatch(logs.join("\n"), /synthetic-job|reader@example.invalid|token=synthetic/);
  return { status, attempts, claims, sends, events, queries };
}
(async () => {
  let passed = 0;
  const heartbeat = await scenario("heartbeat");
  assert.equal(heartbeat.claims, 0); assert.equal(heartbeat.sends, 0); assert.ok(!heartbeat.events.includes("maintenance")); passed++;
  const maintenance = await scenario("maintenance");
  assert.equal(maintenance.claims, 0); assert.equal(maintenance.sends, 0); assert.equal(maintenance.status, "PENDING"); passed++;
  const claim = await scenario("claim");
  assert.equal(claim.claims, 1); assert.equal(claim.sends, 0); assert.equal(claim.status, "PENDING"); assert.equal(claim.attempts, 0);
  assert.ok(claim.events.includes("release-attempt")); assert.ok(!claim.events.includes("domain-delivery-check")); passed++;
  const cancelled = await scenario("cancelled");
  assert.equal(cancelled.claims, 1); assert.equal(cancelled.sends, 0); assert.equal(cancelled.status, "CANCELLED"); assert.equal(cancelled.attempts, 1);
  assert.ok(cancelled.events.includes("release-attempt")); passed++;
  const deliver = await scenario("deliver");
  assert.equal(deliver.sends, 1); assert.equal(deliver.status, "DONE"); assert.equal(deliver.attempts, 1);
  assert.ok(deliver.events.indexOf("send-finished") < deliver.events.indexOf("done"));
  assert.ok(deliver.events.indexOf("done") < deliver.events.indexOf("transport-closed"));
  assert.ok(deliver.events.indexOf("transport-closed") < deliver.events.indexOf("pool-ended"));
  assert.ok(!deliver.events.includes("release-attempt")); passed++;
  console.log(`${passed}/5 worker shutdown policy groups passed against actual source with mocked queue/mail/filesystem boundaries. No real worker, PostgreSQL or SMTP integration claimed.`);
})().catch(() => { console.error("Worker shutdown policy checks failed; details redacted."); process.exitCode = 1; });
