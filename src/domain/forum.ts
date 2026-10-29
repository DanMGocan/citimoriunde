import {roDomain} from './ro.ts';
import {query,transaction} from '../lib/db';
import {config} from '../lib/config';
import {type Actor,verified,moderate,notify,audit,rateLimit} from './access';
import {ensure} from './errors.ts';
async function followers(c:any,topicId:string,actorId:string,postId:string,body:string){const members=await c.query('SELECT member_id FROM topic_preferences WHERE topic_id=$1 AND followed AND member_id<>$2',[topicId,actorId]);for(const m of members.rows)await notify(c,m.member_id,'forum',roDomain.r283327fd18,'/comunitate/'+topicId,'post:'+postId);const handles=[...body.matchAll(/(?:^|\s)@([a-z0-9_]{3,32})\b/g)].map(m=>m[1]).slice(0,10);if(handles.length){const users=await c.query('SELECT id FROM members WHERE handle=ANY($1) AND status=\'ACTIVE\' AND id<>$2',[handles,actorId]);for(const u of users.rows)await notify(c,u.id,'mention',roDomain.r4013814fae,'/comunitate/'+topicId,'mention:'+postId);}}
export async function forumList(actor:Actor|null,q='',library:string|null=null,page=1,view='latest',category=''){
 const topics=await query(`SELECT t.id,t.title,t.tags,t.pinned,t.locked,t.library_id,t.category_id,t.created_at,t.updated_at,m.display_name,m.handle,m.icon,c.title category_title,l.display_name library_name,
 (SELECT count(*)::int FROM forum_posts p WHERE p.topic_id=t.id AND p.state='VISIBLE') post_count,
 (SELECT read_at FROM topic_preferences pref WHERE pref.topic_id=t.id AND pref.member_id=$4) read_at,
 count(*) OVER()::int total FROM forum_topics t JOIN members m ON m.id=t.author_id JOIN forum_categories c ON c.id=t.category_id LEFT JOIN libraries l ON l.id=t.library_id
 WHERE t.state='VISIBLE' AND t.merged_into IS NULL AND ($1='' OR t.title ILIKE '%'||$1||'%' OR EXISTS(SELECT 1 FROM forum_posts p WHERE p.topic_id=t.id AND p.state='VISIBLE' AND p.body ILIKE '%'||$1||'%'))
 AND ($2::uuid IS NULL OR t.library_id=$2) AND ($5<>'unread' OR $4::text IS NOT NULL AND coalesce((SELECT read_at FROM topic_preferences pr WHERE pr.topic_id=t.id AND pr.member_id=$4),'epoch')<t.updated_at)
 AND ($6='' OR t.category_id=$6) AND ($5<>'followed' OR EXISTS(SELECT 1 FROM topic_preferences pr WHERE pr.topic_id=t.id AND pr.member_id=$4 AND pr.followed))
 AND ($5<>'bookmarks' OR EXISTS(SELECT 1 FROM topic_preferences pr WHERE pr.topic_id=t.id AND pr.member_id=$4 AND pr.bookmarked))
 ORDER BY t.pinned DESC,t.updated_at DESC LIMIT 20 OFFSET $3`,[q.slice(0,200),library,(page-1)*20,actor?.id??null,view,category]);
 return {topics:topics.rows,categories:(await query('SELECT * FROM forum_categories ORDER BY sort_order')).rows,total:topics.rows[0]?.total??0,page};
}
export async function topicDetail(actor:Actor|null,id:string,page=1):Promise<any>{const t=await query(`SELECT t.*,m.display_name,m.handle,m.icon FROM forum_topics t JOIN members m ON m.id=t.author_id WHERE t.id=$1 AND t.state='VISIBLE'`,[id]);ensure(t.rowCount,'NOT_FOUND',roDomain.r44e8aa6d67,404);if(t.rows[0].merged_into)return topicDetail(actor,t.rows[0].merged_into,page);const posts=await query(`SELECT p.id,p.topic_id,p.author_id,p.body,p.state,p.quoted_post_id,p.created_at,p.updated_at,CASE WHEN qp.state='VISIBLE' THEN qp.body ELSE NULL END quoted_body,m.display_name,m.handle,m.icon,
 (SELECT count(*)::int FROM forum_reactions r WHERE r.post_id=p.id) likes,EXISTS(SELECT 1 FROM forum_reactions r WHERE r.post_id=p.id AND r.member_id=$3) liked
 FROM forum_posts p JOIN members m ON m.id=p.author_id LEFT JOIN forum_posts qp ON qp.id=p.quoted_post_id WHERE p.topic_id=$1 ORDER BY p.created_at LIMIT 30 OFFSET $2`,[id,(page-1)*30,actor?.id??null]);
 if(actor)await query('INSERT INTO topic_preferences(topic_id,member_id,read_at) VALUES($1,$2,now()) ON CONFLICT(topic_id,member_id) DO UPDATE SET read_at=now()',[id,actor.id]);const preference=actor?(await query('SELECT bookmarked,followed FROM topic_preferences WHERE topic_id=$1 AND member_id=$2',[id,actor.id])).rows[0]:null;const total=(await query('SELECT count(*)::int n FROM forum_posts WHERE topic_id=$1',[id])).rows[0].n;return {topic:{...t.rows[0],bookmarked:preference?.bookmarked??false,followed:preference?.followed??false},total,posts:posts.rows.map(p=>({...p,body:p.state==='VISIBLE'?p.body:roDomain.r47bf8a97b6})),page};}
