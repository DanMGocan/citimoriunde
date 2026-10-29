import {roDomain} from './ro.ts';
import type {PoolClient} from 'pg';
import {query,transaction} from '../lib/db';
import {config} from '../lib/config';
import {type Actor,verified,admin,audit,notify} from './access';
import {ensure} from './errors.ts';
import {allowedLoanAction,handoverDates} from './lifecycle.ts';
import {awardLoan} from './reputation';
async function event(c:PoolClient,loanId:string,actorId:string,name:string,data:unknown={}){await c.query('INSERT INTO loan_events(loan_id,actor_id,event,data) VALUES($1,$2,$3,$4)',[loanId,actorId,name,JSON.stringify(data)]);}
async function cancelReminders(c:PoolClient,id:string){await c.query("UPDATE jobs SET status='CANCELLED' WHERE type='loan_reminder' AND payload->>'loanId'=$1 AND status IN ('PENDING','RUNNING')",[id]);}
async function reminderJobs(c:PoolClient,loan:any){await cancelReminders(c,loan.id);for(const [name,days] of [['before',-config.loanReminderDays],['due',0],['overdue',3]] as const){const run=new Date(new Date(loan.due_at).getTime()+days*86400000);await c.query("INSERT INTO jobs(type,dedupe_key,payload,run_at) VALUES('loan_reminder',$1,$2,$3) ON CONFLICT DO NOTHING",[`loan:${loan.id}:${new Date(loan.due_at).toISOString()}:${name}`,JSON.stringify({loanId:loan.id,name,dueAt:new Date(loan.due_at).toISOString()}),run]);}}
async function loanCopy(c:PoolClient,id:string){
  // Catalogue merges lock a work before moving its copies. Keep this order and
  // retain the publication checks until a new request/reservation is committed.
  const scope=await c.query(`SELECT c.edition_id,c.library_id,w.moderation_state work_state,w.merged_into,l.active library_active
    FROM copies c JOIN editions e ON e.id=c.edition_id JOIN works w ON w.id=e.work_id JOIN libraries l ON l.id=c.library_id
    WHERE c.id=$1 FOR SHARE OF w,l`,[id]);
  ensure(scope.rowCount,'NOT_FOUND',roDomain.r7911167cc8,404);const publication=scope.rows[0];
  ensure(publication.work_state==='APPROVED'&&!publication.merged_into&&publication.library_active,'UNAVAILABLE',roDomain.rb4585ddfd1);
  const result=await c.query('SELECT c.*,m.bookshelf_paused,m.status FROM copies c JOIN members m ON m.id=c.owner_id WHERE c.id=$1 FOR UPDATE OF c',[id]);
  ensure(result.rowCount,'NOT_FOUND',roDomain.r7911167cc8,404);const copy=result.rows[0];
  ensure(copy.edition_id===publication.edition_id&&copy.library_id===publication.library_id&&copy.moderation_state==='APPROVED'&&copy.visibility==='PUBLIC'&&!copy.bookshelf_paused&&copy.status==='ACTIVE','UNAVAILABLE',roDomain.rb4585ddfd1);
  return copy;
}
export async function requestLoan(actor:Actor,input:any){verified(actor);return transaction(async c=>{
  const copy=await loanCopy(c,input.copyId);
  ensure(copy.owner_id!==actor.id,'SELF_BORROW',roDomain.rd2b52bfbbb);ensure(copy.visibility==='PUBLIC'&&copy.state==='AVAILABLE'&&!copy.bookshelf_paused&&copy.status==='ACTIVE','UNAVAILABLE',roDomain.rb4585ddfd1);
  ensure(!(await c.query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[actor.id,copy.owner_id])).rowCount,'BLOCKED',roDomain.r0c10bcdb89);
  const active=await c.query("SELECT count(*)::int n FROM loans WHERE borrower_id=$1 AND state IN ('RESERVED','ON_LOAN','RETURN_PENDING','DISPUTED','LOST')",[actor.id]);ensure(active.rows[0].n<config.loanMaxActive,'LOAN_LIMIT',roDomain.r698739bb3e);
  const request=await c.query(`INSERT INTO loan_requests(copy_id,borrower_id,lender_id,library_id,message) VALUES($1,$2,$3,$4,$5) ON CONFLICT(copy_id,borrower_id) WHERE state='PENDING' DO UPDATE SET message=loan_requests.message RETURNING id`,[copy.id,actor.id,copy.owner_id,copy.library_id,input.message??'']);
  await notify(c,copy.owner_id,'request',roDomain.r7bcf787268,'/imprumuturi','request:'+request.rows[0].id);return {id:request.rows[0].id};});}
