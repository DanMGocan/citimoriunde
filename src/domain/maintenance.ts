import {roDomain} from './ro.ts';
import {transaction,query} from '../lib/db';
import {config} from '../lib/config';
import {notify,audit} from './access';
import {orphanKeys,imageStorage} from '../lib/storage';
export async function processDomainJob(job:{id:string;type:string;payload:any}){
 if(job.type!=='loan_reminder')return false;
 await transaction(async c=>{
  const r=await c.query("SELECT * FROM loans WHERE id=$1 FOR UPDATE",[job.payload.loanId]);const loan=r.rows[0];
  if(!loan||!['ON_LOAN','RETURN_PENDING'].includes(loan.state))return;
  if(job.payload.dueAt&&new Date(job.payload.dueAt).getTime()!==new Date(loan.due_at).getTime())return;
  const title=job.payload.name==='overdue'?roDomain.ree7e2fd8e5:roDomain.r67f3288939;
  await notify(c,loan.borrower_id,'loan_reminder',title,'/imprumuturi','reminder:'+job.id);
  if(job.payload.name==='overdue')await notify(c,loan.lender_id,'loan_reminder',roDomain.r1fd885272c,'/imprumuturi','reminder:'+job.id);
 });return true;
}
export async function processMaintenance(){
 await transaction(async c=>{
  const expired=await c.query("SELECT * FROM loans WHERE state='RESERVED' AND reserved_until<now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50");
  for(const loan of expired.rows){await c.query('SELECT id FROM copies WHERE id=$1 FOR UPDATE',[loan.copy_id]);await c.query("UPDATE loans SET state='EXPIRED',closed_at=now() WHERE id=$1",[loan.id]);await c.query("UPDATE copies SET state='AVAILABLE' WHERE id=$1 AND state='RESERVED'",[loan.copy_id]);await c.query("UPDATE loan_requests SET state='EXPIRED' WHERE id=$1",[loan.request_id]);await c.query("INSERT INTO loan_events(loan_id,event,data) VALUES($1,'RESERVATION_EXPIRED','{}')",[loan.id]);await notify(c,loan.borrower_id,'loan',roDomain.r42a3eb1730,'/imprumuturi','expire:'+loan.id);}
  await c.query("UPDATE member_reviews SET published_at=now() WHERE published_at IS NULL AND publish_after<now() AND state='VISIBLE'");
  await c.query('DELETE FROM rate_limits WHERE expires_at<now()-interval \'1 day\'');await c.query('DELETE FROM metadata_cache WHERE expires_at<now()');await c.query('DELETE FROM auth_stepups WHERE expires_at<now()');await c.query('DELETE FROM ad_preview_sessions WHERE expires_at<now()');
  // Content retention is enabled only after operator review. Open evidence and loan histories are excluded.
  if(config.legalReviewed){
   await c.query(`DELETE FROM messages msg USING conversations conv WHERE msg.conversation_id=conv.id AND msg.created_at<now()-$1*interval '1 day'
    AND (conv.loan_id IS NULL OR EXISTS(SELECT 1 FROM loans l WHERE l.id=conv.loan_id AND l.state IN ('RETURNED','DONATED','CANCELLED','EXPIRED')))
    AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.target_type='message' AND r.target_id=msg.id::text AND r.state NOT IN ('RESOLVED','DISMISSED','APPEAL_RESOLVED'))`,[config.messageRetentionDays]);
   await c.query(`UPDATE reports SET evidence='{}' WHERE updated_at<now()-$1*interval '1 day' AND state IN ('RESOLVED','DISMISSED','APPEAL_RESOLVED') AND evidence<>'{}'`,[config.retentionDays]);
   await c.query(`DELETE FROM notifications WHERE created_at<now()-$1*interval '1 day'`,[config.retentionDays]);
  }
 });
 for(const key of await orphanKeys()){const exists=await query('SELECT 1 FROM copy_photos WHERE storage_key=$1',[key]);if(!exists.rowCount)for(const width of [320,640,1200])await imageStorage.remove(key,width);}
}
