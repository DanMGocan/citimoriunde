import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { config } from "../../src/lib/config";
import type { AppConfig } from "../../src/lib/config";
import { query } from "../../src/lib/db";
import { auth, createAuth, hasAdminStepUp } from "../../src/lib/auth";
import { POST, GET } from "../../src/app/api/auth/[...all]/route";
import { actorFrom, verified, admin } from "../../src/domain/access";
import { requestLibrary, decideLibrary } from "../../src/domain/libraries";
import { assertIsolatedDatabase, fixtureMember, closeTestPool } from "./helpers";
import { databaseLaunchChecks, launchReadiness } from "../../src/domain/readiness";
import { initialPolicySlugs } from "../../src/lib/legal-publication.ts";

assertIsolatedDatabase();
after(closeTestPool);
const password = "Synthetic-test-password-42!";
const newEmail = () => `auth_${randomUUID().replaceAll("-", "")}@example.invalid`;
function cookieHeaders(headers: Headers, origin = config.appUrl) {
  return new Headers({ origin, cookie: headers.getSetCookie().map(value => value.split(";",1)[0]).join("; "), "user-agent": "isolated-auth-contract-tests" });
}
async function queuedLink(email: string, template: string) {
  const result = await query("SELECT payload,status FROM jobs WHERE type='auth_email' AND payload->>'to'=$1 AND payload->>'template'=$2 ORDER BY created_at DESC LIMIT 1", [email,template]);
  assert.equal(result.rowCount,1,"Authentication email must be durably queued; SMTP delivery is deliberately not run.");
  assert.equal(result.rows[0].status,"PENDING");
  const url = new URL(result.rows[0].payload.url);
  assert.equal(url.origin,config.appUrl);
  assert.ok(Number(result.rows[0].payload.expiresAt)>Date.now());
  return url;
}
async function register(email = newEmail()) {
  const result = await auth.api.signUpEmail({body:{name:"Cititor de test",email,password},returnHeaders:true});
  const user = (await query('SELECT id,"emailVerified",image FROM "user" WHERE email=$1',[email])).rows[0];
  assert.ok(user); assert.equal(user.emailVerified,false); assert.equal(user.image,null);
  return { email, user, result };
}
async function verifiedAccount() {
  const account = await register();
  const link = await queuedLink(account.email,"verification");
  await auth.api.verifyEmail({query:{token:link.searchParams.get("token")!}});
  assert.equal((await query('SELECT "emailVerified" FROM "user" WHERE id=$1',[account.user.id])).rows[0].emailVerified,true);
  return account;
}
async function login(email:string, secret=password, instance=auth) {
  const result = await instance.api.signInEmail({body:{email,password:secret},returnHeaders:true});
  return { ...result, headers: cookieHeaders(result.headers) };
}
function request(path:string,body:unknown,headers?:Headers) {
  return new Request(`${config.appUrl}/api/auth${path}`,{method:"POST",headers:{"content-type":"application/json",origin:config.appUrl,...Object.fromEntries(headers?.entries()??[])},body:JSON.stringify(body)});
}

test("local signup is generic, queues verification and creates no unverified session",async()=>{
  const account=await register();
  assert.equal(account.result.response.token,null);
  const duplicate=await auth.api.signUpEmail({body:{name:"Cititor de test",email:account.email,password},returnHeaders:true});
  assert.equal(duplicate.response.token,null);
  assert.deepEqual(Object.keys(duplicate.response).sort(),Object.keys(account.result.response).sort());
  assert.deepEqual(Object.keys(duplicate.response.user).sort(),Object.keys(account.result.response.user).sort());
  assert.equal((await query('SELECT count(*)::int n FROM "user" WHERE email=$1',[account.email])).rows[0].n,1);
  await queuedLink(account.email,"verification");
  await assert.rejects(auth.api.signInEmail({body:{email:account.email,password}}));
  assert.equal((await query('SELECT count(*)::int n FROM session WHERE "userId"=$1',[account.user.id])).rows[0].n,0);
});

