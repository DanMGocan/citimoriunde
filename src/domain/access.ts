import {roDomain} from './ro.ts';
import type { PoolClient } from 'pg';
import { createHash,randomUUID } from 'node:crypto';
import { auth,hasAdminStepUp } from '../lib/auth';
import { query } from '../lib/db';
import { config } from '../lib/config';
import { ensure } from './errors.ts';
export type Actor={id:string;role:'MEMBER'|'MODERATOR'|'ADMIN';verified:boolean;adult:boolean;active:boolean;homeLibraryId:string|null;icon:string;sessionId:string;stepUp:boolean};
export async function actorFrom(headers:Headers):Promise<Actor|null>{
  const session=await auth.api.getSession({headers});
  if(!session) return null;
  await query(`INSERT INTO members(id,display_name,handle) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`,[session.user.id,session.user.name.slice(0,80),'cititor_'+createHash('sha256').update(session.user.id).digest('hex').slice(0,12)]);
  const {rows}=await query('SELECT * FROM members WHERE id=$1',[session.user.id]);
  const m=rows[0];
  return {id:m.id,role:m.role,verified:session.user.emailVerified,adult:m.adult,active:m.status==='ACTIVE',homeLibraryId:m.home_library_id,icon:m.icon,sessionId:session.session.id,stepUp:config.environment!=='production'||await hasAdminStepUp(m.id,session.session.id)};
}
export function signedIn(actor:Actor|null):asserts actor is Actor {ensure(actor,'AUTH_REQUIRED',roDomain.r2170c699b0,401);ensure(actor.active,'ACCOUNT_RESTRICTED',roDomain.rf92c8549b0,403);}
export function verified(actor:Actor|null):asserts actor is Actor{signedIn(actor);ensure(actor.verified&&actor.adult,'VERIFICATION_REQUIRED',roDomain.r08b0dc7ea0,403);}
export function admin(actor:Actor|null):asserts actor is Actor{verified(actor);ensure(actor.role==='ADMIN','FORBIDDEN',roDomain.r7be669d0fa,403);ensure(actor.stepUp,'TWO_FACTOR_REQUIRED',roDomain.r9955440482,403);}
export async function moderate(actor:Actor|null,libraryId:string|null,client?:PoolClient){verified(actor);if(actor.role==='ADMIN'){admin(actor);return;}ensure(actor.role==='MODERATOR','FORBIDDEN',roDomain.r1d7ca9da01,403);const sql='SELECT 1 FROM moderator_scopes WHERE member_id=$1 AND (global_scope OR library_id=$2)';const scope=client?await client.query(sql,[actor.id,libraryId]):await query(sql,[actor.id,libraryId]);ensure(scope.rowCount,'FORBIDDEN',roDomain.r79b8cbd755,403);}
export async function rateLimit(key:string,max:number,seconds=60){
  const {rows}=await query(`INSERT INTO rate_limits(key,count,window_start,expires_at) VALUES($1,1,now(),now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,window_start=CASE WHEN rate_limits.expires_at<now() THEN now() ELSE rate_limits.window_start END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+$2*interval '1 second' ELSE rate_limits.expires_at END RETURNING count`,[key,seconds]);
  ensure(rows[0].count<=max,'RATE_LIMIT',roDomain.rbe1bb6a7e9,429);
}
export async function audit(client:PoolClient,actor:string|null,action:string,targetType:string,targetId:string|null,reason?:string,data:unknown={}){await client.query('INSERT INTO audit_log(actor_id,action,target_type,target_id,reason,data) VALUES($1,$2,$3,$4,$5,$6)',[actor,action,targetType,targetId,reason??null,JSON.stringify(data)]);}
export async function notify(client:PoolClient,memberId:string,type:string,title:string,href:string,dedupe:string){
  await client.query(`INSERT INTO notifications(member_id,type,title,href,dedupe_key) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM notification_preferences WHERE member_id=$1 AND category=$2 AND NOT in_app) ON CONFLICT DO NOTHING`,[memberId,type,title,href,dedupe]);
  await client.query(`INSERT INTO jobs(type,dedupe_key,payload) SELECT 'notification_email',$1,$2 WHERE EXISTS(SELECT 1 FROM notification_preferences WHERE member_id=$3 AND category=$4 AND email) ON CONFLICT DO NOTHING`,['mail:'+memberId+':'+dedupe,JSON.stringify({memberId,type,title,href}),memberId,type]);
}
export const requestKey=()=>randomUUID();
