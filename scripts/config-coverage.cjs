// Compare documented keys with literal configuration readers without reading deployment .env.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/lib/config.ts'), 'utf8');
const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const readers = new Set(Array.from(source.matchAll(/\b(?:string|bool|integer|decimal|choice|url|optionalUrl|adSlot)\("([A-Z][A-Z0-9_]*)"/g), match => match[1]));
const documented = new Set(Array.from(example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm), match => match[1]));
readers.delete('PATH'); // inherited executable-search path, never a deployment credential.
const missing = [...readers].filter(key => !documented.has(key));
assert.deepEqual(missing, [], 'Configuration keys missing from .env.example');
const unused = [...documented].filter(key => !readers.has(key));
assert.deepEqual(unused, [], 'Documented keys missing a typed configuration reader');
console.log(`${readers.size}/${readers.size} configuration keys documented and read through the typed module; deployment .env was not read.`);
