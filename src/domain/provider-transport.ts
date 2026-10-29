import {setTimeout as pause} from 'node:timers/promises';
const paths:Record<string,string>={'www.googleapis.com':'/books/v1/volumes','openlibrary.org':'/search.json','api.mistral.ai':'/v1/chat/completions'};
export class ProviderError extends Error{constructor(public retryable:boolean){super('Bibliographic provider unavailable.');}}
export async function boundedProviderJson(url:string,options:RequestInit={},timeout=4000,fetcher:typeof fetch=fetch){
 const target=new URL(url);
 if(target.protocol!=='https:'||target.username||target.password||target.port||paths[target.hostname]!==target.pathname)throw new ProviderError(false);
 let response:Response;
 try{response=await fetcher(target.href,{...options,redirect:'error',signal:AbortSignal.timeout(timeout)});}catch{throw new ProviderError(true);}
 if(!response.ok)throw new ProviderError([429,500,502,503,504].includes(response.status));
 const reader=response.body?.getReader();if(!reader)throw new ProviderError(false);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw new ProviderError(false);}chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError(false);}
}
// Every attempt reserves its own request/spending allowance. A retry never gets
// around either cap; authentication/schema/oversized-output errors are terminal.
export async function budgetedRetry<T>(request:()=>Promise<T>,reserve:()=>Promise<boolean>,delay:(ms:number)=>Promise<unknown>=pause):Promise<T|null>{
 for(let attempt=0;attempt<2;attempt++){
  if(!await reserve())return null;
  try{return await request();}catch(error){if(attempt===1||!(error instanceof ProviderError)||!error.retryable)throw error;await delay(250);}
 }return null;
}
