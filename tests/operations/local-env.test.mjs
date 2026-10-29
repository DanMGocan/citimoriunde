import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, writeFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('../../scripts/local-env.mjs',import.meta.url));
const example=fileURLToPath(new URL('../../.env.example',import.meta.url));
async function fixture(fn){const path=await mkdtemp(join(tmpdir(),'community-env-'));try{await copyFile(example,join(path,'.env.example'));await fn(path);}finally{await rm(path,{recursive:true,force:true});}}
const run=path=>spawnSync(process.execPath,[script],{cwd:path,encoding:'utf8'});
test('local setup creates restrictive, random secrets without exposing them',()=>fixture(async path=>{
 const result=run(path);assert.equal(result.status,0,result.stderr);
 const data=await readFile(join(path,'.env'),'utf8');
 const auth=/^AUTH_SECRET=(.+)$/m.exec(data)[1],password=/^POSTGRES_PASSWORD=(.+)$/m.exec(data)[1];
 assert.ok(auth.length>=32);assert.match(password,/^[a-f0-9]{48}$/);
 assert.ok(!result.stdout.includes(auth));assert.ok(!result.stdout.includes(password));
 assert.match(data,/^REGISTRATION_ENABLED=false$/m);assert.match(data,/^MAIL_MODE=disabled$/m);assert.match(data,/^MISTRAL_ENABLED=false$/m);
 assert.equal((await stat(join(path,'.env'))).mode&0o777,0o600);
}));
test('existing credential file is preserved byte for byte',()=>fixture(async path=>{
 const existing='AUTH_SECRET=existing-test-secret\nSMTP_PASSWORD=synthetic-secret\nCUSTOM=value\n';
 await writeFile(join(path,'.env'),existing,{mode:0o644});
 const before=createHash('sha256').update(existing).digest('hex');const result=run(path);assert.equal(result.status,0,result.stderr);
 assert.equal(createHash('sha256').update(await readFile(join(path,'.env'))).digest('hex'),before);
 assert.equal((await stat(join(path,'.env'))).mode&0o777,0o600);assert.ok(!result.stdout.includes('synthetic-secret'));
}));
test('setup refuses symlinks and does not overwrite their targets',()=>fixture(async path=>{
 const target=join(path,'unrelated');await writeFile(target,'preserve',{mode:0o644});await symlink(target,join(path,'.env'));
 const result=run(path);assert.notEqual(result.status,0);assert.equal(await readFile(target,'utf8'),'preserve');assert.equal((await stat(target)).mode&0o777,0o644);
}));
