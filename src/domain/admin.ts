import {roDomain} from './ro.ts';
import {query,transaction} from '../lib/db';
import {config} from '../lib/config';
import {type Actor,admin,moderate,audit} from './access';
import {ensure,DomainError} from './errors.ts';
import {parseReviewedPolicy} from '../lib/legal-publication.ts';
import {normalize,authorKey,isbnCanonical,editionFingerprint} from './normalization.ts';
export async function retryJob(actor:Actor,input:any){admin(actor);ensure(input.reason?.length>=10,'REASON_REQUIRED',roDomain.r75f727e309);return transaction(async c=>{
 const r=await c.query('SELECT id,type,status,attempts FROM jobs WHERE id=$1 FOR UPDATE',[input.id]);ensure(r.rowCount&&r.rows[0].status==='FAILED','INVALID_JOB','Alege o sarcină eșuată pentru reîncercare.');
 await c.query("UPDATE jobs SET status='PENDING',attempts=0,run_at=now(),last_error=NULL,locked_at=NULL WHERE id=$1",[input.id]);await audit(c,actor.id,'JOB_RETRIED','job',input.id,input.reason,{previousAttempts:r.rows[0].attempts,type:r.rows[0].type});return {ok:true};
});}
export async function publishLegal(actor:Actor,input:any){
 admin(actor);
 ensure(config.legalReviewed&&config.operatorName&&config.operatorAddress&&config.operatorCountry&&config.supportEmail,'LEGAL_REVIEW_REQUIRED',roDomain.r43fb80fa12);
 ensure(typeof input.slug==='string'&&typeof input.title==='string'&&typeof input.body==='string'&&typeof input.reason==='string'&&input.reason.trim().length>=10,'INVALID_DOCUMENT',roDomain.r38a476fa1d);
 const reviewed=(()=>{try{return parseReviewedPolicy(input.slug,`# ${input.title}\n\n${input.body}`);}catch{throw new DomainError('INVALID_DOCUMENT',roDomain.r38a476fa1d);}})();
 return transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['legal:'+reviewed.slug]);
  const version=(await c.query('SELECT coalesce(max(version),0)+1 n FROM legal_documents WHERE slug=$1',[reviewed.slug])).rows[0].n;
  const r=await c.query('INSERT INTO legal_documents(slug,version,title,body,is_draft,published_at,created_by) VALUES($1,$2,$3,$4,false,now(),$5) RETURNING id',[reviewed.slug,version,reviewed.title,reviewed.body,actor.id]);
  await audit(c,actor.id,'LEGAL_PUBLISHED','legal_document',r.rows[0].id,input.reason,{operatorReviewAttested:true});
  return {id:r.rows[0].id,version};
 });
}
export async function categoryAdmin(actor:Actor,input:any){admin(actor);ensure(/^[a-z0-9-]{2,50}$/.test(input.categoryId)&&input.title?.length>=2,'INVALID_CATEGORY',roDomain.r0480d7d4a2);return transaction(async c=>{await c.query('INSERT INTO forum_categories(id,title,description,sort_order,announcement) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET title=$2,description=$3,sort_order=$4,announcement=$5',[input.categoryId,input.title,input.description??'',input.sortOrder??0,input.announcement===true]);await audit(c,actor.id,'CATEGORY_CHANGED','category',input.categoryId,input.reason);return {ok:true};});}
export async function scopeAdmin(actor:Actor,input:any){admin(actor);return transaction(async c=>{ensure((await c.query("SELECT 1 FROM members WHERE id=$1 AND role='MODERATOR'",[input.memberId])).rowCount,'INVALID_MODERATOR',roDomain.r8782cb17d2);if(input.libraryId)ensure((await c.query('SELECT 1 FROM libraries WHERE id=$1',[input.libraryId])).rowCount,'INVALID_LIBRARY',roDomain.rc678cd7b5f);await c.query('DELETE FROM moderator_scopes WHERE member_id=$1',[input.memberId]);await c.query('INSERT INTO moderator_scopes(member_id,library_id,global_scope) VALUES($1,$2,$3)',[input.memberId,input.libraryId??null,input.globalScope===true]);await audit(c,actor.id,'MODERATOR_SCOPE_CHANGED','member',input.memberId,input.reason);return {ok:true};});}
export async function correctCatalogue(actor:Actor,input:any){await moderate(actor,null);ensure(input.reason?.length>=10,'REASON_REQUIRED',roDomain.r88603cb108);return transaction(async c=>{
 if(input.targetType==='work'){const r=await c.query('SELECT * FROM works WHERE id=$1 FOR UPDATE',[input.id]);ensure(r.rowCount,'NOT_FOUND',roDomain.r6de06cd2b3);const w=r.rows[0],title=input.title??w.title,authors=input.authors??w.authors;await c.query('INSERT INTO work_aliases(work_id,alias,alias_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[w.id,w.title,w.title_key]);await c.query('UPDATE works SET title=$2,authors=$3,title_key=$4,author_key=$5,search_key=$6,genre=$7,audience=$8,description=$9 WHERE id=$1',[w.id,title,authors,normalize(title),authorKey(authors),normalize(title)+' '+authorKey(authors),input.genre??w.genre,input.audience??w.audience,input.description??w.description]);}
 else{const r=await c.query('SELECT * FROM editions WHERE id=$1 FOR UPDATE',[input.id]);ensure(r.rowCount,'NOT_FOUND',roDomain.r2c58536c1f);const e={...r.rows[0],publisher:input.publisher??r.rows[0].publisher,year:input.year??r.rows[0].year,translator:input.translator??r.rows[0].translator,language:input.language??r.rows[0].language,isbn:input.isbn===null?null:isbnCanonical(input.isbn??r.rows[0].isbn),unspecified:input.unspecified??r.rows[0].unspecified};await c.query('UPDATE editions SET publisher=$2,year=$3,translator=$4,language=$5,isbn=$6,unspecified=$7,fingerprint=$8 WHERE id=$1',[e.id,e.publisher,e.year,e.translator,e.language,e.isbn,e.unspecified,editionFingerprint(e)]);}
 await audit(c,actor.id,'CATALOGUE_CORRECTED',input.targetType,input.id,input.reason);return {ok:true};});}
export async function adPreview(actor:Actor,input:any){admin(actor);if(input.enabled===false)await query('DELETE FROM ad_preview_sessions WHERE session_id=$1',[actor.sessionId]);else await query('INSERT INTO ad_preview_sessions(session_id,expires_at) VALUES($1,now()+interval \'30 minutes\') ON CONFLICT(session_id) DO UPDATE SET expires_at=now()+interval \'30 minutes\'',[actor.sessionId]);return {ok:true};}
