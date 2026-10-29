import {roDomain} from '../domain/ro.ts';
import {mkdir,writeFile,readFile,unlink,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {config} from './config';
import {ensure} from '../domain/errors.ts';
export interface ImageStorage {put(key:string,width:number,data:Buffer):Promise<void>;read(key:string,width:number):Promise<Buffer>;remove(key:string,width:number):Promise<void>;}
function valid(key:string,width:number){ensure(/^[a-f0-9]{32}$/.test(key)&&[320,640,1200].includes(width),'INVALID_IMAGE',roDomain.r707f6f7330,404);}
class LocalStorage implements ImageStorage {
 async put(key:string,width:number,data:Buffer){valid(key,width);await mkdir(config.storagePath,{recursive:true,mode:0o750});await writeFile(join(config.storagePath,`${key}-${width}.webp`),data,{mode:0o640,flag:'wx'});}
 async read(key:string,width:number){valid(key,width);return readFile(join(config.storagePath,`${key}-${width}.webp`));}
 async remove(key:string,width:number){valid(key,width);await unlink(join(config.storagePath,`${key}-${width}.webp`)).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});}
}
class S3Storage implements ImageStorage {
 private async client(){ensure(config.s3Endpoint&&config.s3Bucket&&config.s3AccessKey&&config.s3SecretKey,'STORAGE_UNAVAILABLE',roDomain.r76a68b3dba,503);const sdk=await import('@aws-sdk/client-s3');return {sdk,client:new sdk.S3Client({endpoint:config.s3Endpoint,region:config.s3Region||'auto',forcePathStyle:true,credentials:{accessKeyId:config.s3AccessKey,secretAccessKey:config.s3SecretKey}})};}
 async put(key:string,width:number,data:Buffer){valid(key,width);const {sdk,client}=await this.client();await client.send(new sdk.PutObjectCommand({Bucket:config.s3Bucket,Key:`images/${key}-${width}.webp`,Body:data,ContentType:'image/webp',CacheControl:'private, max-age=300'}));}
 async read(key:string,width:number){valid(key,width);const {sdk,client}=await this.client();const r=await client.send(new sdk.GetObjectCommand({Bucket:config.s3Bucket,Key:`images/${key}-${width}.webp`}));ensure(r.Body,'NOT_FOUND',roDomain.r051370eb08,404);return Buffer.from(await r.Body.transformToByteArray());}
 async remove(key:string,width:number){valid(key,width);const {sdk,client}=await this.client();await client.send(new sdk.DeleteObjectCommand({Bucket:config.s3Bucket,Key:`images/${key}-${width}.webp`}));}
}
export const imageStorage:ImageStorage=config.storageDriver==='s3'?new S3Storage():new LocalStorage();
export async function orphanKeys():Promise<string[]>{if(config.storageDriver!=='local')return [];const files=await readdir(config.storagePath).catch(()=>[]);const old:string[]=[];for(const f of files){const m=/^([a-f0-9]{32})-(320|640|1200)\.webp$/.exec(f);if(m&&(await stat(join(config.storagePath,f))).mtimeMs<Date.now()-86400000)old.push(m[1]);}return [...new Set(old)];}