test("HTTP signup requires server-side adult/terms attestations and stores only new-account policy versions",async()=>{
  const deniedEmail=newEmail();
  for(const assertions of [{},{adult:false,acceptedTerms:true},{adult:true,acceptedTerms:false},{adult:"true",acceptedTerms:true}]) {
    const denied=await POST(request("/sign-up/email",{name:"Cititor de test",email:deniedEmail,password,...assertions}));
    assert.equal(denied.status,400);assert.equal((await denied.json()).code,"ADULT_TERMS_REQUIRED");
  }
  assert.equal((await query('SELECT count(*)::int n FROM "user" WHERE email=$1',[deniedEmail])).rows[0].n,0);
  const legalMissing=await POST(request("/sign-up/email",{name:"Cititor de test",email:deniedEmail,password,adult:true,acceptedTerms:true}));
  assert.equal(legalMissing.status,403);assert.equal((await legalMissing.json()).code,"LEGAL_NOT_READY");
  const ids:string[]=[];
  try {
    for(const slug of ["termeni","confidentialitate","imprumuturi-daruri"]) ids.push((await query("INSERT INTO legal_documents(slug,version,title,body,is_draft,published_at) VALUES($1,901,'Synthetic test policy','Synthetic isolated policy text; no legal approval.',false,now()) RETURNING id",[slug])).rows[0].id);
    const previous=await verifiedAccount(),previousLogin=await login(previous.email);await actorFrom(previousLogin.headers);
    assert.equal((await query("SELECT adult FROM members WHERE id=$1",[previous.user.id])).rows[0].adult,false);
    const email=newEmail(),created=await POST(request("/sign-up/email",{name:"Cititor de test",email,password,adult:true,acceptedTerms:true}));
    assert.equal(created.status,200);const body=await created.json();assert.equal(body.token,undefined);assert.equal(body.user.emailVerified,false);
    const actual=(await query('SELECT id FROM "user" WHERE email=$1',[email])).rows[0];assert.equal(body.user.id,actual.id);
    assert.equal((await query("SELECT adult FROM members WHERE id=$1",[actual.id])).rows[0].adult,true);
    const accepted=(await query("SELECT document_id FROM legal_acceptances WHERE member_id=$1 ORDER BY document_id",[actual.id])).rows.map(row=>row.document_id);
    assert.deepEqual(accepted,[...ids].sort());
    assert.equal((await query("SELECT count(*)::int n FROM audit_log WHERE actor_id=$1 AND action='REGISTRATION_ATTESTATION'",[actual.id])).rows[0].n,1);
    // Generic duplicate responses cannot turn a prior member into an adult or
    // silently accept updated documents on that member's behalf.
    const duplicatePrior=await POST(request("/sign-up/email",{name:"Cititor de test",email:previous.email,password,adult:true,acceptedTerms:true}));assert.equal(duplicatePrior.status,created.status);
    assert.equal((await query("SELECT adult FROM members WHERE id=$1",[previous.user.id])).rows[0].adult,false);
    assert.equal((await query("SELECT count(*)::int n FROM legal_acceptances WHERE member_id=$1",[previous.user.id])).rows[0].n,0);
    const duplicate=await POST(request("/sign-up/email",{name:"Cititor de test",email,password,adult:true,acceptedTerms:true}));assert.equal(duplicate.status,created.status);
    assert.equal((await query("SELECT count(*)::int n FROM audit_log WHERE actor_id=$1 AND action='REGISTRATION_ATTESTATION'",[actual.id])).rows[0].n,1);
  } finally {
    await query("DELETE FROM legal_acceptances WHERE document_id=ANY($1::uuid[])",[ids]);
    await query("DELETE FROM legal_documents WHERE id=ANY($1::uuid[])",[ids]);
  }
});

test("verification, real hashing, login cookies, logout and revoked sessions",async()=>{
  const account=await verifiedAccount();
  const credential=(await query('SELECT password FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',[account.user.id])).rows[0];
  assert.ok(credential.password && credential.password!==password);
  const first=await login(account.email),second=await login(account.email);
  const session=await auth.api.getSession({headers:first.headers});assert.equal(session?.user.id,account.user.id);assert.equal(session?.user.image,null);
  const cookie=first.headers.get("cookie")!;assert.ok(cookie.length>20);
  assert.ok(first.response.token && second.response.token && first.response.token!==second.response.token);
  const rawHeaders=await auth.api.signInEmail({body:{email:account.email,password},returnHeaders:true});
  assert.ok(rawHeaders.headers.getSetCookie().some(value=>/HttpOnly/i.test(value)&&/SameSite=Lax/i.test(value)));
  await auth.api.revokeSession({headers:first.headers,body:{token:second.response.token!}});
  assert.equal(await auth.api.getSession({headers:second.headers}),null);
  await auth.api.signOut({headers:first.headers});
  assert.equal(await auth.api.getSession({headers:first.headers}),null);
  await auth.api.revokeSessions({headers:cookieHeaders(rawHeaders.headers)});
  assert.equal((await query('SELECT count(*)::int n FROM session WHERE "userId"=$1',[account.user.id])).rows[0].n,0);
});

