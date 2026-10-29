import {roDomain} from './ro.ts';
import {query,transaction} from '../lib/db';
import {type Actor,verified,admin,audit,notify} from './access';
import {ensure} from './errors.ts';
export async function requestPrivacy(actor:Actor,input:any){ensure(actor?.verified,'AUTH_REQUIRED',roDomain.r21b57b7d40,401);ensure(['EXPORT','DELETE','CORRECTION'].includes(input.kind),'INVALID_REQUEST',roDomain.r0c38d233ee);return transaction(async c=>{
 const created=await c.query("INSERT INTO privacy_requests(member_id,kind,explanation) VALUES($1,$2,$3) ON CONFLICT(member_id,kind) WHERE state IN ('RECEIVED','REVIEWING') DO NOTHING RETURNING id",[actor.id,input.kind,input.explanation??'']);
 if(created.rowCount){await audit(c,actor.id,'PRIVACY_REQUESTED','privacy_request',created.rows[0].id);return {id:created.rows[0].id};}
 const existing=await c.query("SELECT id FROM privacy_requests WHERE member_id=$1 AND kind=$2 AND state IN ('RECEIVED','REVIEWING')",[actor.id,input.kind]);ensure(existing.rowCount,'UNAVAILABLE',roDomain.retryUnavailable,409);return {id:existing.rows[0].id};
});}
export async function exportAccount(actor:Actor){ensure(actor?.verified,'AUTH_REQUIRED',roDomain.r21b57b7d40,401);const [profile,copies,loans,messages,reading,reviews,preferences,xp]=await Promise.all([
 query('SELECT m.*,u.email,u."emailVerified" FROM members m JOIN "user" u ON u.id=m.id WHERE m.id=$1',[actor.id]),
 query('SELECT id,edition_id,library_id,condition,notes,collection_note,visibility,state FROM copies WHERE owner_id=$1',[actor.id]),
 query('SELECT id,copy_id,library_id,state,duration_days,handed_over_at,acknowledged_at,original_due_at,due_at,borrower_return_at,returned_at,closed_at FROM loans WHERE $1 IN(lender_id,borrower_id)',[actor.id]),
 query('SELECT id,conversation_id,body,created_at FROM messages WHERE sender_id=$1',[actor.id]),
 query('SELECT work_id,state,first_finished_at,updated_at FROM reading_states WHERE member_id=$1',[actor.id]),
 query('SELECT work_id,stars,body,spoiler FROM book_reviews WHERE member_id=$1',[actor.id]),
 query('SELECT category,in_app,email FROM notification_preferences WHERE member_id=$1',[actor.id]),
 query('SELECT reason,points,rule_version,created_at FROM xp_ledger WHERE member_id=$1',[actor.id])]);
 return {generatedAt:new Date().toISOString(),notice:roDomain.r6274642b77,profile:profile.rows[0],copies:copies.rows,loans:loans.rows,messagesSent:messages.rows,reading:reading.rows,reviews:reviews.rows,preferences:preferences.rows,xp:xp.rows};}
export async function resolvePrivacy(actor:Actor,input:any){admin(actor);return transaction(async c=>{const r=await c.query('SELECT * FROM privacy_requests WHERE id=$1 FOR UPDATE',[input.id]);ensure(r.rowCount,'NOT_FOUND',roDomain.r3a8c769102);const request=r.rows[0];ensure(input.reason?.length>=10,'REASON_REQUIRED',roDomain.r8e0a58a304);
 if(request.kind==='DELETE'&&input.state==='COMPLETED'){
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['admin-roles']);const member=(await c.query('SELECT role FROM members WHERE id=$1 FOR UPDATE',[request.member_id])).rows[0];if(member?.role==='ADMIN')ensure((await c.query("SELECT 1 FROM members WHERE role='ADMIN' AND status='ACTIVE' AND id<>$1",[request.member_id])).rowCount,'LAST_ADMIN',roDomain.ra22eaa764e);
  ensure(!(await c.query("SELECT 1 FROM loans WHERE $1 IN(lender_id,borrower_id) AND state IN ('RESERVED','ON_LOAN','RETURN_PENDING','DISPUTED','LOST') LIMIT 1",[request.member_id])).rowCount,'ACTIVE_LOANS',roDomain.rf46f17ce7b);
  ensure(!(await c.query("SELECT 1 FROM reports WHERE reporter_id=$1 AND state IN ('RECEIVED','TRIAGED','INVESTIGATING','APPEAL_REQUESTED') LIMIT 1",[request.member_id])).rowCount,'ACTIVE_CASE',roDomain.r1e07aa08e3);
  await c.query("UPDATE copies SET visibility='PRIVATE',state='REMOVED',collection_note='' WHERE owner_id=$1",[request.member_id]);
  await c.query("UPDATE members SET display_name='Cont șters',handle='sters_'||substr(encode(digest(id,'sha256'),'hex'),1,16),icon='book',bio='',status='DELETED',home_library_id=NULL,public_collection=false,public_stats=false,leaderboard_opt_in=false,email_optional=false WHERE id=$1",[request.member_id]);
  await c.query("UPDATE \"user\" SET name='Cont șters',email='deleted-'||id||'@invalid.example',image=NULL,\"emailVerified\"=false WHERE id=$1",[request.member_id]);
  await c.query('DELETE FROM session WHERE "userId"=$1',[request.member_id]);await c.query('DELETE FROM account WHERE "userId"=$1',[request.member_id]);await c.query('DELETE FROM "twoFactor" WHERE "userId"=$1',[request.member_id]);
  await c.query('DELETE FROM reading_states WHERE member_id=$1',[request.member_id]);await c.query('DELETE FROM reading_goals WHERE member_id=$1',[request.member_id]);await c.query('DELETE FROM user_consents WHERE member_id=$1',[request.member_id]);
  // Historical transaction/evidence rows remain pseudonymised pending scheduled legal review, never described as anonymous.
 }await c.query('UPDATE privacy_requests SET state=$2,reason=$3,completed_at=CASE WHEN $2 IN (\'COMPLETED\',\'REFUSED\') THEN now() ELSE NULL END WHERE id=$1',[request.id,input.state,input.reason]);await audit(c,actor.id,'PRIVACY_DECIDED','privacy_request',request.id,input.reason);return {ok:true};});}
