import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const configUrl = new URL("../../src/lib/config.ts", import.meta.url).href;
function execute(overrides:Partial<NodeJS.ProcessEnv>={}, expression="({public: m.publicConfig(),safe:m.safeEffectiveConfig(),readiness:m.configurationReadiness()})") {
  return spawnSync(process.execPath,["--import",import.meta.resolve("tsx"),"--input-type=module","-e",`const m=await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify(${expression}));`],{
    cwd:"/tmp",encoding:"utf8",env:{NODE_ENV:"test",APP_ENV:"test",AUTH_SECRET:"test-secret-containing-at-least-thirty-two-characters",DATABASE_URL:"postgresql://test:secret-db-value@127.0.0.1:5432/isolated",...overrides},
  });
}
test("configuration public/admin projections never return secrets",()=>{
  const r=execute({GOOGLE_CLIENT_ID:"private-google-client",GOOGLE_CLIENT_SECRET:"private-google-secret",MISTRAL_API_KEY:"private-ai-secret",SMTP_PASSWORD:"private-mail-secret"});
  assert.equal(r.status,0,r.stderr);
  for(const secret of ["test-secret-containing","secret-db-value","private-google-client","private-google-secret","private-ai-secret","private-mail-secret"]) assert.ok(!r.stdout.includes(secret));
  const result=JSON.parse(r.stdout);assert.equal(result.public.appName,"Biblioteca Comunității");assert.equal(result.safe.googleConfigured,true);assert.equal(result.readiness.readyForPublicLaunch,false);
});
test("optional absent integrations leave the application configurable",()=>{
  const r=execute();assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.public.googleEnabled,false);assert.equal(result.safe.smtpConfigured,false);
});
test("invalid booleans and partial OAuth fail without returning values",()=>{
  const boolean=execute({REGISTRATION_ENABLED:"perhaps"});assert.notEqual(boolean.status,0);assert.match(boolean.stderr,/Invalid boolean configuration: REGISTRATION_ENABLED/);
  const oauth=execute({GOOGLE_CLIENT_ID:"do-not-echo-client"});assert.notEqual(oauth.status,0);assert.ok(!oauth.stderr.includes("do-not-echo-client"));
});
test("production needs HTTPS and public signup requires reviewed prerequisites",()=>{
  assert.notEqual(execute({APP_ENV:"production",APP_URL:"http://localhost:3000"}).status,0);
  assert.notEqual(execute({APP_ENV:"production",APP_URL:"https://library.example.org",AUTH_SECRET:"generate-a-random-secret-at-least-32-characters"}).status,0);
  assert.notEqual(execute({APP_ENV:"production",APP_URL:"https://library.example.org",DATABASE_URL:"postgresql://test:generate-a-random-local-password@127.0.0.1/community"}).status,0);
  const r=execute({APP_ENV:"production",APP_URL:"https://library.example.org",REGISTRATION_ENABLED:"true"});assert.notEqual(r.status,0);assert.match(r.stderr,/Public registration requires/);
});
test("production defaults hide placeholders and choose no live requests",()=>{
  const r=execute({APP_ENV:"production",APP_URL:"https://library.example.org"});assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.public.adsMode,"off");assert.equal(result.public.placeholdersPublic,false);
});
test("a health-ready config does not claim launch readiness or invent operator data",()=>{
  const r=execute();const result=JSON.parse(r.stdout);assert.ok(result.readiness.blockers.length>0);assert.equal(result.safe.legalReviewed,false);assert.ok(!Object.hasOwn(result.safe,"operatorAddress"));
});
test("development banner layouts are available while production placeholders stay opt-in",()=>{
  const r=execute({APP_ENV:"development",ADS_MODE:"placeholder"});assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.public.placeholdersPublic,true);assert.equal(result.public.environment,"development");
});
test("CMP scripts, publisher identifiers and numeric slot identifiers are allowlisted",()=>{
  const rejected:Record<string,string>[]=[{CMP_PROVIDER:"untrusted"},{CMP_SCRIPT_URL:"https://untrusted.example.invalid/script.js"},{CMP_PUBLISHER_ID:"00000000-0000-0000-0000-000000000000"},{ADS_CATALOGUE_SLOT_ID:"script-id"}];
  for(const overrides of rejected) assert.notEqual(execute(overrides).status,0);
  const configured=execute({CMP_PROVIDER:"cookiebot",CMP_SCRIPT_URL:"https://consent.cookiebot.com/uc.js",CMP_PUBLISHER_ID:"f2076c79-8a08-4a33-ab6d-278c26451d80",CMP_CSP_ENABLED:"true",CMP_CERTIFIED:"true",CMP_VALIDATED:"true",ADS_CATALOGUE_SLOT_ID:"1234567890"});assert.equal(configured.status,0,configured.stderr);assert.equal(JSON.parse(configured.stdout).safe.cmpConfigured,true);
});
test("Mistral cost bound starts disabled even with an API credential",()=>{
  const r=execute({MISTRAL_ENABLED:"true",MISTRAL_API_KEY:"synthetic-private-key"},"({max:m.config.mistralMaxRequestCostCents,readiness:m.configurationReadiness()})");assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.max,0);assert.ok(result.readiness.blockers.some((value:string)=>value.includes("bugetului")));assert.ok(!r.stdout.includes("synthetic-private-key"));
});
test("isolated child environment never inherits deployment provider credentials",()=>{
  const r=execute({GOOGLE_CLIENT_ID:"deployment-client",GOOGLE_CLIENT_SECRET:"deployment-secret",SMTP_PASSWORD:"deployment-smtp-secret",MISTRAL_API_KEY:"deployment-ai-secret"},"m.isolatedTestEnvironment('postgresql://test:synthetic@localhost/community_123_test','/tmp/community-tests-synthetic/images','/tmp/community-tests-synthetic/backups','synthetic-child-auth-secret-at-least-thirty-two')");assert.equal(r.status,0,r.stderr);const child=JSON.parse(r.stdout);assert.equal(child.APP_ENV,"test");assert.equal(child.GOOGLE_CLIENT_SECRET,"");assert.equal(child.MAIL_MODE,"disabled");assert.equal(child.ADS_MODE,"off");assert.equal(child.STORAGE_DRIVER,"local");for(const secret of ["deployment-client","deployment-secret","deployment-smtp-secret","deployment-ai-secret"]) assert.ok(!r.stdout.includes(secret));
  assert.notEqual(execute({},"m.isolatedTestEnvironment('postgresql://test:synthetic@localhost/community','/tmp/community-tests/images','/tmp/community-tests/backups','synthetic-child-secret')").status,0);
});
test("Next project env loading cannot import deployment values into an isolated child",()=>{
  const result=execute({},"m.isolatedTestEnvironment('postgresql://test:synthetic@localhost/community_123_test','/tmp/community-tests-synthetic/images','/tmp/community-tests-synthetic/backups','synthetic-child-auth-secret-at-least-thirty-two')");
  assert.equal(result.status,0,result.stderr);
  const env: NodeJS.ProcessEnv={...JSON.parse(result.stdout),NODE_ENV:"production"};
  const directory=mkdtempSync(join(tmpdir(),"community-next-env-"));
  const loaderUrl=new URL("../../node_modules/@next/env/dist/index.js",import.meta.url).href;
  try {
    writeFileSync(join(directory,".env"),"SMTP_HOST=deployment-smtp-host\nSMTP_USER=deployment-smtp-user\nSMTP_PASSWORD=deployment-smtp-secret\nSMTP_VERIFIED=true\nS3_ACCESS_KEY=deployment-storage-key\nS3_SECRET_KEY=deployment-storage-secret\nPOSTGRES_PASSWORD=deployment-database-secret\nOPERATOR_NAME=Deployment Operator\nBACKUP_OFFSITE_DESTINATION=deployment-offsite\nLEGAL_REVIEWED=true\nPUBLIC_LAUNCH_REVIEWED=true\nUPLOAD_MAX_PHOTOS=6\n",{mode:0o600});
    const child=spawnSync(process.execPath,["--import",import.meta.resolve("tsx"),"--input-type=module","-e",`const next=await import(${JSON.stringify(loaderUrl)});next.default.loadEnvConfig(${JSON.stringify(directory)},false);const m=await import(${JSON.stringify(configUrl)});console.log(JSON.stringify({smtp:m.config.smtpHost,user:m.config.smtpUser,password:m.config.smtpPassword,s3:m.config.s3SecretKey,postgres:m.config.postgresPassword,operator:m.config.operatorName,offsite:m.config.backupOffsiteDestination,verified:m.config.smtpVerified,legal:m.config.legalReviewed,launch:m.config.publicLaunchReviewed,maxPhotos:m.config.maxPhotos}));`],{cwd:directory,env,encoding:"utf8"});
    assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),{smtp:"",user:"",password:"",s3:"",postgres:"",operator:"",offsite:"",verified:false,legal:false,launch:false,maxPhotos:3});
    assert.ok(!child.stdout.includes("deployment-"));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test("native credentials load without replacing deployment launch overrides",()=>{
  const directory=mkdtempSync(join(tmpdir(),"community-native-env-"));
  const credential=join(directory,"app.env");
  const password="synthetic-$value\\with-quotes'and-double\"";
  try {
    writeFileSync(credential,`APP_ENV=development\nAPP_URL=http://localhost:3000\nREGISTRATION_ENABLED=true\nSMTP_PASSWORD=\`${password}\`\n`,{mode:0o600});
    const child=execute({CONFIG_ENV_FILE:credential,APP_ENV:"production",APP_URL:"https://library.example.org",REGISTRATION_ENABLED:"false"},`({environment:m.config.environment,url:m.config.appUrl,registration:m.config.registrationEnabled,passwordLoaded:m.config.smtpPassword===${JSON.stringify(password)}})`);
    assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),{environment:"production",url:"https://library.example.org",registration:false,passwordLoaded:true});
    assert.ok(!child.stdout.includes(password));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test("explicit S3 storage fails clearly when incomplete or insecure in production",()=>{
  assert.notEqual(execute({STORAGE_DRIVER:"s3"}).status,0);
  const values={STORAGE_DRIVER:"s3",S3_ENDPOINT:"http://storage.example.invalid",S3_BUCKET:"synthetic-bucket",S3_ACCESS_KEY:"synthetic-key",S3_SECRET_KEY:"synthetic-secret"};
  const local=execute(values);assert.equal(local.status,0,local.stderr);
  assert.notEqual(execute({...values,APP_ENV:"production",APP_URL:"https://library.example.org"}).status,0);
  assert.notEqual(execute({...values,S3_ENDPOINT:"https://user:synthetic-secret@storage.example.invalid/private?x=1"}).status,0);
});
test("SMTP rejects plaintext, partial credentials and inadequate worker shutdown budget",()=>{
  const smtp={MAIL_MODE:"smtp",SMTP_HOST:"smtp.example.invalid",SMTP_FROM:"Synthetic <sender@example.invalid>",SMTP_USER:"synthetic-user",SMTP_PASSWORD:"synthetic-password"};
  for(const overrides of [{SMTP_REQUIRE_TLS:"false"},{SMTP_PASSWORD:""},{SMTP_USER:""},{SMTP_HOST:""},{SMTP_FROM:""},{WORKER_STOP_GRACE_SECONDS:"30"}]) assert.notEqual(execute({...smtp,...overrides}).status,0);
  const configured=execute(smtp);assert.equal(configured.status,0,configured.stderr);const result=JSON.parse(configured.stdout);assert.equal(result.safe.smtpConfigured,true);assert.equal(result.safe.smtpVerified,false);assert.ok(result.readiness.blockers.some((value:string)=>value.includes("livrarea SMTP")));
});
test("configured SMTP does not satisfy production registration until delivery is attested",()=>{
  const production={MAIL_MODE:"smtp",SMTP_HOST:"smtp.example.invalid",SMTP_FROM:"Synthetic <sender@example.invalid>",APP_ENV:"production",APP_URL:"https://library.example.org",REGISTRATION_ENABLED:"true",LEGAL_REVIEWED:"true",PUBLIC_LAUNCH_REVIEWED:"true",OPERATOR_NAME:"Synthetic Operator",OPERATOR_ADDRESS:"Synthetic Address",OPERATOR_COUNTRY:"IE",SUPPORT_EMAIL:"support@example.invalid"};
  const unverified=execute(production);assert.notEqual(unverified.status,0);assert.match(unverified.stderr,/verified SMTP delivery/);
  const attested=execute({...production,SMTP_VERIFIED:"true"});assert.equal(attested.status,0,attested.stderr);assert.equal(JSON.parse(attested.stdout).safe.smtpVerified,true);
});