test("reset requests avoid enumeration, tokens are single-use, password reset revokes all sessions",async()=>{
  const account=await verifiedAccount(),first=await login(account.email),second=await login(account.email);
  const exists=await auth.api.requestPasswordReset({body:{email:account.email,redirectTo:`${config.appUrl}/resetare`}});
  const missingEmail=newEmail();const missing=await auth.api.requestPasswordReset({body:{email:missingEmail,redirectTo:`${config.appUrl}/resetare`}});
  assert.deepEqual(missing,exists);
  assert.equal((await query("SELECT count(*)::int n FROM jobs WHERE payload->>'to'=$1",[missingEmail])).rows[0].n,0);
  const link=await queuedLink(account.email,"reset"), token=link.pathname.split("/").at(-1)!;
  const newPassword="Another-synthetic-password-43!";
  await auth.api.resetPassword({body:{token,newPassword}});
  assert.equal(await auth.api.getSession({headers:first.headers}),null);assert.equal(await auth.api.getSession({headers:second.headers}),null);
  await assert.rejects(auth.api.resetPassword({body:{token,newPassword:"Different-synthetic-password-44!"}}));
  await assert.rejects(login(account.email,password));assert.ok((await login(account.email,newPassword)).response.token);
  const wrong=await auth.api.signInEmail({body:{email:account.email,password:"Incorrect-test-password-50!"},asResponse:true});
  const unknown=await auth.api.signInEmail({body:{email:newEmail(),password:"Incorrect-test-password-50!"},asResponse:true});
  assert.equal(wrong.status,unknown.status);assert.deepEqual(await wrong.json(),await unknown.json());
});

test("expired/invalid verification links do not verify users",async()=>{
  const account=await register();
  await assert.rejects(auth.api.verifyEmail({query:{token:"invalid-synthetic-token"}}));
  // Better Auth's documented/source-confirmed local email token is HS256.
  // Re-sign only this synthetic account's queued token with the isolated test
  // secret to exercise the real verifier's expiration branch without sleeping.
  const link=await queuedLink(account.email,"verification"),[header,encoded]=link.searchParams.get("token")!.split(".");
  assert.equal(JSON.parse(Buffer.from(header,"base64url").toString("utf8")).alg,"HS256");
  const claims=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));claims.exp=Math.floor(Date.now()/1000)-60;
  const input=`${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`,expired=`${input}.${createHmac("sha256",config.authSecret).update(input).digest("base64url")}`;
  const rejected=await auth.api.verifyEmail({query:{token:expired},asResponse:true});assert.equal(rejected.status,401);assert.equal((await rejected.json()).code,"TOKEN_EXPIRED");
  assert.equal((await query('SELECT "emailVerified" FROM "user" WHERE id=$1',[account.user.id])).rows[0].emailVerified,false);
  await assert.rejects(auth.api.resetPassword({body:{token:"expired-or-invalid-synthetic-token",newPassword:password}}));
  await auth.api.requestPasswordReset({body:{email:account.email,redirectTo:`${config.appUrl}/resetare`}});
  const reset=await queuedLink(account.email,"reset"),token=reset.pathname.split("/").at(-1)!;
  await query('UPDATE verification SET "expiresAt"=now()-interval \'1 second\' WHERE identifier=$1',[`reset-password:${token}`]);
  await assert.rejects(auth.api.resetPassword({body:{token,newPassword:password}}));
});

test("unverified/suspended members cannot bypass domain or session restrictions",async()=>{
  const unverified=await fixtureMember({verified:false}),suspended=await fixtureMember({status:"SUSPENDED"}),minor=await fixtureMember({adult:false});
  for(const actor of [unverified,suspended,minor]) {
    await assert.rejects(requestLibrary(actor,{countryCode:"RO",locality:`Test ${randomUUID()}`,explanation:"Synthetic integration request."}));
    assert.throws(()=>verified(actor));
  }
  const account=await verifiedAccount();const session=await login(account.email);const actor=await actorFrom(session.headers);assert.ok(actor);
  await query("UPDATE members SET status='SUSPENDED' WHERE id=$1",[account.user.id]);
  await assert.rejects(login(account.email));
  const nowRestricted=await actorFrom(session.headers);assert.ok(nowRestricted);assert.equal(nowRestricted.active,false);assert.throws(()=>verified(nowRestricted));
});

