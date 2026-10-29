import test from 'node:test';import assert from 'node:assert/strict';
import {boundedProviderJson,budgetedRetry,ProviderError} from '../../src/domain/provider-transport.ts';
test('bibliographic network boundary rejects arbitrary URLs and redirects',async()=>{
 let calls=0;const mock=(async(_url:any,init:any)=>{calls++;assert.equal(init.redirect,'error');assert.ok(init.signal);return new Response('{"items":[]}');}) as typeof fetch;
 for(const url of ['http://127.0.0.1/private','https://api.mistral.ai/other','https://openlibrary.org:444/search.json','https://user:pass@www.googleapis.com/books/v1/volumes'])await assert.rejects(boundedProviderJson(url,{},100,mock));
 assert.equal(calls,0);assert.deepEqual(await boundedProviderJson('https://openlibrary.org/search.json?q=carte',{},100,mock),{items:[]});assert.equal(calls,1);
});
test('provider response decoding is bounded and rejects malformed JSON',async()=>{
 await assert.rejects(boundedProviderJson('https://openlibrary.org/search.json',{},100,(async()=>new Response('x'.repeat(262145))) as typeof fetch));
 await assert.rejects(boundedProviderJson('https://openlibrary.org/search.json',{},100,(async()=>new Response('<html>')) as typeof fetch));
});
test('transient outage retries once after backoff and reserves both attempts',async()=>{
 let calls=0,reserved=0;const delays:number[]=[];
 const result=await budgetedRetry(async()=>{if(++calls===1)throw new ProviderError(true);return 'synthetic-result';},async()=>{reserved++;return true;},async ms=>{delays.push(ms);});assert.equal(result,'synthetic-result');assert.equal(calls,2);assert.equal(reserved,2);assert.deepEqual(delays,[250]);
});
test('exhausted budget and terminal authentication errors prevent retries',async()=>{
 let calls=0,allowance=1;
 const result=await budgetedRetry(async()=>{calls++;throw new ProviderError(true);},async()=>allowance-->0,async()=>{});assert.equal(result,null);assert.equal(calls,1);
 await assert.rejects(budgetedRetry(async()=>{calls++;throw new ProviderError(false);},async()=>true,async()=>{}));assert.equal(calls,2);
});
