import {roDomain} from './ro.ts';
import { query,transaction } from '../lib/db';
import { config } from '../lib/config';
import { type Actor,verified,moderate,audit } from './access';
import { ensure } from './errors.ts';
import { type Candidate,authorKey,normalize,isbnCanonical,editionFingerprint,candidateConfidence } from './normalization.ts';
import { award,lockRewards } from './reputation';
import {canonicalWork} from './catalogue-work';
type CatalogueSearchRow=Candidate&{
  genre:string;
  audience:string;
  description:string;
  ads_eligible:boolean;
  edition_count:number;
  copy_count:number;
  available_count:number;
  cover_url:string|null;
  total:number;
};
export async function searchCatalogue(q='',library:string|null=null,page=1,filters:Record<string,string>={}){
  const key=normalize(q).slice(0,300),isbn=(()=>{try{return isbnCanonical(q)}catch{return null}})();
  const words=key.split(' ').filter(Boolean).map(w=>`%${w}%`);
  const {rows}=await query<CatalogueSearchRow>(`SELECT w.id,w.title,w.authors,w.genre,w.audience,w.description,(w.reviewed_at IS NOT NULL) ads_eligible,
    (SELECT count(*)::int FROM editions e WHERE e.work_id=w.id) edition_count,
    count(DISTINCT c.id)::int copy_count,count(DISTINCT c.id) FILTER(WHERE c.state='AVAILABLE' AND NOT m.bookshelf_paused)::int available_count,
    (SELECT '/api/images/'||cover_key||'/640' FROM editions ce WHERE ce.work_id=w.id AND ce.cover_state='APPROVED' AND ce.cover_key IS NOT NULL LIMIT 1) cover_url, count(*) OVER()::int total
    FROM works w LEFT JOIN editions e ON e.work_id=w.id LEFT JOIN copies c ON c.edition_id=e.id AND c.visibility='PUBLIC' AND c.moderation_state='APPROVED' AND c.state<>'REMOVED'
      AND EXISTS(SELECT 1 FROM members visible_owner WHERE visible_owner.id=c.owner_id AND visible_owner.status='ACTIVE' AND NOT visible_owner.bookshelf_paused)
      AND EXISTS(SELECT 1 FROM libraries visible_library WHERE visible_library.id=c.library_id AND visible_library.active)
      LEFT JOIN members m ON m.id=c.owner_id
    WHERE w.merged_into IS NULL AND w.moderation_state='APPROVED'
    AND ($1='' OR w.search_key LIKE ALL($2::text[]) OR EXISTS(SELECT 1 FROM work_aliases a WHERE a.work_id=w.id AND a.alias_key LIKE ALL($2::text[])) OR e.isbn=$3)
    AND ($4::uuid IS NULL OR c.library_id=$4) AND ($5='' OR w.genre=$5) AND ($6='' OR w.audience=$6)
    AND ($7<>'true' OR (c.state='AVAILABLE' AND NOT m.bookshelf_paused)) AND ($8='' OR c.condition=$8)
    AND ($9='' OR e.language=$9) AND ($10='' OR e.publisher ILIKE '%'||$10||'%')
    GROUP BY w.id ORDER BY CASE WHEN w.title_key=$1 THEN 0 ELSE 1 END,w.title LIMIT 24 OFFSET $11`,[key,words,isbn,library,filters.genre??'',filters.audience??'',filters.available??'',filters.condition??'',filters.language??'',filters.publisher??'',(page-1)*24]);
  return {works:rows.map(w=>({...w,copyCount:w.copy_count,availableCount:w.available_count,editionCount:w.edition_count,confidence:q?candidateConfidence(q,w):null})),total:rows[0]?.total??0,page};
}
export async function workDetail(id:string,actor:Actor|null):Promise<any>{
  const result=await query('SELECT * FROM works WHERE id=$1',[id]);ensure(result.rows[0],'NOT_FOUND',roDomain.r6de06cd2b3,404);
  const w=result.rows[0];if(w.merged_into) return workDetail(w.merged_into,actor);
  ensure(w.moderation_state==='APPROVED'||actor?.role==='ADMIN','NOT_FOUND',roDomain.rcc5f286b15,404);
  const [editions,copies,reviews]=await Promise.all([
    query('SELECT id,work_id,language,publisher,year,isbn,translator,volume,abridged,unspecified,provenance FROM editions WHERE work_id=$1 ORDER BY year DESC NULLS LAST',[w.id]),
    query(`SELECT c.id,c.edition_id,c.library_id,c.condition,c.notes,c.state,c.max_days,c.reviewed_at,m.display_name owner_name,m.handle owner_handle,m.icon owner_icon,l.display_name library_name,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'storage_key',p.storage_key,'widths',p.widths)) FROM copy_photos p WHERE p.copy_id=c.id AND p.state='APPROVED'),'[]') photos
      FROM copies c JOIN editions e ON e.id=c.edition_id JOIN members m ON m.id=c.owner_id JOIN libraries l ON l.id=c.library_id WHERE e.work_id=$1 AND c.visibility='PUBLIC' AND c.moderation_state='APPROVED' AND c.state<>'REMOVED' AND m.status='ACTIVE' AND l.active AND NOT m.bookshelf_paused`,[w.id]),
    query(`SELECT r.id,r.stars,r.body,r.spoiler,r.created_at,r.reviewed_at,m.display_name,m.handle,m.icon FROM book_reviews r JOIN members m ON m.id=r.member_id WHERE r.work_id=$1 AND r.state='VISIBLE' ORDER BY r.created_at DESC LIMIT 30`,[w.id])]);
  return {work:{id:w.id,title:w.title,authors:w.authors,genre:w.genre,audience:w.audience,description:w.description,ads_eligible:!!w.reviewed_at&&copies.rows.every(c=>!!c.reviewed_at)&&reviews.rows.every(r=>!!r.reviewed_at)},editions:editions.rows.map(e=>({...e,provenance:publicProvenance(e.provenance)})),copies:copies.rows,reviews:reviews.rows};
}
function publicProvenance(value:any){
  const safe:Record<string,string>={};
  for(const key of ['source','provider','licence','attribution'])if(typeof value?.[key]==='string')safe[key]=value[key].slice(0,500);
  // User/account IDs and unreviewed provider payloads are internal audit data.
  return safe;
}
export async function addCopy(actor:Actor,input:any){
  verified(actor);
  return transaction(async client=>{
    const account=await client.query('SELECT m.status,m.adult,u."emailVerified" FROM members m JOIN "user" u ON u.id=m.id WHERE m.id=$1 FOR UPDATE OF m',[actor.id]);ensure(account.rows[0]?.status==='ACTIVE'&&account.rows[0]?.adult&&account.rows[0]?.emailVerified,'ACCOUNT_RESTRICTED',roDomain.r17df311987,403);
    const libraryId=input.libraryId||actor.homeLibraryId;ensure(libraryId,'LIBRARY_REQUIRED',roDomain.rc678cd7b5f);
    ensure((await client.query('SELECT 1 FROM libraries WHERE id=$1 AND active',[libraryId])).rowCount,'INVALID_LIBRARY',roDomain.r93d94aa36e);
    let editionId=input.editionId,workId=input.workId;
    if(editionId){const e=await client.query('SELECT work_id FROM editions WHERE id=$1',[editionId]);ensure(e.rowCount,'NOT_FOUND',roDomain.r2c58536c1f);workId=e.rows[0].work_id;}
    else{
      const language=input.language??'ro';ensure(['ro','ro-bilingual'].includes(language),'LANGUAGE_REQUIRED',roDomain.r5ab95eeab2);
      const isbn=isbnCanonical(input.isbn);
      if(isbn){await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['catalogue-isbn:'+isbn]);const e=await client.query('SELECT id,work_id FROM editions WHERE isbn=$1',[isbn]);if(e.rowCount){editionId=e.rows[0].id;workId=e.rows[0].work_id;}}
      if(!editionId){
        if(!workId){
          const title=String(input.title??'').trim(),authors=Array.isArray(input.authors)?input.authors.map((a:string)=>a.trim()).filter(Boolean):String(input.author??'').split(';').map(a=>a.trim()).filter(Boolean);
          ensure(title.length>0&&title.length<=300&&authors.length>0&&authors.length<=12&&authors.every((a:string)=>a.length<=120),'INVALID_BOOK',roDomain.r874d734328);
          const tk=normalize(title),ak=authorKey(authors),kind=input.kind??'original',volume=normalize(input.volumeKey??input.volume??'');
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['work-author:'+ak]);
          const credible=await client.query<Candidate>('SELECT id,title,authors FROM works WHERE author_key=$1 AND kind=$2 AND volume_key=$3 AND merged_into IS NULL LIMIT 100',[ak,kind,volume]);
          const match=credible.rows.find(w=>normalize(w.title)===tk||candidateConfidence(title,w)===1);
          if(match)workId=match.id;
          else {
          const w=await client.query(`INSERT INTO works(title,authors,title_key,author_key,search_key,kind,volume_key,genre,audience,description,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(title_key,author_key,kind,volume_key) DO UPDATE SET search_key=works.search_key RETURNING id`,[title,authors,tk,ak,`${tk} ${ak}`,kind,volume,input.genre??'Literatură',input.audience??'adults',input.description??'',actor.id]);workId=w.rows[0].id;
          }
        }
        workId=await canonicalWork(client,workId);
        const unspecified=(!isbn&&!input.publisher&&!input.year&&!input.translator&&!input.volume&&input.abridged==null)||input.unspecified===true;
        const edition={language,isbn,publisher:input.publisher??null,year:input.year?Number(input.year):null,translator:input.translator??null,volume:input.volume??null,abridged:input.abridged??null,unspecified};
        const e=await client.query(`INSERT INTO editions(work_id,language,isbn,publisher,year,translator,volume,abridged,unspecified,fingerprint,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(work_id,fingerprint) DO UPDATE SET fingerprint=editions.fingerprint RETURNING id`,[workId,language,isbn,edition.publisher,edition.year,edition.translator,edition.volume,edition.abridged,unspecified,editionFingerprint(edition),JSON.stringify({source:'member-entry',actor:actor.id})]);editionId=e.rows[0].id;
      }
    }
    const copy=await client.query(`INSERT INTO copies(edition_id,owner_id,library_id,condition,notes,collection_note,visibility,max_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[editionId,actor.id,libraryId,input.condition??'good',input.notes??'',input.collectionNote??'',input.visibility==='PUBLIC'?'PUBLIC':'PRIVATE',input.maxDays??config.loanDays]);
    await client.query('INSERT INTO ownership_history(copy_id,new_owner,reason) VALUES($1,$2,\'LISTED\')',[copy.rows[0].id,actor.id]);
    if(input.visibility==='PUBLIC'){
      await lockRewards(client,'member:'+actor.id);
      const count=await client.query(`SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='listing' AND created_at>=date_trunc('month',now())`,[actor.id]);
      const prior=await client.query(`SELECT 1 FROM xp_ledger l WHERE member_id=$1 AND reason='listing' AND EXISTS(SELECT 1 FROM works w WHERE w.id::text=l.data->>'workId' AND (w.id=$2 OR w.merged_into=$2))`,[actor.id,workId]);
      if(count.rows[0].n<config.listingMonthlyCap&&!prior.rowCount) await award(client,actor.id,'work:'+workId,'listing',config.rewardListing,{workId});
    }
    await audit(client,actor.id,'COPY_LISTED','copy',copy.rows[0].id);
    return {id:copy.rows[0].id,workId,editionId};
  });
}
export async function updateCopy(actor:Actor,input:any,remove=false){verified(actor);return transaction(async c=>{
  const account=await c.query('SELECT status FROM members WHERE id=$1 FOR UPDATE',[actor.id]);ensure(account.rows[0]?.status==='ACTIVE','ACCOUNT_RESTRICTED',roDomain.rc3e2180e3f,403);
  const r=await c.query('SELECT * FROM copies WHERE id=$1 FOR UPDATE',[input.id??input.copyId]);ensure(r.rowCount,'NOT_FOUND',roDomain.r7911167cc8,404);const copy=r.rows[0];ensure(copy.owner_id===actor.id,'FORBIDDEN',roDomain.r02e3de0383,403);
  ensure(['AVAILABLE','PAUSED'].includes(copy.state),'ACTIVE_LOAN',roDomain.re82873f255);
  if(remove)await c.query("UPDATE copies SET state='REMOVED',visibility='PRIVATE' WHERE id=$1",[copy.id]);
  else{
    ensure(copy.moderation_state!=='HIDDEN'||input.visibility!=='PUBLIC','MODERATION_HOLD',roDomain.copyModerationHold,403);
    const libraryId=input.libraryId??copy.library_id;ensure((await c.query('SELECT 1 FROM libraries WHERE id=$1 AND active',[libraryId])).rowCount,'INVALID_LIBRARY',roDomain.rc678cd7b5f);
    await c.query('UPDATE copies SET library_id=$2,condition=$3,notes=$4,collection_note=$5,visibility=$6,state=$7,reviewed_at=NULL WHERE id=$1',[copy.id,libraryId,input.condition??copy.condition,input.notes??copy.notes,input.collectionNote??copy.collection_note,input.visibility??copy.visibility,input.paused?'PAUSED':'AVAILABLE']);
  }return {ok:true};});}
export async function mergeWorks(actor:Actor,sourceId:string,targetId:string,reason:string){
  await moderate(actor,null);ensure(sourceId!==targetId&&reason.length>=10,'INVALID_MERGE',roDomain.re3e18e5c4a);
  return transaction(async c=>{
    const r=await c.query('SELECT * FROM works WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[sourceId,targetId]]);ensure(r.rowCount===2&&r.rows.every(w=>!w.merged_into),'INVALID_MERGE',roDomain.ra8c7fc1a6c);
    const source=r.rows.find(w=>w.id===sourceId);
    const editions=await c.query('SELECT * FROM editions WHERE work_id=$1 FOR UPDATE',[sourceId]);
    for(const e of editions.rows){const match=await c.query('SELECT id,cover_key,cover_state FROM editions WHERE work_id=$1 AND fingerprint=$2 FOR UPDATE',[targetId,e.fingerprint]);
      if(match.rowCount){
        const targetEdition=match.rows[0];
        // Preserve every proposal and its rights assertion before removing the duplicate edition.
        await c.query('UPDATE edition_cover_submissions SET edition_id=$2 WHERE edition_id=$1',[e.id,targetEdition.id]);
        // An already approved destination cover remains authoritative. An approved source
        // cover can fill a destination without one; pending proposals never become approved.
        if(e.cover_key&&e.cover_state==='APPROVED'&&!(targetEdition.cover_key&&targetEdition.cover_state==='APPROVED'))
          await c.query("UPDATE editions SET cover_key=$2,cover_state='APPROVED' WHERE id=$1",[targetEdition.id,e.cover_key]);
        else if(e.cover_key&&!targetEdition.cover_key)
          await c.query('UPDATE editions SET cover_key=$2,cover_state=$3 WHERE id=$1',[targetEdition.id,e.cover_key,e.cover_state]);
        await c.query('UPDATE copies SET edition_id=$2 WHERE edition_id=$1',[e.id,targetEdition.id]);
        await c.query('UPDATE book_reviews SET edition_id=$2 WHERE edition_id=$1',[e.id,targetEdition.id]);
        await c.query('DELETE FROM editions WHERE id=$1',[e.id]);
      }
      else await c.query('UPDATE editions SET work_id=$2 WHERE id=$1',[e.id,targetId]);
    }
    // Keep conflicting reviews/reading records on the redirect rather than silently deleting member history.
    await c.query(`UPDATE book_reviews r SET work_id=$2 WHERE work_id=$1 AND NOT EXISTS(SELECT 1 FROM book_reviews t WHERE t.work_id=$2 AND t.member_id=r.member_id)`,[sourceId,targetId]);
    await c.query(`UPDATE reading_states r SET work_id=$2 WHERE work_id=$1 AND NOT EXISTS(SELECT 1 FROM reading_states t WHERE t.work_id=$2 AND t.member_id=r.member_id)`,[sourceId,targetId]);
    await c.query('INSERT INTO work_aliases(work_id,alias,alias_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[targetId,source.title,source.title_key]);
    await c.query('INSERT INTO work_aliases(work_id,alias,alias_key) SELECT $2,alias,alias_key FROM work_aliases WHERE work_id=$1 ON CONFLICT DO NOTHING',[sourceId,targetId]);
    // Flatten old redirects so once-per-work reward evidence stays resolvable after A→B→C.
    await c.query(`UPDATE works SET merged_into=$2 WHERE id=$1 OR merged_into=$1`,[sourceId,targetId]);
    await audit(c,actor.id,'WORK_MERGED','work',sourceId,reason,{targetId,preservedConflicts:true});return {ok:true,targetId};
  });
}
