import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,lstat,readdir,rm,symlink} from 'node:fs/promises';
import {mkdtempSync,writeFileSync,readFileSync,openSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';

// The operator script always runs in a new synthetic directory. These tests
// never read the repository .env or supply credentials through process argv.
const script=fileURLToPath(new URL('../../scripts/configure-smtp.mjs',import.meta.url));
const smtp={
  SMTP_HOST:'smtp.synthetic.invalid',SMTP_PORT:'587',SMTP_SECURE:'false',SMTP_REQUIRE_TLS:'true',
  SMTP_USER:'synthetic-user@example.invalid',SMTP_PASSWORD:'synthetic "quoted" \\ password # $ only',
  SMTP_FROM:'Bibliotecă de test <synthetic-sender@example.invalid>',MAIL_MODE:'smtp',
};
const original=[
  '# Synthetic fixture only; no real credentials.',
  'APP_NAME="Temporary test brand"',
  'AUTH_SECRET="synthetic-auth-secret-do-not-change"',
  'GOOGLE_CLIENT_ID="synthetic-google-client"',
  'GOOGLE_CLIENT_SECRET="synthetic-google-secret-do-not-change"',
  'APP_URL="http://127.0.0.1:3000"',
  'SMTP_HOST="previous.synthetic.invalid"',
  'SMTP_PASSWORD="previous-synthetic-password"',
  'SMTP_VERIFIED="true"',
  'SMTP_PASSWORD_BACKUP="unrelated-synthetic-key"',
  '# Preserve this trailing unrelated comment.',
  '',
].join('\n');

async function fixture(fn){
  const directory=await mkdtemp(join(tmpdir(),'community-smtp-test-'));
  try{return await fn(directory);}finally{await rm(directory,{recursive:true,force:true});}
}
function run(directory,input){
  // File-backed descriptors still feed stdin, and work in environments where
  // Node's pipe/socket-pair setup is forbidden. Only synthetic fixture data is written.
  const io=mkdtempSync(join(directory,'.smtp-test-io-')),stdin=join(io,'stdin'),stdout=join(io,'stdout'),stderr=join(io,'stderr');
  const descriptors=[];let result;
  try{
    writeFileSync(stdin,typeof input==='string'?input:JSON.stringify(input),{mode:0o600});
    descriptors.push(openSync(stdin,'r'),openSync(stdout,'wx',0o600),openSync(stderr,'wx',0o600));
    result=spawnSync(process.execPath,[script],{cwd:directory,stdio:descriptors,timeout:10000});
    result.stdout=readFileSync(stdout,'utf8');result.stderr=readFileSync(stderr,'utf8');
  }finally{for(const descriptor of descriptors)closeSync(descriptor);rmSync(io,{recursive:true,force:true});}
  assert.equal(result.error,undefined,'The SMTP helper subprocess must actually execute.');
  assert.equal(result.signal,null,'The SMTP helper must finish without timing out or a signal.');
  return result;
}
function unrelatedLines(text){
  return text.split('\n').filter(line=>line!==''&&!Object.keys({...smtp,SMTP_VERIFIED:'false'}).some(key=>line.startsWith(key+'=')));
}
function assertRedacted(result){
  const output=result.stdout+result.stderr;
  for(const value of [smtp.SMTP_USER,smtp.SMTP_PASSWORD,smtp.SMTP_FROM,'synthetic-auth-secret-do-not-change','synthetic-google-secret-do-not-change','previous-synthetic-password'])
    assert.equal(output.includes(value),false,'Subprocess output must not include synthetic credential values.');
}
function readSyntheticSettings(file){
  const keys=[...Object.keys(smtp),'SMTP_VERIFIED'],previous=new Map(keys.map(key=>[key,process.env[key]]));
  try{for(const key of keys)delete process.env[key];loadEnvFile(file);return Object.fromEntries(keys.map(key=>[key,process.env[key]]));}
  finally{for(const [key,value] of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}

test('targeted SMTP update preserves unrelated credentials, quotes values and replaces with mode 0600',()=>fixture(async directory=>{
  const file=join(directory,'.env');await writeFile(file,original,{mode:0o644});
  const before=await stat(file),result=run(directory,smtp);assert.equal(result.status,0);assertRedacted(result);
  const updated=await readFile(file,'utf8'),after=await stat(file);
  assert.deepEqual(unrelatedLines(updated),unrelatedLines(original));
  for(const [key,value] of Object.entries(smtp)){
    const lines=updated.split('\n').filter(line=>line.startsWith(key+'='));
    assert.equal(lines.length,1);
  }
  assert.deepEqual(readSyntheticSettings(file),{...smtp,SMTP_VERIFIED:'false'});
  assert.equal(after.mode&0o777,0o600);assert.notEqual(after.ino,before.ino);
  assert.ok(updated.endsWith('\n'));assert.deepEqual(await readdir(directory),['.env']);
}));

test('malformed, missing, unsupported, mistyped and multiline SMTP input leaves the file unchanged',()=>fixture(async directory=>{
  const file=join(directory,'.env');await writeFile(file,original,{mode:0o640});
  const {SMTP_PASSWORD,...missingPassword}=smtp;
  const invalid=[
    '{',null,[],{...smtp,AUTH_SECRET:'synthetic-attempted-overwrite'},{...smtp,SMTP_VERIFIED:'true'},missingPassword,
    {...smtp,SMTP_PORT:587},{...smtp,SMTP_SECURE:true},{...smtp,SMTP_REQUIRE_TLS:'false'},
    {...smtp,SMTP_PASSWORD:'synthetic\nsecond-line'},{...smtp,SMTP_PASSWORD:'synthetic\rreturn'},
    {...smtp,SMTP_PASSWORD:'synthetic\0nul'},{...smtp,SMTP_HOST:'smtp.invalid/unsafe'},
    {...smtp,SMTP_PASSWORD:'synthetic all quote types \' " `'},
  ];
  for(const input of invalid){
    const result=run(directory,input);assert.equal(result.status,1);assertRedacted(result);
    assert.equal(await readFile(file,'utf8'),original);assert.equal((await stat(file)).mode&0o777,0o640);
    assert.deepEqual(await readdir(directory),['.env']);
  }
}));

test('SMTP credentials round-trip through the real environment parser without JSON escape corruption',async()=>{
  for(const password of ['synthetic "double" \\n # $',"synthetic 'single' \\n # $",'synthetic \'single\' "double" \\n # $'])await fixture(async directory=>{
    const file=join(directory,'.env');await writeFile(file,original,{mode:0o600});const values={...smtp,SMTP_PASSWORD:password};
    const result=run(directory,values);assert.equal(result.status,0);assertRedacted(result);assert.equal((result.stdout+result.stderr).includes(password),false);
    assert.deepEqual(readSyntheticSettings(file),{...values,SMTP_VERIFIED:'false'});
  });
});

test('duplicate target keys are rejected without editing the file or exposing their values',async()=>{
  for(const key of ['SMTP_PASSWORD','SMTP_HOST'])await fixture(async directory=>{
    const file=join(directory,'.env'),duplicates=original+`${key}="another-synthetic-value"\n`;
    await writeFile(file,duplicates,{mode:0o640});const result=run(directory,smtp);
    assert.equal(result.status,1);assertRedacted(result);assert.ok(!result.stderr.includes('another-synthetic-value'));
    assert.equal(await readFile(file,'utf8'),duplicates);assert.equal((await stat(file)).mode&0o777,0o640);
    assert.deepEqual(await readdir(directory),['.env']);
  });
});

test('a symlink credential path is refused and its unrelated target stays untouched',()=>fixture(async directory=>{
  const target=join(directory,'unrelated-synthetic-file'),file=join(directory,'.env');
  await writeFile(target,original,{mode:0o640});await symlink(target,file);
  const result=run(directory,smtp);assert.equal(result.status,1);assertRedacted(result);
  assert.equal(await readFile(target,'utf8'),original);assert.equal((await stat(target)).mode&0o777,0o640);
  assert.ok((await lstat(file)).isSymbolicLink());assert.deepEqual((await readdir(directory)).sort(),['.env','unrelated-synthetic-file']);
}));

test('missing credential file is refused without creating settings or changing unrelated files',()=>fixture(async directory=>{
  const unrelated=join(directory,'keep');await writeFile(unrelated,'synthetic unrelated content',{mode:0o640});
  const result=run(directory,smtp);assert.equal(result.status,1);assertRedacted(result);
  assert.equal(await readFile(unrelated,'utf8'),'synthetic unrelated content');assert.deepEqual(await readdir(directory),['keep']);
}));
