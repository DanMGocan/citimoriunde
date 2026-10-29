import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeAuthResponse, authSuccessMessage } from "../../src/lib/auth-response.ts";
import { authEmailCopy, notificationEmailCopy } from "../../src/lib/auth-copy.ts";
test("browser session projection retains identifiers while removing bearer tokens and connection metadata",()=>{
  const result=sanitizeAuthResponse({token:"synthetic-session-secret",session:{id:"session-id",token:"synthetic-bearer",ipAddress:"synthetic-ip",userAgent:"synthetic-agent",expiresAt:"2030-01-01"},user:{id:"member-id",name:"Cititor",emailVerified:true}});
  assert.deepEqual(result,{session:{id:"session-id",expiresAt:"2030-01-01"},user:{id:"member-id",name:"Cititor",emailVerified:true}});
});
test("nested account arrays cannot expose provider tokens or password hashes",()=>{
  const result=sanitizeAuthResponse([{id:"provider-id",providerId:"google",accessToken:"synthetic-access",refreshToken:"synthetic-refresh",idToken:"synthetic-id",passwordHash:"synthetic-hash",nested:{access_token:"synthetic-access",refresh_token:"synthetic-refresh",id_token:"synthetic-id",password:"synthetic-password",scopes:["openid","email","profile"]}}]);
  assert.deepEqual(result,[{id:"provider-id",providerId:"google",nested:{scopes:["openid","email","profile"]}}]);
});
test("sanitization does not mutate server records or remove protected factor setup material",()=>{
  const server={token:"synthetic-server-secret",totpURI:"otpauth://totp/test?secret=SYNTHETIC",backupCodes:["synthetic-recovery"],user:{id:"member-id"}};const result=sanitizeAuthResponse(server);
  assert.equal(server.token,"synthetic-server-secret");assert.deepEqual(result,{totpURI:server.totpURI,backupCodes:server.backupCodes,user:server.user});assert.equal(sanitizeAuthResponse(null),null);
});
test("authentication success messages are Romanian and enumeration-safe",()=>{
  assert.match(authSuccessMessage("/api/auth/request-password-reset"),/^Dacă adresa există/);assert.match(authSuccessMessage("/api/auth/send-verification-email"),/confirmată/);assert.match(authSuccessMessage("/api/auth/change-email"),/schimbarea adresei/);assert.equal(authSuccessMessage("/api/auth/unknown"),"Operațiunea a fost finalizată.");
});
test("Romanian email templates use configured branding and exclude private message contents",()=>{
  const verification=authEmailCopy("Nume de test","https://library.invalid/confirmare",false),reset=authEmailCopy("Nume de test","https://library.invalid/resetare",true),notification=notificationEmailCopy("Nume de test","https://library.invalid");
  assert.match(verification.subject,/Nume de test/);assert.match(verification.text,/Confirmă adresa/);assert.match(reset.text,/resetarea parolei/);assert.match(notification.text,/\/notificari/);assert.match(notification.text,/\/cont/);assert.match(notification.text,/nu este trimis prin email/);
});
