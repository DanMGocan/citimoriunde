import {roDomain} from './ro.ts';
import {query,transaction} from '../lib/db';
import {config} from '../lib/config';
import {type Actor,verified,rateLimit,notify} from './access';
import {signEvidencePreview} from './report-evidence.ts';
import {ensure} from './errors.ts';
export async function contact(actor:Actor,input:any){verified(actor);ensure(input.memberId!==actor.id,'SELF_CONTACT',roDomain.r0f95d7bd7b);await rateLimit('contact:'+actor.id,config.messageDailyContactLimit,86400);return transaction(async c=>{
 const target=await c.query('SELECT m.id FROM members m JOIN "user" u ON u.id=m.id WHERE m.id=$1 AND m.status=\'ACTIVE\' AND u."emailVerified" AND m.adult',[input.memberId]);ensure(target.rowCount,'CONTACT_UNAVAILABLE',roDomain.r0c10bcdb89);
 ensure(!(await c.query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[actor.id,input.memberId])).rowCount,'BLOCKED',roDomain.r0c10bcdb89);
 const r=await c.query(`INSERT INTO conversations(member_a,member_b) VALUES($1,$2) ON CONFLICT(least(member_a,member_b),greatest(member_a,member_b)) WHERE loan_id IS NULL AND state<>'DECLINED' DO UPDATE SET member_a=conversations.member_a RETURNING id`,[actor.id,input.memberId]);await notify(c,input.memberId,'contact',roDomain.rc7aefbad3f,'/mesaje','contact:'+r.rows[0].id);return {id:r.rows[0].id};});}
export async function acceptContact(actor:Actor,input:any){verified(actor);const r=await query("UPDATE conversations SET state=$3 WHERE id=$1 AND member_b=$2 AND loan_id IS NULL AND state='PENDING' RETURNING id",[input.conversationId??input.id,actor.id,input.decline?'DECLINED':'ACCEPTED']);ensure(r.rowCount,'FORBIDDEN',roDomain.rf9536dabdb,403);return {ok:true};}
export async function sendMessage(actor:Actor,input:any){verified(actor);const body=String(input.body??'').trim();ensure(body.length>=1&&body.length<=3000,'INVALID_MESSAGE',roDomain.rf5af21c4c4);await rateLimit('message:'+actor.id,config.messageMinuteLimit);return transaction(async c=>{
 const r=await c.query('SELECT * FROM conversations WHERE id=$1 FOR SHARE',[input.conversationId??input.id]);ensure(r.rowCount&&[r.rows[0].member_a,r.rows[0].member_b].includes(actor.id),'FORBIDDEN',roDomain.r7724eeb978,403);const conv=r.rows[0];ensure(conv.state==='ACCEPTED','CONTACT_PENDING',roDomain.r19c6cb8292);const other=conv.member_a===actor.id?conv.member_b:conv.member_a;
 ensure(!(await c.query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[actor.id,other])).rowCount,'BLOCKED',roDomain.ra1732ff467);
 const target=await c.query('SELECT status FROM members WHERE id=$1',[other]);ensure(target.rows[0]?.status==='ACTIVE','CONTACT_UNAVAILABLE',roDomain.r65d8eea553);
 const msg=await c.query('INSERT INTO messages(conversation_id,sender_id,body,client_key) VALUES($1,$2,$3,$4) ON CONFLICT(sender_id,client_key) DO NOTHING RETURNING id',[conv.id,actor.id,body,input.clientKey]);
 if(!msg.rowCount){
  const existing=await c.query('SELECT id,conversation_id,body FROM messages WHERE sender_id=$1 AND client_key=$2 FOR SHARE',[actor.id,input.clientKey]);
  ensure(existing.rowCount&&existing.rows[0].conversation_id===conv.id&&existing.rows[0].body===body,'MESSAGE_RETRY_CONFLICT',roDomain.messageRetryConflict);
  // A successfully stored retry keeps the same message and produces no new notification.
  return {id:existing.rows[0].id};
 }
 await notify(c,other,'message',roDomain.r77c3a6dc1f,'/mesaje','message:'+msg.rows[0].id);return {id:msg.rows[0].id};});}