export async function decideRequest(actor:Actor,input:any,decision:'ACCEPTED'|'DECLINED'|'CANCELLED'){verified(actor);return transaction(async c=>{
  const r=await c.query('SELECT * FROM loan_requests WHERE id=$1 FOR UPDATE',[input.id??input.requestId]);ensure(r.rowCount,'NOT_FOUND',roDomain.r3a8c769102,404);const request=r.rows[0];
  ensure(decision==='CANCELLED'?request.borrower_id===actor.id:request.lender_id===actor.id,'FORBIDDEN',roDomain.r2346c12f91,403);
  if(request.state===decision){const existing=await c.query('SELECT id FROM loans WHERE request_id=$1',[request.id]);return {ok:true,loanId:existing.rows[0]?.id};}
  ensure(request.state==='PENDING','INVALID_TRANSITION',roDomain.re6f56878f2);
  let loanId:string|undefined;
  if(decision==='ACCEPTED'){
    // Both account rows stay locked through creation. Deletion/suspension cannot
    // pass an empty-loan check and then race a new accepted reservation.
    const participants=await c.query('SELECT m.*,u."emailVerified" FROM members m JOIN "user" u ON u.id=m.id WHERE m.id=ANY($1::text[]) ORDER BY m.id FOR UPDATE OF m',[[request.lender_id,request.borrower_id]]);
    ensure(participants.rowCount===2&&participants.rows.every(m=>m.status==='ACTIVE'&&m.adult&&m.emailVerified),'ACCOUNT_RESTRICTED',roDomain.r14264b08bf);
    const copy=await loanCopy(c,request.copy_id);ensure(copy.owner_id===actor.id&&copy.state==='AVAILABLE'&&copy.moderation_state==='APPROVED','UNAVAILABLE',roDomain.rac1180b4c8);
    ensure(!(await c.query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[actor.id,request.borrower_id])).rowCount,'BLOCKED',roDomain.r82ef188942);
    const borrower=await c.query('SELECT m.*,u."emailVerified" FROM members m JOIN "user" u ON u.id=m.id WHERE m.id=$1 FOR UPDATE OF m',[request.borrower_id]);ensure(borrower.rows[0]?.status==='ACTIVE'&&borrower.rows[0]?.adult&&borrower.rows[0]?.emailVerified,'ACCOUNT_RESTRICTED',roDomain.rb7b5635f62);
    const total=await c.query("SELECT count(*)::int n FROM loans WHERE borrower_id=$1 AND state IN ('RESERVED','ON_LOAN','RETURN_PENDING','DISPUTED','LOST')",[request.borrower_id]);ensure(total.rows[0].n<config.loanMaxActive,'LOAN_LIMIT',roDomain.r76c9959b9c);
    const duration=Number(input.durationDays??config.loanDays);ensure(Number.isInteger(duration)&&duration>=1&&duration<=Math.min(180,config.loanMaxDays,copy.max_days??180),'INVALID_DURATION',roDomain.r61a1683bde);
    loanId=(await c.query(`INSERT INTO loans(request_id,copy_id,lender_id,borrower_id,library_id,duration_days,reserved_until) VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 hour') RETURNING id`,[request.id,request.copy_id,request.lender_id,request.borrower_id,request.library_id,duration,config.reservationHours])).rows[0].id;
    await c.query("UPDATE copies SET state='RESERVED' WHERE id=$1",[copy.id]);
    await c.query("INSERT INTO conversations(member_a,member_b,loan_id,state) VALUES($1,$2,$3,'ACCEPTED')",[actor.id,request.borrower_id,loanId]);
    await event(c,loanId!,actor.id,'RESERVED',{durationDays:duration});
  }
  await c.query('UPDATE loan_requests SET state=$2,decided_at=now() WHERE id=$1',[request.id,decision]);
  await notify(c,decision==='CANCELLED'?request.lender_id:request.borrower_id,'request',roDomain.r68b94115db,'/imprumuturi','request:'+request.id+':'+decision);
  return {ok:true,loanId};});}