test("ordinary members cannot call admin transitions or write role fields through authentication",async()=>{
  const member=await fixtureMember();assert.throws(()=>admin(member));
  await assert.rejects(decideLibrary(member,{id:randomUUID()},"APPROVED"));
  const account=await verifiedAccount(),signed=await login(account.email);await actorFrom(signed.headers);
  const updated=await POST(request("/update-user",{role:"ADMIN",twoFactorEnabled:true,name:"Cititor de test"},signed.headers));
  // Unknown security-sensitive fields may be ignored or rejected; they must never elevate.
  assert.ok([200,400,422].includes(updated.status));
  const record=(await query('SELECT m.role,u."twoFactorEnabled" FROM members m JOIN "user" u ON u.id=m.id WHERE m.id=$1',[account.user.id])).rows[0];
  assert.equal(record.role,"MEMBER");assert.equal(record.twoFactorEnabled,false);
});

test("auth wrapper rejects foreign origins, oversized/malformed bodies and external avatars",async()=>{
  const origin=await POST(new Request(`${config.appUrl}/api/auth/sign-in/email`,{method:"POST",headers:{origin:"https://foreign.example.invalid","content-type":"application/json"},body:"{}"}));assert.equal(origin.status,403);
  const huge=await POST(request("/sign-in/email",{email:"x".repeat(40000)}));assert.equal(huge.status,413);
  const malformed=await POST(new Request(`${config.appUrl}/api/auth/sign-in/email`,{method:"POST",headers:{origin:config.appUrl,"content-type":"application/json"},body:"null"}));assert.equal(malformed.status,400);
  const photo=await POST(request("/sign-up/email",{name:"Test",email:newEmail(),password,image:"https://external.example.invalid/avatar.jpg"}));assert.equal(photo.status,400);
  for(const path of ["/get-access-token","/refresh-token","/account-info","/delete-user"]) assert.equal((await POST(request(path,{}))).status,404);
});

test("browser auth responses omit bearer/provider tokens and revoke only an owned session identifier",async()=>{
  const account=await verifiedAccount(),first=await login(account.email),second=await login(account.email);
  const current=await auth.api.getSession({headers:first.headers}),other=await auth.api.getSession({headers:second.headers});assert.ok(current&&other);
  const sessionResponse=await GET(new Request(`${config.appUrl}/api/auth/get-session`,{headers:first.headers}));assert.equal(sessionResponse.status,200);
  const safeSession=await sessionResponse.json();assert.equal(safeSession.session.id,current.session.id);assert.equal(safeSession.session.token,undefined);assert.equal(safeSession.session.ipAddress,undefined);assert.equal(safeSession.session.userAgent,undefined);
  const list=await GET(new Request(`${config.appUrl}/api/auth/list-sessions`,{headers:first.headers}));assert.equal(list.status,200);
  const safeList=await list.json();assert.ok(safeList.length>=2);for(const entry of safeList) {assert.equal(entry.token,undefined);assert.equal(entry.ipAddress,undefined);assert.equal(entry.userAgent,undefined);}
  assert.equal((await POST(request("/revoke-session",{token:second.response.token},first.headers))).status,400);
  const stranger=await verifiedAccount(),strangerLogin=await login(stranger.email),strangerSession=await auth.api.getSession({headers:strangerLogin.headers});assert.ok(strangerSession);
  assert.equal((await POST(request("/revoke-session",{sessionId:strangerSession.session.id},first.headers))).status,404);
  assert.ok(await auth.api.getSession({headers:strangerLogin.headers}));
  assert.equal((await POST(request("/revoke-session",{sessionId:other.session.id},first.headers))).status,200);
  assert.equal(await auth.api.getSession({headers:second.headers}),null);assert.ok(await auth.api.getSession({headers:first.headers}));
});