export async function createTopic(actor:Actor,input:any){verified(actor);await rateLimit('forum:'+actor.id,config.forumMinuteLimit);return transaction(async c=>{
 const category=await c.query('SELECT * FROM forum_categories WHERE id=$1',[input.categoryId]);ensure(category.rowCount,'INVALID_CATEGORY',roDomain.r75a145c2c8);if(category.rows[0].announcement)await moderate(actor,input.libraryId??null,c);
 if(input.libraryId)ensure((await c.query('SELECT 1 FROM libraries WHERE id=$1 AND active',[input.libraryId])).rowCount,'INVALID_LIBRARY',roDomain.rc678cd7b5f);ensure(input.title?.trim().length>=3&&input.body?.trim().length>=3&&input.body.length<=10000,'INVALID_POST',roDomain.r667271daab);
 const t=await c.query('INSERT INTO forum_topics(author_id,category_id,library_id,title,tags) VALUES($1,$2,$3,$4,$5) RETURNING id',[actor.id,input.categoryId,input.libraryId??null,input.title.trim(),(input.tags??[]).slice(0,5)]);await c.query('INSERT INTO forum_posts(topic_id,author_id,body) VALUES($1,$2,$3)',[t.rows[0].id,actor.id,input.body]);return {id:t.rows[0].id};});}
export async function replyTopic(actor:Actor,input:any){verified(actor);await rateLimit('forum:'+actor.id,config.forumMinuteLimit);return transaction(async c=>{
 const t=await c.query("SELECT * FROM forum_topics WHERE id=$1 AND state='VISIBLE' FOR UPDATE",[input.topicId??input.id]);ensure(t.rowCount&&!t.rows[0].merged_into,'NOT_FOUND',roDomain.ra73c667442);ensure(!t.rows[0].locked,'TOPIC_LOCKED',roDomain.r9ff9748781);ensure(input.body?.trim().length>=1&&input.body.length<=10000,'INVALID_POST',roDomain.r4928436bcf);if(input.quotedPostId)ensure((await c.query('SELECT 1 FROM forum_posts WHERE id=$1 AND topic_id=$2 AND state=\'VISIBLE\'',[input.quotedPostId,t.rows[0].id])).rowCount,'INVALID_QUOTE',roDomain.rdb356f6d27);const r=await c.query('INSERT INTO forum_posts(topic_id,author_id,body,quoted_post_id) VALUES($1,$2,$3,$4) RETURNING id',[t.rows[0].id,actor.id,input.body,input.quotedPostId??null]);await c.query('UPDATE forum_topics SET updated_at=now() WHERE id=$1',[t.rows[0].id]);await followers(c,t.rows[0].id,actor.id,r.rows[0].id,input.body);return {id:r.rows[0].id};});}
