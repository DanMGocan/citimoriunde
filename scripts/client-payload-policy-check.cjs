// Source-level client request checks. React, UI copy and fetch are explicit mocks;
// no browser, server, deployment configuration or external network is accessed.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), babel = require("@babel/core");
const root = path.resolve(__dirname, "..");
const source = babel.transformSync(fs.readFileSync(path.join(root, "src/components/api.ts"), "utf8"), {
  filename: "src/components/api.ts", configFile: false, babelrc: false,
  plugins: ["@babel/plugin-transform-typescript", "@babel/plugin-transform-modules-commonjs"],
}).code;
const exportsMock = {}, requests = [];
const react = Object.fromEntries(["useCallback", "useEffect", "useState", "useRef"].map(name => [name, () => { throw new Error("A payload check must not render React"); }]));
vm.runInNewContext(source, {
  exports: exportsMock,
  require(name) {
    if (name === "react") return react;
    if (name === "./ui-copy") return { uiText: { seb6804c4ed: "Synthetic error", s09a8fc2740: "Synthetic error" } };
    throw new Error("Unexpected client mock boundary");
  },
  URLSearchParams,
  async fetch(url, options) {
    assert.equal(url, "/api/domain");
    requests.push({ url, options, payload: JSON.parse(options.body) });
    return { ok: true, async json() { return { ok: true }; } };
  },
}, { filename: "src/components/api.ts" });
async function payload(op, supplied) {
  const before = JSON.stringify(supplied);
  const frozen = Object.freeze(supplied);
  await exportsMock.act(op, frozen);
  assert.equal(JSON.stringify(supplied), before, "act must not mutate form input");
  return requests.at(-1).payload;
}
(async () => {
  let passed = 0;
  const distinct = await payload("catalogue.addCopy", { kind: "volume", volumeKey: "Partea I", volume: "Ediție în trei volume", title: "Synthetic", authors: Object.freeze(["Synthetic Author"]) });
  assert.equal(distinct.volumeKey, "Partea I"); assert.equal(distinct.volume, "Ediție în trei volume");
  assert.equal(distinct.op, "catalogue.addCopy");
  assert.equal(requests.at(-1).options.method, "POST"); assert.equal(requests.at(-1).options.credentials, "same-origin");
  assert.equal(requests.at(-1).options.headers["Content-Type"], "application/json"); passed++;

  const workOnly = await payload("catalogue.addCopy", { volumeKey: "1" });
  assert.equal(workOnly.volumeKey, "1"); assert.ok(!Object.hasOwn(workOnly, "volume"));
  const editionOnly = await payload("catalogue.addCopy", { volume: "2" });
  assert.equal(editionOnly.volume, "2"); assert.ok(!Object.hasOwn(editionOnly, "volumeKey")); passed++;

  const numeric = await payload("catalogue.addCopy", { year: "2020", maxDays: "42", volumeKey: "1", volume: "2" });
  assert.equal(numeric.year, 2020); assert.equal(numeric.maxDays, 42);
  assert.equal(numeric.volumeKey, "1"); assert.equal(numeric.volume, "2"); passed++;

  const defaults = await payload("catalogue.addCopy", { year: "", maxDays: "", volumeKey: "", volume: "", notes: "", collectionNote: "" });
  for (const optional of ["year", "maxDays", "volumeKey", "volume"]) assert.ok(!Object.hasOwn(defaults, optional));
  assert.equal(defaults.notes, ""); assert.equal(defaults.collectionNote, ""); passed++;

  const review = await payload("review.book", { workId: "synthetic-work", editionId: null, rating: "4", body: "Synthetic review" });
  assert.ok(Object.hasOwn(review, "editionId")); assert.equal(review.editionId, null);
  assert.equal(review.workId, "synthetic-work"); assert.equal(review.rating, "4"); passed++;

  const loan = await payload("loan.accept", { days: "35", requestId: "synthetic-request" });
  assert.equal(loan.durationDays, 35); assert.ok(!Object.hasOwn(loan, "days")); passed++;

  const goal = await payload("goal.set", { year: "2026", target: "12" });
  assert.equal(goal.goalYear, 2026); assert.equal(goal.target, 12); assert.ok(!Object.hasOwn(goal, "year"));
  const photo = await payload("photo.delete", { photoId: "synthetic-photo" });
  assert.equal(photo.id, "synthetic-photo"); assert.ok(!Object.hasOwn(photo, "photoId"));
  const response = await payload("review.respond", { reviewId: "synthetic-review", body: "Synthetic response" });
  assert.equal(response.id, "synthetic-review"); assert.ok(!Object.hasOwn(response, "reviewId")); passed++;

  console.log(`${passed}/7 client payload policy groups passed against actual source with mocked React/UI/fetch boundaries. No real browser or backend integration claimed.`);
})().catch(() => { console.error("Client payload policy checks failed; details redacted."); process.exitCode = 1; });
