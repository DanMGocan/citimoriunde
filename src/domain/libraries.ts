import {roDomain} from './ro.ts';
import {query,transaction} from '../lib/db';
import {type Actor,verified,admin,audit,notify} from './access';
import {ensure} from './errors.ts';
import {normalize} from './normalization.ts';
import {EU_COUNTRY_CODES,isEuCountry} from './geography.ts';
const euOnlyMessage='Alege o localitate din Uniunea Europeană.';
export async function libraries(){return {libraries:(await query(`WITH member_counts AS (
  SELECT home_library_id library_id,count(*)::int member_count FROM members
  WHERE status='ACTIVE' AND home_library_id IS NOT NULL GROUP BY home_library_id
), available_counts AS (
  SELECT c.library_id,count(*)::int available_count FROM copies c
  JOIN members owner ON owner.id=c.owner_id JOIN editions e ON e.id=c.edition_id JOIN works w ON w.id=e.work_id
  WHERE c.visibility='PUBLIC' AND c.moderation_state='APPROVED' AND c.state='AVAILABLE' AND owner.status='ACTIVE' AND NOT owner.bookshelf_paused
    AND w.moderation_state='APPROVED' AND w.merged_into IS NULL GROUP BY c.library_id
)
SELECT l.id,l.name,l.display_name,l.country_code,l.region,l.rank,
  coalesce(m.member_count,0)::int member_count,coalesce(c.available_count,0)::int available_count
FROM libraries l LEFT JOIN member_counts m ON m.library_id=l.id LEFT JOIN available_counts c ON c.library_id=l.id
WHERE l.active AND l.country_code=ANY($1::text[]) ORDER BY l.rank NULLS LAST,l.display_name`,[EU_COUNTRY_CODES])).rows};}
export async function requestLibrary(actor:Actor,input:any){verified(actor);const country=String(input.countryCode??'').toUpperCase(),locality=String(input.locality??'').trim(),region=String(input.region??'').trim();ensure(/^[A-Z]{2}$/.test(country)&&locality.length>=2&&locality.length<=100&&input.explanation?.length>=10,'INVALID_REQUEST',roDomain.re3f9f4b3e1);
  ensure(isEuCountry(country),'EU_COUNTRY_REQUIRED',euOnlyMessage);
  return transaction(async c=>{
    const existing=await c.query('SELECT id,display_name FROM libraries WHERE country_code=$1 AND (city_key(name)=city_key($2) OR city_key(display_name)=city_key($2) OR EXISTS(SELECT 1 FROM unnest(aliases) alias WHERE city_key(alias)=city_key($2)))',[country,locality]);ensure(!existing.rowCount,'LIBRARY_EXISTS',roDomain.rd9edbe90a6);
    const pending=await c.query("SELECT 1 FROM library_requests WHERE country_code=$1 AND locality_key=$2 AND city_key(region)=city_key($3) AND state='PENDING'",[country,normalize(locality),region]);ensure(!pending.rowCount,'REQUEST_EXISTS',roDomain.r6c1bf9d6b3);
    const r=await c.query('INSERT INTO library_requests(requester_id,country_code,locality,locality_key,region,explanation) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[actor.id,country,locality,normalize(locality),region,input.explanation]);return {id:r.rows[0].id};});}
export async function decideLibrary(actor:Actor,input:any,decision:'APPROVED'|'REJECTED'|'LINKED'){admin(actor);return transaction(async c=>{
  const r=await c.query('SELECT * FROM library_requests WHERE id=$1 FOR UPDATE',[input.id??input.requestId]);ensure(r.rowCount,'NOT_FOUND',roDomain.r3a8c769102,404);const request=r.rows[0];
  if(request.state!=='PENDING')return {ok:true,libraryId:request.library_id};
  let libraryId=input.libraryId??null;
  if(decision==='APPROVED'||decision==='LINKED')ensure(isEuCountry(request.country_code),'EU_COUNTRY_REQUIRED',euOnlyMessage);
  if(decision==='APPROVED'){
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[request.country_code+request.locality_key+normalize(request.region)]);
    const existing=await c.query('SELECT id,active FROM libraries WHERE country_code=$1 AND city_key(name)=city_key($2) AND coalesce(city_key(region),\'\')=city_key($3)',[request.country_code,request.locality,request.region]);
    if(existing.rowCount){ensure(existing.rows[0].active,'INVALID_LIBRARY',roDomain.r8e89f133b6);libraryId=existing.rows[0].id;}
    else libraryId=(await c.query('INSERT INTO libraries(name,display_name,country_code,region) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[request.locality,input.displayName??request.locality,request.country_code,request.region])).rows[0]?.id;
    ensure(libraryId,'APPROVAL_CONFLICT',roDomain.r1c093d591d);
  }
  if(decision==='LINKED')ensure((await c.query('SELECT 1 FROM libraries WHERE id=$1 AND active AND country_code=ANY($2::text[])',[libraryId,EU_COUNTRY_CODES])).rowCount,'INVALID_LIBRARY',roDomain.r8e89f133b6);
  if(decision==='REJECTED')ensure(input.reason?.length>=10,'REASON_REQUIRED',roDomain.ra57bab114b);
  await c.query('UPDATE library_requests SET state=$2,library_id=$3,reason=$4,decided_at=now() WHERE id=$1',[request.id,decision,libraryId,input.reason??null]);
  await notify(c,request.requester_id,'library',roDomain.r6e481780f1,libraryId?'/biblioteci/'+libraryId:'/biblioteci','library:'+request.id+':'+decision);
  await audit(c,actor.id,'LIBRARY_'+decision,'library_request',request.id,input.reason);return {ok:true,libraryId};});}
