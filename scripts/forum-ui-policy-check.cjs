// Reproducible source-level checks using system Babel (as in source-contracts.cjs).
// Executes the actual move service and form/API transforms with explicit mocks.
// No React rendering, real PostgreSQL, authentication service or network is used.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), parser = require('@babel/parser');
const traverse = require('@babel/traverse').default, babel = require('@babel/core');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parse = source => parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
const transpile = source => babel.transformSync(source, {
  configFile: false, babelrc: false, plugins: [require('@babel/plugin-transform-typescript')],
}).code;
const forum = read('src/domain/forum.ts');
let moveSource;
traverse(parse(forum), { FunctionDeclaration(p) {
  if (p.node.id?.name === 'moderateForum') moveSource = forum.slice(p.node.start, p.node.end);
} });
assert.ok(moveSource, 'Actual moderateForum function must exist');
const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';
const inactive = '10000000-0000-4000-8000-000000000003';
const topicId = '20000000-0000-4000-8000-000000000001';
let movesPassed = 0;
async function moveCase({
  destination, category = 'destination', actor = { id: 'moderator', scopes: [first] },
  expected, omit = false, merged = false, source = first,
  reason = '  A documented moderation decision.  ',
}) {
  const topic = { id: topicId, category_id: 'source', library_id: source,
    state: 'HIDDEN', locked: true, pinned: true, merged_into: merged ? second : null };
  const before = JSON.stringify(topic), audits = [], permissionChecks = [];
  const client = { async query(sql, args) {
    if (sql.startsWith('SELECT * FROM forum_topics')) return { rows: [{ ...topic }], rowCount: 1 };
    if (sql.startsWith('SELECT 1 FROM forum_categories')) return { rows: [], rowCount: args[0] === 'destination' ? 1 : 0 };
    if (sql.startsWith('SELECT 1 FROM libraries')) return { rows: [], rowCount: [first, second].includes(args[0]) ? 1 : 0 };
    if (sql.startsWith('UPDATE forum_topics SET category_id')) {
      topic.category_id = args[1]; topic.library_id = args[2]; return { rows: [], rowCount: 1 };
    }
    throw new Error('Unexpected mock database query: ' + sql);
  } };
  const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
  const service = vm.runInNewContext(transpile(moveSource) + ';moderateForum', {
    Object, ensure, roDomain: new Proxy({}, { get: () => 'Synthetic validation message' }),
    transaction: async callback => callback(client),
    async moderate(current, library) {
      permissionChecks.push(library);
      ensure(current.role === 'ADMIN' || current.scopes.includes(library), 'FORBIDDEN');
    },
    async audit(...args) { audits.push(args); },
  });
  const input = { topicId, action: 'move', categoryId: category, reason };
  if (!omit) input.libraryId = destination;
  if (expected) {
    await assert.rejects(service(actor, input), error => error.code === expected);
    assert.equal(JSON.stringify(topic), before, 'Rejected move must not mutate the topic');
    assert.equal(audits.length, 0, 'Rejected move must not record a successful action');
  } else {
    await service(actor, input);
    const chosen = omit ? source : destination;
    assert.equal(topic.library_id, chosen); assert.equal(topic.category_id, category);
    assert.equal(topic.state, 'HIDDEN'); assert.equal(topic.locked, true); assert.equal(topic.pinned, true);
    assert.deepEqual(permissionChecks, [source, chosen], 'Source and destination must both be checked');
    assert.equal(audits[0][5], reason.trim());
    assert.deepEqual(JSON.parse(JSON.stringify(audits[0][6])), {
      fromCategoryId: 'source', toCategoryId: category, fromLibraryId: source, toLibraryId: chosen,
    });
  }
  movesPassed++;
}
function formTransform(file, operation) {
  const source = read(file); let transform;
  traverse(parse(source), { JSXOpeningElement(p) {
    const node = p.node;
    const operationAttribute = node.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'op');
    if (operationAttribute?.value?.value !== operation) return;
    const attribute = node.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'transform');
    if (attribute) transform = source.slice(attribute.value.expression.start, attribute.value.expression.end);
  } });
  assert.ok(transform, 'Actual form transform must exist for ' + operation);
  return vm.runInNewContext(transpile('const transform=' + transform) + ';transform');
}
function adapter() {
  const source = read('src/components/api.ts'); let actSource;
  traverse(parse(source), { VariableDeclarator(p) {
    if (p.node.id.name === 'act') actSource = source.slice(p.node.init.start, p.node.init.end);
  } });
  assert.ok(actSource, 'Actual API adapter must exist');
  return vm.runInNewContext(transpile('const act=' + actSource) + ';act', {
    JSON, Object, Number, request: async (_url, options) => JSON.parse(options.body),
  });
}
(async () => {
  await moveCase({ omit: true });
  await moveCase({ destination: null, expected: 'FORBIDDEN' });
  await moveCase({ destination: second, expected: 'FORBIDDEN' });
  await moveCase({ destination: second, actor: { id: 'moderator', scopes: [first, second] } });
  await moveCase({ destination: null, actor: { id: 'admin', role: 'ADMIN' } });
  await moveCase({ destination: inactive, expected: 'INVALID_LIBRARY' });
  await moveCase({ omit: true, category: 'missing', expected: 'INVALID_CATEGORY' });
  await moveCase({ destination: '', expected: 'INVALID_LIBRARY' });
  await moveCase({ destination: undefined, expected: 'INVALID_LIBRARY' });
  await moveCase({ omit: true, merged: true, expected: 'INVALID_MERGE' });
  await moveCase({ omit: true, reason: '             ', expected: 'REASON_REQUIRED' });
  await moveCase({ destination: first, source: null, expected: 'FORBIDDEN' });

  const act = adapter();
  const book = formTransform('src/components/catalogue.tsx', 'review.book');
  assert.equal((await act('review.book', book({ workId: topicId, editionId: '', stars: '4' }))).editionId, null);
  const move = formTransform('src/components/community.tsx', 'forum.moderate');
  const retained = await act('forum.moderate', move({ topicId, action: 'move', destinationId: 'destination', destinationLibrary: '__KEEP__' }));
  assert.equal(Object.hasOwn(retained, 'libraryId'), false); assert.equal(retained.categoryId, 'destination');
  assert.equal(Object.hasOwn(retained, 'destinationLibrary'), false);
  const global = await act('forum.moderate', move({ topicId, action: 'move', destinationId: 'destination', destinationLibrary: '__GLOBAL__' }));
  assert.equal(global.libraryId, null);
  const volumes = await act('catalogue.addCopy', { volumeKey: 'Work part 1', volume: 'Edition volume 2' });
  assert.equal(volumes.volumeKey, 'Work part 1'); assert.equal(volumes.volume, 'Edition volume 2');
  console.log(JSON.stringify({ mockedServerMoveScenariosPassed: movesPassed,
    actualFormAndAdapterPayloadCasesPassed: 4, realDatabase: false, browser: false }));
})().catch(error => { console.error(error); process.exitCode = 1; });
