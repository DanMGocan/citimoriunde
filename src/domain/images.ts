import {roDomain} from './ro.ts';
import sharp from 'sharp';
import {randomBytes} from 'node:crypto';
import {query,transaction} from '../lib/db';
import {config} from '../lib/config';
import {imageStorage} from '../lib/storage';
import {type Actor,verified,audit} from './access';
import {ensure,DomainError} from './errors.ts';
sharp.concurrency(config.imageConcurrency);sharp.cache({memory:16,files:0,items:10});
let processing=0;
export async function decodeImage(buffer:Buffer){
 ensure(buffer.length<=config.uploadMaxMb*1024*1024,'FILE_TOO_LARGE',`Fotografia depășește limita de ${config.uploadMaxMb} MB.`);
 try{
  const image=sharp(buffer,{limitInputPixels:config.uploadMaxPixels,failOn:'warning',animated:false});const meta=await image.metadata();
  ensure(meta.format&&['jpeg','png','webp','heif','avif'].includes(meta.format)&&meta.width&&meta.height&&meta.width*meta.height<=config.uploadMaxPixels&&(meta.pages??1)===1,'INVALID_IMAGE',roDomain.r004aa4341f);
  const variants=[];for(const width of [320,640,1200]){const result=await image.clone().rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true}).webp({quality:80,effort:3}).toBuffer({resolveWithObject:true});variants.push({target:width,width:result.info.width,height:result.info.height,data:result.data});}return variants;
 }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('INVALID_IMAGE',roDomain.r918ac8c7e2);}
}
export async function uploadPhoto(actor:Actor,copyId:string,buffer:Buffer){verified(actor);ensure(processing<config.imageConcurrency,'IMAGE_BUSY',roDomain.rc1b64e26da,429);processing++;const key=randomBytes(16).toString('hex');let stored=false;
 try{
  ensure((await query('SELECT 1 FROM copies WHERE id=$1 AND owner_id=$2 AND state<>\'REMOVED\'',[copyId,actor.id])).rowCount,'FORBIDDEN',roDomain.rd255e59924,403);
  const variants=await decodeImage(buffer),bytes=variants.reduce((n,v)=>n+v.data.length,0);
  return await transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['photo-quota:'+actor.id]);const copy=await c.query('SELECT * FROM copies WHERE id=$1 FOR UPDATE',[copyId]);ensure(copy.rows[0]?.owner_id===actor.id&&copy.rows[0]?.state!=='REMOVED','FORBIDDEN',roDomain.r3d45e96d09,403);
   const count=await c.query('SELECT count(*)::int n FROM copy_photos WHERE copy_id=$1',[copyId]);ensure(count.rows[0].n<config.maxPhotos,'PHOTO_LIMIT',`Poți adăuga cel mult ${config.maxPhotos} fotografii.`);const quota=await c.query('SELECT coalesce(sum(bytes),0)::bigint bytes FROM copy_photos WHERE owner_id=$1',[actor.id]);ensure(Number(quota.rows[0].bytes)+bytes<=config.uploadMemberQuotaMb*1024*1024,'PHOTO_QUOTA',roDomain.r4f2a97e766);
   stored=true;for(const v of variants)await imageStorage.put(key,v.target,v.data);
   const photo=await c.query('INSERT INTO copy_photos(copy_id,owner_id,storage_key,bytes,widths) VALUES($1,$2,$3,$4,$5) RETURNING id',[copyId,actor.id,key,bytes,variants.map(v=>v.width)]);await audit(c,actor.id,'PHOTO_UPLOADED','photo',photo.rows[0].id);return {id:photo.rows[0].id,storageKey:key,state:'PENDING'};
  });
 }catch(error){if(stored)await Promise.all([320,640,1200].map(w=>imageStorage.remove(key,w)));throw error;}
 finally{processing--;}
}
export async function deletePhoto(actor:Actor,id:string){verified(actor);return transaction(async c=>{const r=await c.query('SELECT p.*,c.owner_id current_owner FROM copy_photos p JOIN copies c ON c.id=p.copy_id WHERE p.id=$1 FOR UPDATE OF p,c',[id]);ensure(r.rowCount&&r.rows[0].current_owner===actor.id,'FORBIDDEN',roDomain.r93ebbbcefe,403);ensure(!(await c.query("SELECT 1 FROM edition_cover_submissions WHERE photo_id=$1 AND state IN ('PENDING','APPROVED')",[id])).rowCount,'COVER_IN_USE',roDomain.rc06ad6a0d5);await c.query('DELETE FROM edition_cover_submissions WHERE photo_id=$1',[id]);await c.query('DELETE FROM copy_photos WHERE id=$1',[id]);for(const w of [320,640,1200])await imageStorage.remove(r.rows[0].storage_key,w);await audit(c,actor.id,'PHOTO_DELETED','photo',id);return {ok:true};});}
