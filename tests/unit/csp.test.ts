import test from 'node:test';
import assert from 'node:assert/strict';
import {contentSecurityPolicy} from '../../src/domain/csp.ts';
const nonce='X9NU4EZn5Gc3bKp4lVm8wRq2Sn7HyBt1';
const directive=(policy:string,name:string)=>policy.split('; ').find(value=>value.startsWith(`${name} `));
test('nonce CSP denies scripts, frames and connections from third parties while publisher setup is incomplete',()=>{
 const policy=contentSecurityPolicy(nonce,'/catalog',{development:false,integrationsReady:false});
 assert.ok(policy.includes(`'nonce-${nonce}'`));assert.equal(directive(policy,'frame-src'),"frame-src 'none'");assert.equal(directive(policy,'connect-src'),"connect-src 'self'");assert.equal(directive(policy,'img-src'),"img-src 'self' data: blob:");assert.ok(!policy.includes('unsafe-eval'));
});
test('CSP permits only the requested Google stylesheet and font hosts on public and private routes',()=>{
 for(const route of ['/catalog','/cont','/mesaje']){
  const policy=contentSecurityPolicy(nonce,route,{development:false,integrationsReady:false});
  assert.equal(directive(policy,'style-src'),"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  assert.equal(directive(policy,'font-src'),"font-src 'self' https://fonts.gstatic.com");
  assert.equal(directive(policy,'default-src'),"default-src 'self'");
  assert.equal(directive(policy,'script-src'),`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
 }
});
test('strict AdSense CSP is restricted to reviewed public placements',()=>{
 const publicPolicy=contentSecurityPolicy(nonce,'/catalog',{development:false,integrationsReady:true});assert.ok(publicPolicy.includes("'strict-dynamic'"));assert.ok(publicPolicy.includes('frame-src https:'));
 for(const route of ['/mesaje','/cont','/admin/publicitate','/legal/siguranta','/imprumuturi','/sesizari']){
  const policy=contentSecurityPolicy(nonce,route,{development:false,integrationsReady:true});
  assert.equal(directive(policy,'connect-src'),"connect-src 'self'");
  assert.equal(directive(policy,'frame-src'),"frame-src 'none'");
  assert.equal(directive(policy,'img-src'),"img-src 'self' data: blob:");
  assert.ok(!policy.includes('unsafe-eval'));
 }
});
test('CSP does not accept caller-controlled directive injection',()=>{assert.throws(()=>contentSecurityPolicy("injected';script-src *",'/',{development:false,integrationsReady:false}));});
