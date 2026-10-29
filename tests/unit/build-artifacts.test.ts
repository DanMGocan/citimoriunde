import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectBuildArtifacts} from '../../scripts/check-build-artifacts.ts';

const secret='synthetic-artifact-secret-32-characters';
async function fixture(run:(root:string)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'community-artifacts-'));
  try {
    for(const directory of ['.next/standalone','.next/static/chunks','.next/server/chunks'])await mkdir(join(root,directory),{recursive:true});
    await writeFile(join(root,'.next/standalone/server.js'),'// server reads runtime configuration');
    await writeFile(join(root,'.next/static/chunks/app.js'),'console.log("public interface")');
    await writeFile(join(root,'.next/server/chunks/app.js'),'// server reads runtime configuration');
    await run(root);
  }finally{await rm(root,{recursive:true,force:true});}
}

test('build artifact checks pass clean outputs and fail when a completed artifact is missing',async()=>{
  await fixture(async root=>{
    assert.equal((await inspectBuildArtifacts(root,[secret])).failures,0);
    await rm(join(root,'.next/static'),{recursive:true});
    const report=await inspectBuildArtifacts(root,[secret]);
    assert.ok(report.missingArtifacts>0);assert.ok(report.failures>0);
  });
});
test('standalone checks detect env files and copied private paths without reporting their contents',async()=>{
  await fixture(async root=>{
    await writeFile(join(root,'.next/standalone/.env.production'),secret);
    for(const path of ['storage/images','backups','test-artifacts/browser','data/snapshots','private-images'])await mkdir(join(root,'.next/standalone',path),{recursive:true});
    const report=await inspectBuildArtifacts(root,[secret],[join(root,'private-images')]);
    assert.equal(report.privatePaths,6);assert.ok(!JSON.stringify(report).includes(secret));
  });
});
test('browser and server scans detect raw and encoded credentials and redact matching values',async()=>{
  await fixture(async root=>{
    const escaped='synthetic-secret-with-"quote-and-\\slash';
    await writeFile(join(root,'.next/static/chunks/app.js'),JSON.stringify(escaped));
    await writeFile(join(root,'.next/server/chunks/app.js'),Buffer.from(secret).toString('base64'));
    const report=await inspectBuildArtifacts(root,[secret,escaped]);
    assert.equal(report.browserCredentialFiles,1);assert.equal(report.serverCredentialFiles,1);
    assert.ok(!JSON.stringify(report).includes(secret));assert.ok(!JSON.stringify(report).includes(escaped));
  });
});
test('standalone checks reject a symlink escaping into a private source location',async()=>{
  await fixture(async root=>{
    await writeFile(join(root,'outside.env'),secret);
    await symlink(join(root,'outside.env'),join(root,'.next/standalone/runtime-config'));
    const report=await inspectBuildArtifacts(root,[secret]);assert.equal(report.escapedLinks,1);assert.ok(report.failures>0);
  });
});
test('short build placeholders are counted and skipped while full credential URLs remain covered',async()=>{
  await fixture(async root=>{
    const databaseUrl='postgresql://build:build@127.0.0.1/build';
    await writeFile(join(root,'.next/static/chunks/app.js'),'console.log("build output")');
    const clean=await inspectBuildArtifacts(root,['build',databaseUrl]);
    assert.equal(clean.skippedShortCredentialValues,1);assert.equal(clean.failures,0);
    await writeFile(join(root,'.next/static/chunks/app.js'),JSON.stringify(databaseUrl));
    assert.equal((await inspectBuildArtifacts(root,['build',databaseUrl])).browserCredentialFiles,1);
  });
});
