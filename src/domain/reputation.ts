import {roDomain} from './ro.ts';
import type { PoolClient } from 'pg';
import { query,transaction } from '../lib/db';
import { config } from '../lib/config';
import { type Actor,verified,admin,audit } from './access';
import { ensure } from './errors.ts';
import {canonicalWork} from './catalogue-work';
type MemberStatsRow={
  collection:number;
  available:number;
  lending:number;
  borrowing:number;
  returned_lending:number;
  returned_borrowing:number;
  gifts_given:number;
  gifts_received:number;
  read:number;
  genres:number;
  monthly_read:number;
  monthly_genres:number;
  rating_count:number;
  rating:string|null;
  xp:number;
};
export type MemberStats=MemberStatsRow&{level:number;nextLevelXp:number};
/** Lock all reward scopes in one canonical order before reading eligibility/caps.
 * A row/event lock alone does not protect simultaneous awards for different events.
 */
export async function lockRewards(c:PoolClient,...scopes:string[]){
  for(const scope of [...new Set(scopes)].sort())await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",['reward:'+scope]);
}
export async function award(c:PoolClient,memberId:string,event:string,reason:string,points:number,data:unknown={}){
  if(points===0)return;
  await c.query('INSERT INTO xp_ledger(member_id,event_key,reason,points,rule_version,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[memberId,event,reason,points,config.rewardRuleVersion,JSON.stringify(data)]);
}
export async function awardLoan(c:PoolClient,loan:any,outcome:'RETURNED'|'DONATED'){
  await lockRewards(c,'copy:'+loan.copy_id,'pair:'+JSON.stringify([loan.lender_id,loan.borrower_id].sort()));
  const first=await c.query('INSERT INTO reward_events(loan_id,outcome,rule_version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING loan_id',[loan.id,outcome,config.rewardRuleVersion]);if(!first.rowCount)return;
  const recent=await c.query(`SELECT 1 FROM xp_ledger WHERE reason IN ('lender_return','borrower_return','gift') AND (data->>'copyId'=$1 OR ((data->>'lenderId'=$2 AND data->>'borrowerId'=$3) OR (data->>'lenderId'=$3 AND data->>'borrowerId'=$2))) AND created_at>now()-$4*interval '1 day' LIMIT 1`,[loan.copy_id,loan.lender_id,loan.borrower_id,config.pairCooldownDays]);
  if(recent.rowCount||!loan.acknowledged_at&&outcome==='RETURNED'){
    await c.query('INSERT INTO reward_flags(member_id,loan_id,reason) VALUES($1,$2,$3)',[loan.lender_id,loan.id,recent.rowCount?'cooldown-pair-or-copy':'missing-participant-acknowledgement']);return;
  }
  const data={loanId:loan.id,copyId:loan.copy_id,lenderId:loan.lender_id,borrowerId:loan.borrower_id,participantAssertions:true};
  if(outcome==='RETURNED'){
    await award(c,loan.lender_id,'loan:'+loan.id,'lender_return',config.rewardLender,data);
    await award(c,loan.borrower_id,'loan:'+loan.id,'borrower_return',config.rewardBorrower,data);
    if(loan.returned_at&&new Date(loan.returned_at)<=new Date(loan.due_at))await award(c,loan.borrower_id,'loan:'+loan.id,'on_time',config.rewardOnTime,data);
  }else await award(c,loan.lender_id,'loan:'+loan.id,'gift',config.rewardDonor,data);
}
export async function memberStats(id:string):Promise<MemberStats>{
  const {rows}=await query<MemberStatsRow>(`SELECT
    (SELECT count(*)::int FROM copies WHERE owner_id=$1 AND state<>'REMOVED') collection,
    (SELECT count(*)::int FROM copies WHERE owner_id=$1 AND state='AVAILABLE') available,
    (SELECT count(*)::int FROM loans WHERE lender_id=$1 AND state IN ('ON_LOAN','RETURN_PENDING','DISPUTED','LOST')) lending,
    (SELECT count(*)::int FROM loans WHERE borrower_id=$1 AND state IN ('ON_LOAN','RETURN_PENDING','DISPUTED','LOST')) borrowing,
    (SELECT count(*)::int FROM loans WHERE lender_id=$1 AND state='RETURNED') returned_lending,
    (SELECT count(*)::int FROM loans WHERE borrower_id=$1 AND state='RETURNED') returned_borrowing,
    (SELECT count(*)::int FROM gift_offers WHERE donor_id=$1 AND state='ACCEPTED') gifts_given,
    (SELECT count(*)::int FROM gift_offers WHERE recipient_id=$1 AND state='ACCEPTED') gifts_received,
    (SELECT count(DISTINCT coalesce(w.merged_into,w.id))::int FROM reading_states r JOIN works w ON w.id=r.work_id WHERE member_id=$1 AND r.state='finished') read,
    (SELECT count(DISTINCT canonical.genre)::int FROM reading_states r JOIN works w ON w.id=r.work_id JOIN works canonical ON canonical.id=coalesce(w.merged_into,w.id) WHERE member_id=$1 AND r.state='finished') genres,
    (SELECT count(DISTINCT coalesce(w.merged_into,w.id))::int FROM reading_states r JOIN works w ON w.id=r.work_id WHERE member_id=$1 AND first_finished_at>=date_trunc('month',now()) AND r.state='finished') monthly_read,
    (SELECT count(DISTINCT canonical.genre)::int FROM reading_states r JOIN works w ON w.id=r.work_id JOIN works canonical ON canonical.id=coalesce(w.merged_into,w.id) WHERE member_id=$1 AND r.state='finished' AND r.first_finished_at>=date_trunc('month',now())) monthly_genres,
    (SELECT count(*)::int FROM member_reviews WHERE recipient_id=$1 AND published_at IS NOT NULL AND state='VISIBLE') rating_count,
    (SELECT round(avg(stars),2) FROM member_reviews WHERE recipient_id=$1 AND published_at IS NOT NULL AND state='VISIBLE') rating,
    (SELECT coalesce(sum(points),0)::int FROM xp_ledger WHERE member_id=$1) xp`,[id]);
  const s=rows[0],xp=Math.max(0,s.xp);return {...s,level:Math.floor(Math.sqrt(xp/100))+1,nextLevelXp:Math.pow(Math.floor(Math.sqrt(xp/100))+1,2)*100};
}
export const BADGES=[
  {id:'first-shelf',name:'Primul raft',description:roDomain.ra094d92d70,metric:'collection',threshold:1,kind:'collection'},
  {id:'shelf-5',name:roDomain.rb7749d1fef,description:roDomain.rf19238de59,metric:'collection',threshold:5,kind:'collection'},
  {id:'shelf-10',name:roDomain.rc99f2abae3,description:roDomain.r444c01931a,metric:'collection',threshold:10,kind:'collection'},
  {id:'shelf-25',name:roDomain.r616ed23f04,description:roDomain.r33f34ad27a,metric:'collection',threshold:25,kind:'collection'},
  {id:'lender-1',name:roDomain.r7394bbae16,description:roDomain.rbdfd04337d,metric:'returned_lending',threshold:1,kind:'transaction'},
  {id:'lender-5',name:'Raft deschis',description:roDomain.r15ca98f18d,metric:'returned_lending',threshold:5,kind:'transaction'},
  {id:'lender-10',name:roDomain.rec9671843c,description:roDomain.r48e041c0d0,metric:'returned_lending',threshold:10,kind:'transaction'},
  {id:'borrower-1',name:roDomain.rb170444c1f,description:roDomain.r3b74c2bc3a,metric:'returned_borrowing',threshold:1,kind:'transaction'},
  {id:'borrower-5',name:roDomain.rbf62a94eb1,description:roDomain.r15ca98f18d,metric:'returned_borrowing',threshold:5,kind:'transaction'},
  {id:'gift-1',name:'Dar de carte',description:'Un dar acceptat de cititor.',metric:'gifts_given',threshold:1,kind:'transaction'},
  {id:'gift-3',name:roDomain.r14c9bd3875,description:'Trei daruri acceptate.',metric:'gifts_given',threshold:3,kind:'transaction'},
  {id:'gift-10',name:roDomain.r161136d970,description:'Zece daruri acceptate.',metric:'gifts_given',threshold:10,kind:'transaction'},
  {id:'received-1',name:roDomain.r5af221a192,description:'Un dar acceptat.',metric:'gifts_received',threshold:1,kind:'transaction'},
  {id:'read-1',name:roDomain.r7bfa1a99d2,description:roDomain.r0abb428d6e,metric:'read',threshold:1,kind:'self-reported'},
  {id:'read-10',name:'Zece lumi',description:'Zece lecturi declarate de tine.',metric:'read',threshold:10,kind:'self-reported'},
  {id:'read-25',name:roDomain.rdc1e1da33c,description:'25 de lecturi declarate de tine.',metric:'read',threshold:25,kind:'self-reported'},
  {id:'genres-3',name:roDomain.rfb2cc0974d,description:'Lecturi declarate din trei genuri.',metric:'genres',threshold:3,kind:'self-reported'},
  {id:'genres-5',name:'Explorator de genuri',description:'Lecturi declarate din cinci genuri.',metric:'genres',threshold:5,kind:'self-reported'},
  {id:'monthly-3',name:roDomain.r66d54277fa,description:roDomain.r02f6acdc07,metric:'monthly_read',threshold:3,kind:'self-reported'}
];
export function badgesFor(stats:Record<string,any>){return BADGES.map(b=>({...b,earned:Number(stats[b.metric]??0)>=b.threshold,progress:Math.min(b.threshold,Number(stats[b.metric]??0))}));}
export function monthlyChallenges(stats:Record<string,any>){return [
 {id:'monthly-reading',name:roDomain.r22ac60b541,description:roDomain.r6cae9f2f7d,progress:Math.min(config.monthlyReadingTarget,Number(stats.monthly_read??0)),target:config.monthlyReadingTarget,selfReported:true},
 {id:'monthly-genres',name:roDomain.ra06334c90f,description:roDomain.ra5379abed2,progress:Math.min(config.monthlyGenresTarget,Number(stats.monthly_genres??0)),target:config.monthlyGenresTarget,selfReported:true}
 ].map(c=>({...c,period:new Date().toISOString().slice(0,7),completed:c.progress>=c.target}));}
export async function setReading(actor:Actor,input:any){verified(actor);return transaction(async c=>{
  await lockRewards(c,'member:'+actor.id);
  const workId=await canonicalWork(c,input.workId);
  ensure(['want','reading','finished','abandoned'].includes(input.state),'INVALID_STATE',roDomain.rd36c94110c);
  await c.query(`INSERT INTO reading_states(member_id,work_id,state,first_finished_at) VALUES($1,$2,$3,CASE WHEN $3='finished' THEN now() ELSE NULL END) ON CONFLICT(member_id,work_id) DO UPDATE SET state=$3,first_finished_at=CASE WHEN $3='finished' THEN coalesce(reading_states.first_finished_at,now()) ELSE reading_states.first_finished_at END,updated_at=now()`,[actor.id,workId,input.state]);
  if(input.state==='finished'){
    const r=await c.query(`SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='reading' AND created_at>=date_trunc('month',now())`,[actor.id]);
    const awarded=await c.query(`SELECT 1 FROM xp_ledger l WHERE member_id=$1 AND reason='reading' AND EXISTS(SELECT 1 FROM works w WHERE w.id::text=l.data->>'workId' AND (w.id=$2 OR w.merged_into=$2))`,[actor.id,workId]);
    if(r.rows[0].n<config.readingMonthlyCap&&!awarded.rowCount)await award(c,actor.id,'work:'+workId,'reading',config.rewardReading,{workId,selfReported:true});
  }return {ok:true};});}
export async function adjustReward(actor:Actor,input:any){admin(actor);ensure(Number.isInteger(input.points)&&Math.abs(input.points)<=10000&&input.reason?.length>=10&&/^[a-f0-9-]{36}$/i.test(input.idempotencyKey??''),'INVALID_ADJUSTMENT',roDomain.r74ca8678f1);return transaction(async c=>{const r=await c.query('INSERT INTO xp_ledger(member_id,event_key,reason,points,rule_version,data,actor_id) VALUES($1,$2,\'adjustment\',$3,$4,$5,$6) ON CONFLICT(member_id,event_key,reason) DO NOTHING RETURNING id',[input.memberId,'adjustment:'+input.idempotencyKey,input.points,config.rewardRuleVersion,JSON.stringify({explanation:input.reason}),actor.id]);if(r.rowCount)await audit(c,actor.id,'XP_ADJUSTED','member',input.memberId,input.reason);return {ok:true};});}