export async function messages(actor:Actor,id?:string,page=1){verified(actor);const conversations=await query(`SELECT c.id,c.loan_id,c.state,c.member_a,c.member_b,c.created_at,m.display_name,m.handle,m.icon,w.title loan_title,coalesce((SELECT max(last.created_at) FROM messages last WHERE last.conversation_id=c.id),c.created_at) last_message_at,
 (SELECT count(*)::int FROM messages msg WHERE msg.conversation_id=c.id AND msg.sender_id<>$1 AND msg.created_at>coalesce((SELECT read_at FROM conversation_reads cr WHERE cr.conversation_id=c.id AND cr.member_id=$1),'epoch')) unread_count,
 EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=c.member_a AND b.blocked_id=c.member_b) OR (b.blocker_id=c.member_b AND b.blocked_id=c.member_a)) blocked
 FROM conversations c JOIN members m ON m.id=CASE WHEN c.member_a=$1 THEN c.member_b ELSE c.member_a END LEFT JOIN loans loan ON loan.id=c.loan_id LEFT JOIN copies copy ON copy.id=loan.copy_id LEFT JOIN editions edition ON edition.id=copy.edition_id LEFT JOIN works w ON w.id=edition.work_id WHERE $1 IN (c.member_a,c.member_b) ORDER BY last_message_at DESC LIMIT 100`,[actor.id]);let rows:any[]=[];
 if(id){ensure((await query('SELECT 1 FROM conversations WHERE id=$1 AND $2 IN(member_a,member_b)',[id,actor.id])).rowCount,'FORBIDDEN',roDomain.r7724eeb978,403);rows=(await query('SELECT id,sender_id,body,created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET $2',[id,(page-1)*30])).rows.reverse();if(page===1&&rows.length)await query('INSERT INTO conversation_reads(conversation_id,member_id,read_at) VALUES($1,$2,$3) ON CONFLICT(conversation_id,member_id) DO UPDATE SET read_at=greatest(conversation_reads.read_at,$3)',[id,actor.id,rows[rows.length-1].created_at]);}
 return {conversations:conversations.rows,messages:rows,page};}
export async function blockMember(actor:Actor,input:any){verified(actor);ensure(actor.id!==input.memberId,'INVALID_BLOCK',roDomain.r914f97e1f0);if(input.unblock)await query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[actor.id,input.memberId]);else await query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.id,input.memberId]);return {ok:true};}
type EvidenceMessage={id:string;sender_id:string;body:string;created_at:Date};
export async function reportMessagePreview(actor:Actor,messageId:string){
 verified(actor);
 const r=await query<{member_a:string;member_b:string}>(`SELECT c.member_a,c.member_b FROM messages msg JOIN conversations c ON c.id=msg.conversation_id WHERE msg.id=$1`,[messageId]);
 ensure(r.rowCount&&[r.rows[0].member_a,r.rows[0].member_b].includes(actor.id),'FORBIDDEN',roDomain.rea3fdc6c62,403);
 // Keep timestamp boundaries in PostgreSQL: JavaScript Dates discard microseconds,
 // which could place the selected message in its own subsequent-message context.
 const context=await query<EvidenceMessage>(`WITH selected AS (SELECT id,conversation_id,created_at FROM messages WHERE id=$1::uuid)
   (SELECT m.id,m.sender_id,m.body,m.created_at FROM messages m CROSS JOIN selected s
    WHERE m.conversation_id=s.conversation_id AND (m.created_at,m.id)<(s.created_at,s.id)
    ORDER BY m.created_at DESC,m.id DESC LIMIT 2)
   UNION ALL (SELECT id,sender_id,body,created_at FROM messages WHERE id=$1::uuid)
   UNION ALL (SELECT m.id,m.sender_id,m.body,m.created_at FROM messages m CROSS JOIN selected s
    WHERE m.conversation_id=s.conversation_id AND (m.created_at,m.id)>(s.created_at,s.id)
    ORDER BY m.created_at,m.id LIMIT 2)
   ORDER BY created_at,id`,[messageId]);
 return {selectedMessageId:messageId,messages:context.rows,evidenceToken:signEvidencePreview(config.authSecret,actor.id,messageId,context.rows.map(m=>m.id)),notice:roDomain.rbbbccb750c};
}
