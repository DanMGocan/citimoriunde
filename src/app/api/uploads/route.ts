import {actorFrom,verified,rateLimit} from '@/domain/access';
import {uploadPhoto} from '@/domain/images';
import {config} from '@/lib/config';
import {DomainError} from '@/domain/errors.ts';
export const runtime='nodejs';
let uploadsInFlight=0;
export async function POST(request:Request){let admitted=false;try{
 if(request.headers.get('origin')!==config.appUrl)return Response.json({error:'Cererea nu provine din aplicație.'},{status:403});
 const actor=await actorFrom(request.headers);verified(actor);await rateLimit('upload:'+actor.id,10,3600);
 if(uploadsInFlight>=config.imageConcurrency)return Response.json({error:'Se procesează o fotografie. Încearcă din nou în câteva secunde.'},{status:429,headers:{'Retry-After':'5'}});
 uploadsInFlight++;admitted=true;
 const max=(config.uploadMaxMb+1)*1024*1024;let received=0;const reader=request.body?.getReader();if(!reader)return Response.json({error:'Alege o fotografie.'},{status:400});const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;received+=value.length;if(received>max){await reader.cancel();return Response.json({error:`Fotografia depășește limita de ${config.uploadMaxMb} MB.`},{status:413});}chunks.push(value);}
 const multipart=new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')??''},body:Buffer.concat(chunks)});const form=await multipart.formData();const file=form.get('file'),copyId=String(form.get('copyId')??'');
 if(!(file instanceof File)||!/^[a-f0-9-]{36}$/i.test(copyId))return Response.json({error:'Alege fotografia și exemplarul.'},{status:400});
 return Response.json(await uploadPhoto(actor,copyId,Buffer.from(await file.arrayBuffer())));
 }catch(e){return Response.json({error:e instanceof DomainError?e.message:'Fotografia nu a putut fi încărcată. Încearcă din nou.',code:e instanceof DomainError?e.code:'UPLOAD_FAILED'},{status:e instanceof DomainError?e.status:400});}finally{if(admitted)uploadsInFlight--;}}
