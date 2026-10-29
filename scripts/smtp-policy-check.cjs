// Reproducible source-level checks with a mocked Nodemailer boundary. This never
// imports the real environment, opens SMTP sockets, verifies a provider or sends mail.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), babel = require("@babel/core");
const root = path.resolve(__dirname, "..");
const settings = {
  mailMode: "smtp", smtpHost: "smtp.example.invalid", smtpPort: 587,
  smtpSecure: false, smtpRequireTls: true, smtpUser: "synthetic-user",
  smtpPassword: "synthetic-secret", smtpFrom: "Synthetic <sender@example.invalid>",
  smtpDnsTimeoutMs: 5000, smtpConnectTimeoutMs: 10000,
  smtpGreetingTimeoutMs: 10000, smtpSocketTimeoutMs: 15000,
};
function compile(file, mocks, context = {}, asynchronous = false) {
  const source = babel.transformSync(fs.readFileSync(path.join(root, file), "utf8"), {
    filename: file, configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-typescript", "@babel/plugin-transform-modules-commonjs"],
  }).code;
  const exports = {};
  const sandbox = { exports, require(name) {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error("Unexpected mock boundary: " + name);
  }, ...context };
  const result = vm.runInNewContext(asynchronous ? `(async () => {\n${source}\n})()` : source, sandbox, { filename: file });
  return asynchronous ? result : exports;
}
function fixture(config = settings, verification = async () => true) {
  const calls = { options: [], verifies: 0, sends: 0, closes: 0 };
  const transport = {
    async verify() { calls.verifies++; return verification(); },
    sendMail() { calls.sends++; throw new Error("A diagnostic must never send mail"); },
    close() { calls.closes++; },
  };
  const nodemailer = { createTransport(options) { calls.options.push(options); return transport; } };
  const mail = compile("src/lib/mail.ts", { nodemailer, "./config": { config } });
  return { mail, calls };
}
async function diagnostic(config, behavior = "success") {
  const logs = [], listeners = new Map(), processMock = {
    exitCode: undefined,
    once(signal, listener) { listeners.set(signal, listener); },
    removeListener(signal, listener) { if (listeners.get(signal) === listener) listeners.delete(signal); },
  };
  const { mail, calls } = fixture(config, async () => {
    if (behavior === "failure") throw new Error("synthetic-secret synthetic-user private-provider-details");
    if (behavior === "interrupt") listeners.get("SIGTERM")();
    return true;
  });
  await compile("scripts/smtp-check.ts", {
    "../src/lib/config": { config }, "../src/lib/mail": mail,
  }, { process: processMock, console: { log: value => logs.push(value), error: value => logs.push(value) } }, true);
  return { calls, code: processMock.exitCode, logs: logs.join("\n"), listeners };
}
(async () => {
  let passed = 0;
  const { mail, calls } = fixture();
  for (const disabled of [{ mailMode: "off" }, { smtpHost: "" }, { smtpFrom: "" }]) {
    assert.equal(mail.createMailTransport({ ...settings, ...disabled }), null);
  }
  assert.equal(calls.options.length, 0); passed++;
  assert.throws(() => mail.smtpTransportOptions({ ...settings, smtpRequireTls: false }), /SMTP_TLS_REQUIRED/); passed++;
  for (const incomplete of [{ smtpUser: "" }, { smtpPassword: "" }]) {
    assert.throws(() => mail.smtpTransportOptions({ ...settings, ...incomplete }), /SMTP_AUTH_INCOMPLETE/);
  }
  passed++;
  const options = mail.smtpTransportOptions(settings);
  assert.equal(options.secure, false); assert.equal(options.requireTLS, true);
  assert.equal(options.ignoreTLS, false); assert.equal(options.opportunisticTLS, false); passed++;
  assert.equal(options.tls.minVersion, "TLSv1.2"); assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.tls.servername, settings.smtpHost); passed++;
  assert.equal(options.dnsTimeout, 5000); assert.equal(options.connectionTimeout, 10000);
  assert.equal(options.greetingTimeout, 10000); assert.equal(options.socketTimeout, 15000);
  const tuned = mail.smtpTransportOptions({ ...settings, smtpDnsTimeoutMs: 501, smtpConnectTimeoutMs: 502, smtpGreetingTimeoutMs: 503, smtpSocketTimeoutMs: 504 });
  assert.deepEqual([tuned.dnsTimeout, tuned.connectionTimeout, tuned.greetingTimeout, tuned.socketTimeout], [501, 502, 503, 504]); passed++;
  assert.equal(options.logger, false); assert.equal(options.debug, false); assert.equal(options.transactionLog, false);
  assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true); assert.equal(options.maxRecipients, 1);
  assert.equal(options.forceAuth, true); passed++;
  mail.createMailTransport(settings);
  assert.equal(calls.options[0].pool, true); assert.equal(calls.options[0].maxConnections, 1); assert.equal(calls.options[0].maxMessages, 20); passed++;
  mail.createMailTransport(settings, false); assert.equal(calls.options[1].pool, undefined); passed++;
  const success = await diagnostic(settings);
  assert.equal(success.code, undefined); assert.equal(success.calls.verifies, 1); assert.equal(success.calls.sends, 0);
  assert.equal(success.calls.closes, 1); assert.equal(success.calls.options[0].pool, undefined);
  assert.match(success.logs, /No email was sent/); assert.match(success.logs, /remain unverified/); assert.equal(success.listeners.size, 0); passed++;
  const failure = await diagnostic(settings, "failure");
  assert.equal(failure.code, 1); assert.equal(failure.calls.sends, 0); assert.equal(failure.calls.closes, 1);
  assert.doesNotMatch(failure.logs, /synthetic-secret|synthetic-user|private-provider-details/); passed++;
  const disabled = await diagnostic({ ...settings, mailMode: "off" });
  assert.equal(disabled.code, 1); assert.equal(disabled.calls.verifies, 0); assert.equal(disabled.calls.sends, 0); passed++;
  const interrupted = await diagnostic(settings, "interrupt");
  assert.equal(interrupted.code, 130); assert.equal(interrupted.calls.sends, 0);
  assert.equal(interrupted.calls.closes, 2); assert.equal(interrupted.listeners.size, 0);
  assert.doesNotMatch(interrupted.logs, /verification passed/); passed++;
  console.log(`${passed}/13 SMTP policy groups passed against actual source with a mocked Nodemailer boundary. No real provider verification or email delivery claimed.`);
})().catch(() => { console.error("SMTP policy checks failed; details redacted."); process.exitCode = 1; });