export async function transitionLoan(actor:Actor,input:any,action:string){
  // Existing loan mediation remains available through reports when an account/contact is restricted.
  if(['receive','return','dispute','acknowledge'].includes(action)) ensure(actor.verified&&actor.adult,'VERIFICATION_REQUIRED',roDomain.ra7e5a858db,403); else verified(actor);
  return transaction(async c=>{
    const r=await c.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE',[input.id??input.loanId]);ensure(r.rowCount,'NOT_FOUND',roDomain.r926e0c67ae,404);let loan=r.rows[0];
    ensure([loan.lender_id,loan.borrower_id].includes(actor.id),'FORBIDDEN',roDomain.rf9aab69561,403);
    if(action==='receive'&&loan.state==='RETURNED'&&actor.id===loan.lender_id)return {ok:true,loan};
    if(action==='handover'&&loan.handed_over_at&&actor.id===loan.lender_id)return {ok:true,loan};
    if(action==='return'&&loan.state==='RETURN_PENDING'&&actor.id===loan.borrower_id)return {ok:true,loan};
    if(action==='acknowledge'&&loan.acknowledged_at&&actor.id===loan.borrower_id)return {ok:true,loan};
    let extension:any=null;
    if(action==='extensionApprove'){
      ensure(actor.id===loan.lender_id,'INVALID_TRANSITION',roDomain.re5810960ec);
      ensure(typeof input.extensionId==='string'&&/^[a-f0-9-]{36}$/i.test(input.extensionId),'NOT_FOUND',roDomain.r2913252832);
      const requested=await c.query('SELECT * FROM extensions WHERE id=$1 AND loan_id=$2 FOR UPDATE',[input.extensionId,loan.id]);
      ensure(requested.rowCount,'NOT_FOUND',roDomain.r2913252832);extension=requested.rows[0];
      // A retry is bound to this request even after another request is created.
      if(extension.state==='APPROVED')return {ok:true,loan,extensionId:extension.id};
      ensure(extension.state==='PENDING','INVALID_TRANSITION',roDomain.re5810960ec);
    }
    allowedLoanAction(loan,actor.id,action);
    await c.query('SELECT id FROM copies WHERE id=$1 FOR UPDATE',[loan.copy_id]);
    const other=actor.id===loan.lender_id?loan.borrower_id:loan.lender_id;
    if(action==='handover'){
      const dates=handoverDates(loan.duration_days,new Date());
      loan=(await c.query("UPDATE loans SET state='ON_LOAN',handed_over_at=$2,handover_actor=$3,original_due_at=$4,due_at=$4 WHERE id=$1 RETURNING *",[loan.id,dates.handedOverAt,actor.id,dates.dueAt])).rows[0];
      await c.query("UPDATE copies SET state='ON_LOAN' WHERE id=$1",[loan.copy_id]);await reminderJobs(c,loan);
    }else if(action==='acknowledge')await c.query('UPDATE loans SET acknowledged_at=now() WHERE id=$1',[loan.id]);
    else if(action==='return'){await c.query("UPDATE loans SET state='RETURN_PENDING',borrower_return_at=now() WHERE id=$1",[loan.id]);await c.query("UPDATE copies SET state='RETURN_PENDING' WHERE id=$1",[loan.copy_id]);}
    else if(action==='receive'){
      loan=(await c.query("UPDATE loans SET state='RETURNED',returned_at=now(),return_actor=$2,closed_at=now() WHERE id=$1 RETURNING *",[loan.id,actor.id])).rows[0];
      await c.query("UPDATE copies SET state='AVAILABLE' WHERE id=$1",[loan.copy_id]);await c.query("UPDATE gift_offers SET state='CANCELLED',decided_at=now() WHERE loan_id=$1 AND state='PENDING'",[loan.id]);await cancelReminders(c,loan.id);await awardLoan(c,loan,'RETURNED');
    }else if(action==='cancel'){
      await c.query("UPDATE loans SET state='CANCELLED',closed_at=now() WHERE id=$1",[loan.id]);await c.query("UPDATE copies SET state='AVAILABLE' WHERE id=$1",[loan.copy_id]);await c.query("UPDATE loan_requests SET state='CANCELLED' WHERE id=$1",[loan.request_id]);
    }else if(action==='extensionRequest'){
      ensure(Number.isInteger(Number(input.days))&&Number(input.days)>=1&&Number(input.days)<=90,'INVALID_DURATION',roDomain.r04c124bf5e);
      const pending=await c.query("SELECT id FROM extensions WHERE loan_id=$1 AND state='PENDING'",[loan.id]);if(pending.rowCount)return {ok:true,loan,extensionId:pending.rows[0].id};
      const created=await c.query("INSERT INTO extensions(loan_id,requested_by,days) VALUES($1,$2,$3) RETURNING id",[loan.id,actor.id,Number(input.days)]);extension=created.rows[0];
    }else if(action==='extensionApprove'){
      const newDate=new Date(new Date(loan.due_at).getTime()+extension.days*86400000);
      await c.query("UPDATE extensions SET state='APPROVED',previous_due_at=$2,new_due_at=$3,approved_by=$4,decided_at=now() WHERE id=$1",[extension.id,loan.due_at,newDate,actor.id]);loan=(await c.query('UPDATE loans SET due_at=$2 WHERE id=$1 RETURNING *',[loan.id,newDate])).rows[0];await reminderJobs(c,loan);
    }else if(action==='dispute'){
      ensure(input.reason?.length>=10,'REASON_REQUIRED',roDomain.rfadc9b7f1a);await c.query("UPDATE loans SET state='DISPUTED' WHERE id=$1",[loan.id]);await c.query("UPDATE copies SET state='DISPUTED' WHERE id=$1",[loan.copy_id]);
      await c.query("INSERT INTO reports(reporter_id,target_type,target_id,category,explanation,library_id,evidence) VALUES($1,'loan',$2,'other',$3,$4,$5)",[actor.id,loan.id,input.reason,loan.library_id,JSON.stringify({loanId:loan.id,state:loan.state,originalDueAt:loan.original_due_at})]);
    }
    await event(c,loan.id,actor.id,action.toUpperCase(),action==='extensionApprove'?{dueAt:loan.due_at}:action==='dispute'?{reason:input.reason}:{});
    await notify(c,other,'loan',roDomain.ree216594c2,'/imprumuturi','loan:'+loan.id+':'+action+':'+(extension?.id??''));return {ok:true,loan,...(extension?{extensionId:extension.id}:{})};
  });
}
export async function gift(actor:Actor,input:any,action:'offer'|'accept'|'decline'){verified(actor);return transaction(async c=>{
  const offerResult=action==='offer'?null:await c.query('SELECT * FROM gift_offers WHERE id=$1',[input.giftId??input.id]);
  if(action!=='offer')ensure(offerResult?.rowCount,'NOT_FOUND',roDomain.rca6b54867c);
  const loanId=action==='offer'?(input.loanId??input.id):offerResult!.rows[0].loan_id;
  const result=await c.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE',[loanId]);ensure(result.rowCount,'NOT_FOUND',roDomain.r926e0c67ae);const loan=result.rows[0];
  const copy=(await c.query('SELECT * FROM copies WHERE id=$1 FOR UPDATE',[loan.copy_id])).rows[0];
  if(action==='offer'){
    allowedLoanAction(loan,actor.id,'gift.offer');ensure(copy.owner_id===actor.id,'FORBIDDEN',roDomain.r1d9462a847,403);
    const pending=await c.query("SELECT id FROM gift_offers WHERE loan_id=$1 AND state='PENDING'",[loan.id]);if(pending.rowCount)return {id:pending.rows[0].id};
    const r=await c.query(`INSERT INTO gift_offers(loan_id,donor_id,recipient_id) VALUES($1,$2,$3) ON CONFLICT(loan_id) WHERE state='PENDING' DO UPDATE SET donor_id=gift_offers.donor_id RETURNING id`,[loan.id,actor.id,loan.borrower_id]);
    await event(c,loan.id,actor.id,'GIFT_OFFERED');await notify(c,loan.borrower_id,'gift',roDomain.r5bc4126497,'/imprumuturi','gift:'+r.rows[0].id);return {id:r.rows[0].id};
  }
  const offer=(await c.query('SELECT * FROM gift_offers WHERE id=$1 FOR UPDATE',[offerResult!.rows[0].id])).rows[0];ensure(offer.recipient_id===actor.id,'FORBIDDEN',roDomain.rc2ed2ff724,403);
  if(offer.state==='ACCEPTED'&&action==='accept'||offer.state==='DECLINED'&&action==='decline')return {ok:true};ensure(offer.state==='PENDING','INVALID_TRANSITION',roDomain.r5fbcb08d18);
  if(action==='decline'){await c.query("UPDATE gift_offers SET state='DECLINED',decided_at=now() WHERE id=$1",[offer.id]);await event(c,loan.id,actor.id,'GIFT_DECLINED');return {ok:true};}
  allowedLoanAction(loan,actor.id,'gift.accept');ensure(copy.owner_id===offer.donor_id&&offer.donor_id===loan.lender_id,'OWNERSHIP_CONFLICT',roDomain.r441c2f60ce);
  ensure(input.confirmPermanent===true,'CONFIRM_REQUIRED',roDomain.r9afbac7b96);
  await c.query("UPDATE gift_offers SET state='ACCEPTED',decided_at=now() WHERE id=$1",[offer.id]);
  await c.query("UPDATE loans SET state='DONATED',closed_at=now() WHERE id=$1",[loan.id]);
  await c.query("UPDATE copies SET owner_id=$2,visibility='PRIVATE',state='AVAILABLE',collection_note='' WHERE id=$1",[copy.id,actor.id]);
  await c.query("INSERT INTO ownership_history(copy_id,previous_owner,new_owner,reason,loan_id) VALUES($1,$2,$3,'DONATED',$4)",[copy.id,offer.donor_id,actor.id,loan.id]);
  await c.query('UPDATE copy_photos SET owner_id=$2 WHERE copy_id=$1',[copy.id,actor.id]);
  await cancelReminders(c,loan.id);await awardLoan(c,loan,'DONATED');await event(c,loan.id,actor.id,'DONATED',{copyId:copy.id});await audit(c,actor.id,'COPY_DONATED','copy',copy.id,undefined,{loanId:loan.id});await notify(c,loan.lender_id,'gift',roDomain.r608b9d2eb3,'/imprumuturi','gift:'+offer.id+':accepted');return {ok:true};
});}
export async function resolveLoan(actor:Actor,input:any){admin(actor);ensure(input.reason?.length>=10&&['DISPUTED','LOST'].includes(input.state),'INVALID_RESOLUTION',roDomain.rb55a5f7f69);return transaction(async c=>{const r=await c.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE',[input.loanId??input.id]);ensure(r.rowCount&&r.rows[0].handed_over_at&&!['RETURNED','DONATED'].includes(r.rows[0].state),'INVALID_TRANSITION',roDomain.r74723b4649);await c.query('UPDATE loans SET state=$2,resolution_reason=$3 WHERE id=$1',[r.rows[0].id,input.state,input.reason]);await c.query('UPDATE copies SET state=$2 WHERE id=$1',[r.rows[0].copy_id,input.state]);await event(c,r.rows[0].id,actor.id,'MEDIATED',{state:input.state,reason:input.reason});await audit(c,actor.id,'LOAN_MEDIATED','loan',r.rows[0].id,input.reason);return {ok:true};});}