function authenticatorCode(uri:string) {
  const parameters=new URL(uri).searchParams,alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const encoded=parameters.get("secret")!.toUpperCase().replace(/=+$/,"");let bits="";
  for(const character of encoded) {const index=alphabet.indexOf(character);assert.ok(index>=0);bits+=index.toString(2).padStart(5,"0");}
  const bytes:number[]=[];for(let offset=0;offset+8<=bits.length;offset+=8) bytes.push(Number.parseInt(bits.slice(offset,offset+8),2));
  const period=Number(parameters.get("period")??30),digits=Number(parameters.get("digits")??6),counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/1000/period)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)!&15;
  return ((digest.readUInt32BE(offset)&0x7fffffff)%10**digits).toString().padStart(digits,"0");
}
test("supported TOTP enrollment requires a valid factor, creates session step-up and protects admin disabling",async()=>{
  const account=await verifiedAccount(),signed=await login(account.email);await actorFrom(signed.headers);
  const enabled=await POST(request("/two-factor/enable",{password,method:"totp"},signed.headers));assert.equal(enabled.status,200);
  const setup=await enabled.json();assert.match(setup.totpURI,/^otpauth:\/\/totp\//);assert.ok(Array.isArray(setup.backupCodes)&&setup.backupCodes.length>0);
  assert.equal((await query('SELECT "twoFactorEnabled" FROM "user" WHERE id=$1',[account.user.id])).rows[0].twoFactorEnabled,false);
  assert.equal((await POST(request("/two-factor/verify-totp",{code:"invalid"},signed.headers))).status,401);
  const verifiedFactor=await POST(request("/two-factor/verify-totp",{code:authenticatorCode(setup.totpURI)},signed.headers));assert.equal(verifiedFactor.status,200);
  const replacement=cookieHeaders(verifiedFactor.headers),session=await auth.api.getSession({headers:replacement});assert.ok(session);assert.equal(session.user.twoFactorEnabled,true);
  assert.equal((await query('SELECT verified FROM "twoFactor" WHERE "userId"=$1',[account.user.id])).rows[0].verified,true);
  const stepUp=await POST(request("/two-factor/verify-totp",{code:authenticatorCode(setup.totpURI)},replacement));assert.equal(stepUp.status,200);assert.equal(await hasAdminStepUp(account.user.id,session.session.id),true);
  await query("UPDATE members SET role='ADMIN' WHERE id=$1",[account.user.id]);
  assert.equal((await POST(request("/two-factor/disable",{password},replacement))).status,403);
  await auth.api.signOut({headers:replacement});
  const challenge=await auth.api.signInEmail({body:{email:account.email,password},returnHeaders:true});assert.equal((challenge.response as {twoFactorRedirect?:boolean}).twoFactorRedirect,true);assert.equal(await auth.api.getSession({headers:cookieHeaders(challenge.headers)}),null);
  const completed=await auth.api.verifyTOTP({headers:cookieHeaders(challenge.headers),body:{code:authenticatorCode(setup.totpURI)},returnHeaders:true});assert.ok(await auth.api.getSession({headers:cookieHeaders(completed.headers)}));
});

test("Google missing configuration, forged client tokens and uncorrelated callbacks fail closed",async()=>{
  assert.equal(config.googleEnabled,false,"The routine harness disables real Google configuration.");
  const missing=await POST(request("/sign-in/social",{provider:"google",callbackURL:`${config.appUrl}/cont`}));assert.ok(missing.status>=400);
  const forged=await POST(request("/sign-in/social",{provider:"google",idToken:{token:"forged-synthetic-jwt"}}));assert.equal(forged.status,400);
  const scope=await POST(request("/sign-in/social",{provider:"google",scopes:["https://www.googleapis.com/auth/gmail.readonly"]}));assert.equal(scope.status,400);
  const callback=await GET(new Request(`${config.appUrl}/api/auth/callback/google?code=synthetic-code&state=uncorrelated-state`));
  assert.ok(callback.status>=300);assert.equal((await query("SELECT count(*)::int n FROM account WHERE \"providerId\"='google'")).rows[0].n,0);
});

test("authentication request flooding is rate-limited with generic Romanian errors",async()=>{
  let limited=false;
  for(let attempt=0;attempt<config.authRateLimit+2;attempt++) {
    const response=await POST(request("/sign-in/email",{email:"rate-test@example.invalid",password:"Incorrect-synthetic-password-90!"}));
    const body=await response.json();assert.ok(typeof body.message==="string");assert.ok(!body.message.includes("rate-test@example.invalid"));
    if(response.status===429) {assert.match(body.message,/Prea multe încercări/);limited=true;break;}
    assert.equal(response.status,401);
  }
  assert.equal(limited,true);
});

// These tests mock ONLY the provider exchange/profile boundary. The real Better Auth
// state/cookies, database, account linking and callback handling execute locally.
// They do not verify Google signatures, a real client, or delivery to real Google.
async function googleContract(email:string, subject:string, verifiedEmail=true, overrides:Partial<AppConfig>={}) {
  const instance=createAuth({...config,...overrides,googleEnabled:true,googleClientId:"synthetic-client.apps.googleusercontent.com",googleClientSecret:"synthetic-contract-secret"});
  const context=await instance.$context;
  const provider=context.socialProviders.find(value=>value.id==="google");assert.ok(provider);
  let exchanges=0;
  provider.validateAuthorizationCode=async ({code,codeVerifier,redirectURI})=>{
    exchanges++;assert.equal(code,"synthetic-approved-code");assert.ok(codeVerifier);assert.equal(redirectURI,`${config.appUrl}/api/auth/callback/google`);
    return {accessToken:"synthetic-provider-access-token",scopes:["openid","email","profile"]};
  };
  provider.getUserInfo=async ()=>({user:{name:"Google test",email,emailVerified:verifiedEmail,image:"https://external.example.invalid/google-picture.jpg"},data:{sub:subject,email,email_verified:verifiedEmail}});
  async function callback(flow:{headers:Headers;response:{url?:string|null}}) {
    const authorization=new URL(flow.response.url!);const state=authorization.searchParams.get("state");assert.ok(state);
    assert.equal(authorization.searchParams.get("redirect_uri"),`${config.appUrl}/api/auth/callback/google`);
    const scopes=new Set(authorization.searchParams.get("scope")!.split(" "));assert.deepEqual(scopes,new Set(["openid","email","profile"]));
    assert.ok(authorization.searchParams.get("code_challenge"));
    return instance.handler(new Request(`${config.appUrl}/api/auth/callback/google?code=synthetic-approved-code&state=${encodeURIComponent(state)}`,{headers:cookieHeaders(flow.headers)}));
  }
  return {instance,callback,exchanges:()=>exchanges};
}

test("Google contract: same-email account is never silently merged; explicit proven-control linking works",async()=>{
  const local=await verifiedAccount(),subject=`mock-sub-${randomUUID()}`,provider=await googleContract(local.email,subject);
  const flow=await provider.instance.api.signInSocial({body:{provider:"google",callbackURL:`${config.appUrl}/cont`},returnHeaders:true});
  const rejected=await provider.callback(flow);assert.equal(provider.exchanges(),1);assert.match(rejected.headers.get("location")??"",/account_not_linked/i);
  assert.equal((await query('SELECT count(*)::int n FROM account WHERE "providerId"=\'google\' AND "accountId"=$1',[subject])).rows[0].n,0);
  const signed=await login(local.email);
  const anonymous=await POST(request("/link-social",{provider:"google",callbackURL:`${config.appUrl}/cont`}));assert.equal(anonymous.status,403);
  const staleSession=await auth.api.getSession({headers:signed.headers});assert.ok(staleSession);
  await query('UPDATE session SET "createdAt"=now()-interval \'11 minutes\' WHERE id=$1',[staleSession.session.id]);
  assert.equal((await POST(request("/link-social",{provider:"google",callbackURL:`${config.appUrl}/cont`},signed.headers))).status,403);
  const fresh=await login(local.email);
  const link=await provider.instance.api.linkSocialAccount({headers:fresh.headers,body:{provider:"google",callbackURL:`${config.appUrl}/cont`},returnHeaders:true});
  const linked=await provider.callback(link);assert.ok(linked.status>=300&&linked.status<400);
  const account=(await query('SELECT "userId","accountId",password,"accessToken" FROM account WHERE "providerId"=\'google\' AND "accountId"=$1',[subject])).rows[0];
  assert.equal(account.userId,local.user.id);assert.equal(account.accountId,subject);assert.equal(account.password,null);assert.notEqual(account.accessToken,"synthetic-provider-access-token");
  assert.equal((await query('SELECT image FROM "user" WHERE id=$1',[local.user.id])).rows[0].image,null);
  // Local password identity is preserved; Google did not invent or replace a password.
  assert.ok((await login(local.email)).response.token);
});

test("Google contract: new verified identity uses provider subject and no password/avatar; unverified claim has no session",async()=>{
  for(const confirmed of [true,false]) {
    const email=newEmail(),subject=`mock-sub-${randomUUID()}`,provider=await googleContract(email,subject,confirmed);
    const flow=await provider.instance.api.signInSocial({body:{provider:"google",callbackURL:`${config.appUrl}/cont`},returnHeaders:true});
    const result=await provider.callback(flow);
    const user=(await query('SELECT id,image,"emailVerified" FROM "user" WHERE email=$1',[email])).rows[0];
    assert.ok(user);assert.equal(user.image,null);assert.equal(user.emailVerified,confirmed);
    const account=(await query('SELECT "userId",password FROM account WHERE "providerId"=\'google\' AND "accountId"=$1',[subject])).rows[0];assert.equal(account.userId,user.id);assert.equal(account.password,null);
    if(confirmed) assert.ok(await provider.instance.api.getSession({headers:cookieHeaders(result.headers)}));
    else {assert.match(result.headers.get("location")??"",/email_not_verified/);assert.equal((await query('SELECT count(*)::int n FROM session WHERE "userId"=$1',[user.id])).rows[0].n,0);}
  }
});

test("Google contract: state replay/foreign state cannot exchange code or create another account",async()=>{
  const provider=await googleContract(newEmail(),`mock-sub-${randomUUID()}`);
  const flow=await provider.instance.api.signInSocial({body:{provider:"google",callbackURL:`${config.appUrl}/cont`},returnHeaders:true});
  const state=new URL(flow.response.url!).searchParams.get("state")!;
  const missingCookies=await provider.instance.handler(new Request(`${config.appUrl}/api/auth/callback/google?code=synthetic-approved-code&state=${encodeURIComponent(state)}`));assert.ok(missingCookies.status>=300);assert.equal(provider.exchanges(),0);
  // A failed state request may consume state. Create another real correlated flow.
  const second=await provider.instance.api.signInSocial({body:{provider:"google",callbackURL:`${config.appUrl}/cont`},returnHeaders:true});
  await provider.callback(second);assert.equal(provider.exchanges(),1);
  await provider.callback(second);assert.equal(provider.exchanges(),1,"Consumed state must not allow another code exchange.");
});

test("registration disabled admits only the configured verified Google bootstrap identity without elevating it",async()=>{
  const owner=newEmail(),closed=createAuth({...config,registrationEnabled:false,adminBootstrapEmail:owner});
  // Better Auth intentionally returns an enumeration-safe synthetic response
  // when the creation hook rejects. Assert the durable boundary, not rejection.
  for (const email of [newEmail(),owner]) {
    const denied=await closed.api.signUpEmail({body:{name:"Test",email,password}});
    assert.equal(denied.token,null);
    assert.equal((await query('SELECT count(*)::int n FROM "user" WHERE email=$1',[email])).rows[0].n,0);
    assert.equal((await query("SELECT count(*)::int n FROM jobs WHERE type='auth_email' AND payload->>'to'=$1",[email])).rows[0].n,0);
  }
  const unproven=await googleContract(owner,`mock-unverified-${randomUUID()}`,false,{registrationEnabled:false,adminBootstrapEmail:owner});
  const deniedFlow=await unproven.instance.api.signInSocial({body:{provider:"google",callbackURL:`${config.appUrl}/cont`},returnHeaders:true});await unproven.callback(deniedFlow);
  assert.equal((await query('SELECT count(*)::int n FROM "user" WHERE email=$1',[owner])).rows[0].n,0);
  const provider=await googleContract(owner,`mock-verified-${randomUUID()}`,true,{registrationEnabled:false,adminBootstrapEmail:owner});
  const flow=await provider.instance.api.signInSocial({body:{provider:"google",callbackURL:`${config.appUrl}/cont`},returnHeaders:true});const callback=await provider.callback(flow);
  const actor=await actorFrom(cookieHeaders(callback.headers));assert.ok(actor);assert.equal(actor.role,"MEMBER");assert.equal(actor.adult,false);assert.throws(()=>admin(actor));
  assert.equal((await query("SELECT count(*)::int n FROM admin_bootstrap")).rows[0].n,0);
});

test("production registration requires eight published policies and secure cookies",async()=>{
  const settings={...config,environment:"production" as const,appUrl:"https://library.example.invalid",registrationEnabled:true,mailMode:"smtp" as const,smtpHost:"smtp.example.invalid",smtpFrom:"test@example.invalid"};
  const production=createAuth(settings);const email=newEmail();
  const denied=await production.api.signUpEmail({body:{name:"Test",email,password}});
  assert.equal(denied.token,null);
  assert.equal((await query('SELECT count(*)::int n FROM "user" WHERE email=$1',[email])).rows[0].n,0);
  const slugs=["termeni","confidentialitate","cookie-uri","reguli-comunitate","siguranta","imprumuturi-daruri","raportare-contestatii","operator-contact"];
  const ids:string[]=[];
  try {
    for(const slug of slugs) ids.push((await query("INSERT INTO legal_documents(slug,version,title,body,is_draft,published_at) VALUES($1,900,'Synthetic test policy','Synthetic test text; no legal approval.',false,now()) RETURNING id",[slug])).rows[0].id);
    const signup=await production.api.signUpEmail({body:{name:"Test",email,password}});assert.equal(signup.token,null);
    // The actual durable queue boundary is used; SMTP transport is never executed.
    const queued=(await query("SELECT payload FROM jobs WHERE type='auth_email' AND payload->>'to'=$1",[email])).rows[0];assert.ok(queued);assert.equal(new URL(queued.payload.url).origin,settings.appUrl);
    const token=new URL(queued.payload.url).searchParams.get("token")!;await production.api.verifyEmail({query:{token}});
    const login=await production.api.signInEmail({body:{email,password},returnHeaders:true});
    assert.ok(login.headers.getSetCookie().some(value=>/Secure/i.test(value)&&/HttpOnly/i.test(value)&&/SameSite=Lax/i.test(value)));
  } finally {await query("DELETE FROM legal_documents WHERE id=ANY($1::uuid[])",[ids]);}
});

test("admin step-up is bound to one session and expires/revokes with that session",async()=>{
  const account=await verifiedAccount(),first=await login(account.email),second=await login(account.email);
  const one=await auth.api.getSession({headers:first.headers}),two=await auth.api.getSession({headers:second.headers});assert.ok(one&&two);
  assert.equal(await hasAdminStepUp(account.user.id,one.session.id),false);
  await query("INSERT INTO auth_stepups(session_id,user_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')",[one.session.id,account.user.id]);
  assert.equal(await hasAdminStepUp(account.user.id,one.session.id),true);assert.equal(await hasAdminStepUp(account.user.id,two.session.id),false);
  await query("UPDATE auth_stepups SET expires_at=now()-interval '1 minute' WHERE session_id=$1",[one.session.id]);assert.equal(await hasAdminStepUp(account.user.id,one.session.id),false);
  await auth.api.signOut({headers:first.headers});assert.equal((await query("SELECT 1 FROM auth_stepups WHERE session_id=$1",[one.session.id])).rowCount,0);
});


test("shared readiness excludes draft/future/unknown policies and requires an actual verified adult admin factor",async()=>{
  const before=await databaseLaunchChecks(),member=await fixtureMember({role:"ADMIN",verified:true,adult:true}),ids:string[]=[];
  try {
    await query('UPDATE "user" SET "twoFactorEnabled"=true WHERE id=$1',[member.id]);
    assert.equal((await databaseLaunchChecks()).verifiedAdministrators,before.verifiedAdministrators);
    await query(`INSERT INTO "twoFactor"(id,secret,"backupCodes","userId",verified) VALUES($1,'synthetic-not-a-production-secret','synthetic-codes',$2,false)`,[randomUUID(),member.id]);
    assert.equal((await databaseLaunchChecks()).verifiedAdministrators,before.verifiedAdministrators);
    await query('UPDATE "twoFactor" SET verified=true WHERE "userId"=$1',[member.id]);
    assert.equal((await databaseLaunchChecks()).verifiedAdministrators,before.verifiedAdministrators+1);
    await query("UPDATE members SET adult=false WHERE id=$1",[member.id]);
    assert.equal((await databaseLaunchChecks()).verifiedAdministrators,before.verifiedAdministrators);
    await query("UPDATE members SET adult=true,status='SUSPENDED' WHERE id=$1",[member.id]);
    assert.equal((await databaseLaunchChecks()).verifiedAdministrators,before.verifiedAdministrators);
    await query("UPDATE members SET status='ACTIVE' WHERE id=$1",[member.id]);
    await query('UPDATE "user" SET "emailVerified"=false WHERE id=$1',[member.id]);
    assert.equal((await databaseLaunchChecks()).verifiedAdministrators,before.verifiedAdministrators);
    for(const slug of initialPolicySlugs) ids.push((await query("INSERT INTO legal_documents(slug,version,title,body,is_draft,published_at) VALUES($1,902,'Synthetic readiness policy','Synthetic isolated policy; no legal approval.',true,now()) RETURNING id",[slug])).rows[0].id);
    ids.push((await query("INSERT INTO legal_documents(slug,version,title,body,is_draft,published_at) VALUES($1,1,'Synthetic unknown policy','Synthetic isolated policy; no legal approval.',false,now()) RETURNING id",[`unknown-${randomUUID()}`])).rows[0].id);
    assert.equal((await databaseLaunchChecks()).publishedPolicies,before.publishedPolicies);
    await query("UPDATE legal_documents SET is_draft=false,published_at=now()+interval '1 day' WHERE id=ANY($1::uuid[])",[ids.slice(0,8)]);
    assert.equal((await databaseLaunchChecks()).publishedPolicies,before.publishedPolicies);
    await query("UPDATE legal_documents SET published_at=now() WHERE id=ANY($1::uuid[])",[ids.slice(0,8)]);
    assert.equal((await databaseLaunchChecks()).publishedPolicies,8);
    const readiness=await launchReadiness();assert.equal(readiness.readyForPublicLaunch,false);assert.ok(readiness.blockers.length>0,"Test environment is never ready for a public launch.");
  } finally {
    await query("DELETE FROM legal_documents WHERE id=ANY($1::uuid[])",[ids]);
    await query('DELETE FROM "twoFactor" WHERE "userId"=$1',[member.id]);
  }
});
