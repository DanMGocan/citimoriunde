import test,{after} from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';import {readFile} from 'node:fs/promises';
import {assertIsolatedDatabase,fixtureMember,fixtureLibrary,closeTestPool} from './helpers';
import {decodeImage,uploadPhoto,deletePhoto} from '../../src/domain/images';import {addCopy} from '../../src/domain/catalogue';import {config} from '../../src/lib/config';import {imageStorage} from '../../src/lib/storage';import {query} from '../../src/lib/db';
assertIsolatedDatabase();after(closeTestPool);
test('actual decoder strips metadata, corrects orientation, never upscales and produces bounded WebP variants',async()=>{
 const original=await sharp({create:{width:800,height:400,channels:3,background:'#224e44'}}).jpeg().withMetadata({orientation:6,exif:{IFD0:{Artist:'synthetic-test',ImageDescription:'private-test'}}}).toBuffer();const variants=await decodeImage(original);assert.deepEqual(variants.map(v=>v.target),[320,640,1200]);
 for(const v of variants){const m=await sharp(v.data).metadata();assert.equal(m.format,'webp');assert.equal(m.exif,undefined);assert.equal(m.icc,undefined);assert.equal(m.orientation,undefined);assert.ok(Math.max(m.width!,m.height!)<=v.target);assert.ok(Math.max(m.width!,m.height!)<=800);assert.ok(m.height!>=m.width!);}
});
test('reject SVG, executable, malformed content, oversized input and unsafe pixel dimensions',async()=>{
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),Buffer.from('#!/bin/sh\necho unsafe'),Buffer.from('malformed')])await assert.rejects(()=>decodeImage(bytes));
 await assert.rejects(()=>decodeImage(Buffer.alloc(config.uploadMaxMb*1024*1024+1)));const huge=await sharp({create:{width:7000,height:7000,channels:3,background:'#ffffff'}}).png({compressionLevel:9}).toBuffer();await assert.rejects(()=>decodeImage(huge));
});
test('photo count quota, owner-only deletion and private pending storage are enforced',async()=>{
 const owner=await fixtureMember(),stranger=await fixtureMember(),library=await fixtureLibrary();const copy=await addCopy(owner,{libraryId:library,title:'Fotografie sintetică',authors:['Autor sintetic'],unspecified:true,condition:'good',visibility:'PRIVATE'});const bytes=await sharp({create:{width:120,height:90,channels:3,background:'#fff'}}).jpeg().toBuffer();const photo=await uploadPhoto(owner,copy.id,bytes);const row=(await query('SELECT * FROM copy_photos WHERE id=$1',[photo.id])).rows[0];assert.equal(row.state,'PENDING');assert.equal(row.storage_key.length,32);for(const width of [320,640,1200])assert.ok((await imageStorage.read(row.storage_key,width)).length>0);
 await assert.rejects(()=>deletePhoto(stranger,photo.id));await assert.rejects(()=>uploadPhoto(stranger,copy.id,bytes));for(let n=1;n<config.maxPhotos;n++)await uploadPhoto(owner,copy.id,bytes);await assert.rejects(()=>uploadPhoto(owner,copy.id,bytes));await deletePhoto(owner,photo.id);assert.equal((await query('SELECT 1 FROM copy_photos WHERE id=$1',[photo.id])).rowCount,0);
});