export async function editPost(actor:Actor,input:any,remove=false){verified(actor);return transaction(async c=>{
 const r=await c.query('SELECT p.*,t.locked,t.library_id,t.state topic_state FROM forum_posts p JOIN forum_topics t ON t.id=p.topic_id WHERE p.id=$1 FOR UPDATE OF p,t',[input.postId??input.id]);ensure(r.rowCount,'NOT_FOUND',roDomain.r021dc561a9);const p=r.rows[0],own=p.author_id===actor.id;
 if(own){
  if(remove&&p.state==='DELETED')return {ok:true};
  ensure(!p.locked&&p.topic_state==='VISIBLE','TOPIC_LOCKED',roDomain.rc8a1ca660e);
  ensure(p.state==='VISIBLE','POST_RESTRICTED',roDomain.r49a1dbc64e);
  ensure(remove||Date.now()-new Date(p.created_at).getTime()<=config.forumEditMinutes*60000,'EDIT_WINDOW',roDomain.r71d11fc392);
 }else{await moderate(actor,p.library_id,c);ensure(input.reason?.trim().length>=10,'REASON_REQUIRED',roDomain.r92af1342f5);}
 ensure(remove||typeof input.body==='string'&&input.body.trim().length>=1&&input.body.length<=10000,'INVALID_POST',roDomain.r959a77e90e);
 await c.query('INSERT INTO post_revisions(post_id,actor_id,old_body,reason) VALUES($1,$2,$3,$4)',[p.id,actor.id,p.body,input.reason??null]);
 await c.query('UPDATE forum_posts SET body=$2,state=$3,updated_at=now() WHERE id=$1',[p.id,remove?'':input.body,remove?'DELETED':p.state]);
 await c.query('UPDATE forum_topics SET updated_at=now() WHERE id=$1',[p.topic_id]);
 if(!own)await audit(c,actor.id,remove?'POST_DELETED':'POST_EDITED','post',p.id,input.reason);return {ok:true};
});}
export async function forumPreference(actor:Actor,input:any,action:string){verified(actor);if(action==='like'){const p=await query("SELECT 1 FROM forum_posts p JOIN forum_topics t ON t.id=p.topic_id WHERE p.id=$1 AND p.state='VISIBLE' AND t.state='VISIBLE'",[input.postId??input.id]);ensure(p.rowCount,'NOT_FOUND',roDomain.rd8607a3dc2);if(input.enabled===false)await query('DELETE FROM forum_reactions WHERE post_id=$1 AND member_id=$2',[input.postId??input.id,actor.id]);else await query('INSERT INTO forum_reactions(post_id,member_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[input.postId??input.id,actor.id]);}
 else{const column=action==='bookmark'?'bookmarked':action==='follow'?'followed':'read_at';await query(`INSERT INTO topic_preferences(topic_id,member_id,${column}) VALUES($1,$2,$3) ON CONFLICT(topic_id,member_id) DO UPDATE SET ${column}=$3`,[input.topicId??input.id,actor.id,action==='read'?new Date():input.enabled!==false]);}return {ok:true};}
export async function moderateForum(actor:Actor,input:any){return transaction(async c=>{
 const topicId=input.topicId??input.id;
 // Opposing merge requests must acquire the same rows in the same order.
 const r=await c.query('SELECT * FROM forum_topics WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[topicId,...(input.action==='merge'?[input.targetId]:[])]]);
 const t=r.rows.find(row=>row.id===topicId);ensure(t,'NOT_FOUND',roDomain.r44e8aa6d67);await moderate(actor,t.library_id,c);ensure(typeof input.reason==='string'&&input.reason.trim().length>=10,'REASON_REQUIRED',roDomain.r75f727e309);const action=input.action;let auditData:Record<string,unknown>={};
 if(action==='lock'||action==='pin')await c.query(`UPDATE forum_topics SET ${action==='lock'?'locked':'pinned'}=$2 WHERE id=$1`,[t.id,input.enabled!==false]);
 else if(action==='hide'||action==='restore')await c.query('UPDATE forum_topics SET state=$2 WHERE id=$1',[t.id,action==='hide'?'HIDDEN':'VISIBLE']);
 else if(action==='move'){
  ensure(!t.merged_into,'INVALID_MERGE',roDomain.r8b10b3be7b);
  ensure(typeof input.categoryId==='string'&&input.categoryId.length>0&&(await c.query('SELECT 1 FROM forum_categories WHERE id=$1',[input.categoryId])).rowCount,'INVALID_CATEGORY',roDomain.r75a145c2c8);
  // An omitted destination preserves the current city. Only an explicit null
  // moves a topic into the global area, which requires global moderation scope.
  const destination=Object.hasOwn(input,'libraryId')?input.libraryId:t.library_id;
  ensure(destination===null||typeof destination==='string'&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(destination),'INVALID_LIBRARY',roDomain.rc678cd7b5f);
  if(destination!==null)ensure((await c.query('SELECT 1 FROM libraries WHERE id=$1 AND active',[destination])).rowCount,'INVALID_LIBRARY',roDomain.rc678cd7b5f);
  await moderate(actor,destination,c);
  await c.query('UPDATE forum_topics SET category_id=$2,library_id=$3,updated_at=now() WHERE id=$1',[t.id,input.categoryId,destination]);
  auditData={fromCategoryId:t.category_id,toCategoryId:input.categoryId,fromLibraryId:t.library_id,toLibraryId:destination};
 }
 else if(action==='merge'){
  const target=await c.query('SELECT * FROM forum_topics WHERE id=$1 FOR UPDATE',[input.targetId]);ensure(target.rowCount&&target.rows[0].id!==t.id&&!t.merged_into&&!target.rows[0].merged_into,'INVALID_MERGE',roDomain.r8b10b3be7b);await moderate(actor,target.rows[0].library_id,c);
  await c.query(`INSERT INTO topic_preferences(topic_id,member_id,bookmarked,followed,read_at)
    SELECT $2,member_id,bookmarked,followed,NULL FROM topic_preferences WHERE topic_id=$1
    ON CONFLICT(topic_id,member_id) DO UPDATE SET bookmarked=topic_preferences.bookmarked OR EXCLUDED.bookmarked,followed=topic_preferences.followed OR EXCLUDED.followed,read_at=NULL`,[t.id,input.targetId]);
  await c.query('UPDATE forum_posts SET topic_id=$2 WHERE topic_id=$1',[t.id,input.targetId]);
  await c.query('UPDATE forum_topics SET merged_into=$2 WHERE id=$1 OR merged_into=$1',[t.id,input.targetId]);
  await c.query('UPDATE forum_topics SET updated_at=now() WHERE id=$1',[input.targetId]);
 }
 else ensure(false,'INVALID_ACTION',roDomain.re4bf7d69cf);await audit(c,actor.id,'FORUM_'+action.toUpperCase(),'topic',t.id,input.reason.trim(),auditData);return {ok:true};});}
