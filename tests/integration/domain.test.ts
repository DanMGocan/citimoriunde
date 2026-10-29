/** Real PostgreSQL integration tests. Synthetic fixtures, only in a guarded *_test DB.
 * These do not claim external-provider, population-source or physical-event verification.
 */
import {describe,test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {assertIsolatedDatabase,fixtureMember,fixtureLibrary,closeTestPool} from './helpers.ts';
import {pool,query} from '../../src/lib/db.ts';
import {config} from '../../src/lib/config.ts';
import type {Actor} from '../../src/domain/access.ts';
import {addCopy,mergeWorks,searchCatalogue,updateCopy,workDetail} from '../../src/domain/catalogue.ts';
import {requestLoan,decideRequest,transitionLoan,gift,resolveLoan} from '../../src/domain/loans.ts';
import {libraries,requestLibrary,decideLibrary} from '../../src/domain/libraries.ts';
import {messages,sendMessage,reportMessagePreview,blockMember} from '../../src/domain/messaging.ts';
import {fileReport,reportEvidence,setRole,moderateContent,warnMember,moderationDashboard} from '../../src/domain/moderation.ts';
import {createTopic,replyTopic,editPost,moderateForum,forumList,forumPreference} from '../../src/domain/forum.ts';
import {bookReview,memberReview,reviewResponse} from '../../src/domain/reviews.ts';
import {setReading,memberStats,adjustReward} from '../../src/domain/reputation.ts';
import {exportAccount,requestPrivacy,resolvePrivacy} from '../../src/domain/privacy.ts';
import {updateProfile,AVATAR_ICONS,profile} from '../../src/domain/profiles.ts';
import {processMaintenance,processDomainJob} from '../../src/domain/maintenance.ts';

assertIsolatedDatabase();
after(closeTestPool);
const rejectsCode=(promise:Promise<unknown>,code:string)=>assert.rejects(promise,(error:any)=>error?.code===code);
async function first(sql:string,args:unknown[]=[]){const result=await query(sql,args);assert.ok(result.rows[0],sql);return result.rows[0];}
async function fixtures(){
  const library=await fixtureLibrary();
  const [lender,borrower,other,admin]=await Promise.all([
    fixtureMember(),fixtureMember(),fixtureMember(),fixtureMember({role:'ADMIN'}),
  ]);
  for(const actor of [lender,borrower,other,admin]){
    await query('UPDATE members SET home_library_id=$2 WHERE id=$1',[actor.id,library]);actor.homeLibraryId=library;
  }
  return {library,lender,borrower,other,admin};
}
async function book(owner:Actor,library:string,extra:Record<string,unknown>={}){
  return addCopy(owner,{title:'TEST Carte sintetică '+randomUUID(),author:'Autor sintetic',libraryId:library,language:'ro',visibility:'PUBLIC',condition:'good',...extra});
}
async function activeLoan(f:Awaited<ReturnType<typeof fixtures>>,days=28){
  const copy=await book(f.lender,f.library);
  const request=await requestLoan(f.borrower,{copyId:copy.id});
  const accepted=await decideRequest(f.lender,{id:request.id,durationDays:days},'ACCEPTED');
  assert.ok(accepted.loanId);
  await transitionLoan(f.lender,{id:accepted.loanId},'handover');
  await transitionLoan(f.borrower,{id:accepted.loanId},'acknowledge');
  return {copy,loanId:accepted.loanId};
}

describe('catalogue, authorisation and libraries',{concurrency:false},()=>{
  test('concurrent demotions preserve the last active administrator',async()=>{
    // These are disposable fixture roles, restored even if an assertion fails.
    // The explicit isolation guard also applies when this file is run directly.
    assertIsolatedDatabase();
    const previous=await query("SELECT id,role FROM members WHERE role='ADMIN' AND status='ACTIVE'");
    const firstAdmin=await fixtureMember({role:'ADMIN'}),secondAdmin=await fixtureMember({role:'ADMIN'});
    try{
      await query("UPDATE members SET role='MEMBER' WHERE id=ANY($1::text[])",[previous.rows.map(row=>row.id)]);
      const result=await Promise.allSettled([
        setRole(firstAdmin,{memberId:secondAdmin.id,role:'MEMBER',reason:'TEST concurrent last-administrator guard.'}),
        setRole(secondAdmin,{memberId:firstAdmin.id,role:'MEMBER',reason:'TEST concurrent last-administrator guard.'}),
      ]);
      assert.equal(result.filter(row=>row.status==='fulfilled').length,1);
      const denied=result.find((row):row is PromiseRejectedResult=>row.status==='rejected');
      assert.ok(denied);assert.equal(denied.reason?.code,'LAST_ADMIN');
      assert.equal((await first("SELECT count(*)::int n FROM members WHERE role='ADMIN' AND status='ACTIVE'")).n,1);
      assert.equal((await first("SELECT count(*)::int n FROM audit_log WHERE action='ROLE_CHANGED' AND target_id=ANY($1::text[])",[[firstAdmin.id,secondAdmin.id]])).n,1);
    }finally{
      await query("UPDATE members SET role='ADMIN' WHERE id=ANY($1::text[])",[previous.rows.map(row=>row.id)]);
      await query("UPDATE members SET role='MEMBER' WHERE id=ANY($1::text[])",[[firstAdmin.id,secondAdmin.id]]);
    }
  });

  test('unverified, nonadult and restricted actors cannot bypass domain actions; member cannot promote itself',async()=>{
    const f=await fixtures();
    await rejectsCode(book({...f.lender,verified:false},f.library),'VERIFICATION_REQUIRED');
    await rejectsCode(book({...f.lender,adult:false},f.library),'VERIFICATION_REQUIRED');
    const copy=await book(f.lender,f.library);
    await rejectsCode(requestLoan({...f.borrower,active:false},{copyId:copy.id}),'ACCOUNT_RESTRICTED');
    await rejectsCode(setRole(f.borrower,{memberId:f.borrower.id,role:'ADMIN'}),'FORBIDDEN');
    assert.equal((await first('SELECT role FROM members WHERE id=$1',[f.borrower.id])).role,'MEMBER');
  });

  test('member warnings require the relevant moderator scope, keep reason evidence and leave role and status unchanged',async()=>{
    const f=await fixtures(),moderator=await fixtureMember({role:'MODERATOR'}),wrongLibrary=await fixtureLibrary();
    const input={memberId:f.borrower.id,reason:'TEST documented community warning with a clear appeal route.'};
    const original=await first('SELECT role,status,home_library_id FROM members WHERE id=$1',[f.borrower.id]);
    await rejectsCode(warnMember(f.lender,input),'FORBIDDEN');
    await query('INSERT INTO moderator_scopes(member_id,library_id) VALUES($1,$2)',[moderator.id,wrongLibrary]);
    await rejectsCode(warnMember(moderator,input),'FORBIDDEN');
    await query('UPDATE moderator_scopes SET library_id=$2 WHERE member_id=$1',[moderator.id,f.library]);
    await rejectsCode(warnMember(moderator,{...input,libraryId:wrongLibrary}),'FORBIDDEN');
    await rejectsCode(warnMember(moderator,{...input,memberId:f.admin.id}),'FORBIDDEN');
    assert.equal((await first('SELECT count(*)::int n FROM member_warnings WHERE member_id=$1',[f.borrower.id])).n,0);
    const result=await warnMember(moderator,input);assert.ok(result.id);
    const warning=await first('SELECT member_id,actor_id,library_id,reason FROM member_warnings WHERE id=$1',[result.id]);
    assert.deepEqual(warning,{member_id:f.borrower.id,actor_id:moderator.id,library_id:f.library,reason:input.reason});
    const audit=await first("SELECT actor_id,reason,data FROM audit_log WHERE action='MEMBER_WARNED' AND target_id=$1",[f.borrower.id]);
    assert.equal(audit.actor_id,moderator.id);assert.equal(audit.reason,input.reason);assert.equal(audit.data.warningId,result.id);assert.equal(audit.data.libraryId,f.library);
    const notification=await first('SELECT type,title,href FROM notifications WHERE member_id=$1 AND dedupe_key=$2',[f.borrower.id,'warning:'+result.id]);
    assert.equal(notification.type,'moderation');assert.ok(notification.title.includes(input.reason));assert.equal(notification.href,'/sesizari');
    assert.deepEqual(await first('SELECT role,status,home_library_id FROM members WHERE id=$1',[f.borrower.id]),original);
    assert.equal((await first('SELECT count(*)::int n FROM member_warnings WHERE member_id=$1',[f.borrower.id])).n,1);
  });

  test('concurrent existing-work submission creates one work/edition and multiple owned copies',async()=>{
    const f=await fixtures(),title='TEST Titlu concurent '+randomUUID();
    const input={title,authors:['Emily Brontë'],libraryId:f.library,language:'ro',publisher:'Editură sintetică',year:2020,visibility:'PUBLIC'};
    const copies=await Promise.all([addCopy(f.lender,input),addCopy(f.borrower,{...input,title:title.toUpperCase(),authors:['Brontë, Emily']})]);
    assert.equal(copies[0].workId,copies[1].workId);assert.equal(copies[0].editionId,copies[1].editionId);assert.notEqual(copies[0].id,copies[1].id);
    assert.equal((await first('SELECT count(*)::int n FROM copies WHERE edition_id=$1',[copies[0].editionId])).n,2);
    const anotherEdition=await addCopy(f.other,{...input,workId:copies[0].workId,year:2021});
    assert.equal(anotherEdition.workId,copies[0].workId);assert.notEqual(anotherEdition.editionId,copies[0].editionId);
    const anotherAuthor=await addCopy(f.other,{...input,authors:['Alt autor sintetic']});
    assert.notEqual(anotherAuthor.workId,copies[0].workId);
  });

  test('ISBN-10/13 concurrency shares one authoritative edition; invalid ISBNs do not insert',async()=>{
    const f=await fixtures();
    const result=await Promise.all([
      book(f.lender,f.library,{isbn:'0-306-40615-2',title:'TEST ISBN fixture'}),
      book(f.borrower,f.library,{isbn:'9780306406157',title:'TEST Alternative title for identical ISBN'}),
    ]);
    assert.equal(result[0].editionId,result[1].editionId);assert.equal(result[0].workId,result[1].workId);
    await rejectsCode(book(f.lender,f.library,{isbn:'9780306406158'}),'ISBN_INVALID');
    await rejectsCode(book(f.lender,f.library,{isbn:'4006381333931'}),'ISBN_INVALID');
    assert.equal((await first('SELECT count(*)::int n FROM editions WHERE isbn=$1',['9780306406157'])).n,1);
  });

  test('all four required title inputs find one work; author nationality is irrelevant',async()=>{
    const f=await fixtures();
    const copy=await book(f.lender,f.library,{title:'La răscruce de vânturi',authors:['Emily Brontë'],translator:'Traducător sintetic'});
    for(const q of ['La rascruce de vanturi','La Rascruce de Vanturi','La rascruce de vanturi Emily Bronte','La răscruce de vânturi — Emily Brontë']){
      const result=await searchCatalogue(q,f.library);assert.deepEqual(result.works.map((w:any)=>w.id),[copy.workId]);
    }
    const extra=await addCopy(f.borrower,{editionId:copy.editionId,libraryId:f.library,visibility:'PUBLIC'});
    assert.equal(extra.workId,copy.workId);assert.notEqual(extra.id,copy.id);
  });

  test('transactional chained work merges preserve copies, loan references, aliases and reward uniqueness',async()=>{
    const f=await fixtures(),firstCopy=await book(f.lender,f.library),secondCopy=await book(f.lender,f.library),thirdCopy=await book(f.lender,f.library);
    const req=await requestLoan(f.borrower,{copyId:firstCopy.id});const reservation=await decideRequest(f.lender,{id:req.id},'ACCEPTED');
    await setReading(f.borrower,{workId:firstCopy.workId,state:'finished'});
    const review=await bookReview(f.borrower,{workId:firstCopy.workId,stars:4,body:'TEST review retained through redirects.'});
    await mergeWorks(f.admin,firstCopy.workId,secondCopy.workId,'Synthetic duplicate review evidence.');
    await mergeWorks(f.admin,secondCopy.workId,thirdCopy.workId,'Synthetic chained duplicate review evidence.');
    const resolved=await workDetail(firstCopy.workId,f.borrower);assert.equal(resolved.work.id,thirdCopy.workId);
    const newCopy=await addCopy(f.other,{workId:firstCopy.workId,libraryId:f.library,visibility:'PUBLIC'});assert.equal(newCopy.workId,thirdCopy.workId);
    assert.equal((await first('SELECT copy_id FROM loans WHERE id=$1',[reservation.loanId])).copy_id,firstCopy.id);
    assert.equal((await first('SELECT merged_into FROM works WHERE id=$1',[firstCopy.workId])).merged_into,thirdCopy.workId);
    await setReading(f.borrower,{workId:firstCopy.workId,state:'finished'});
    await setReading(f.borrower,{workId:secondCopy.workId,state:'finished'});
    await bookReview(f.borrower,{workId:firstCopy.workId,stars:5,body:'TEST edit through the oldest redirect.'});
    const retainedReview=await first('SELECT id,work_id,stars FROM book_reviews WHERE member_id=$1',[f.borrower.id]);
    assert.equal(retainedReview.id,review.id);assert.equal(retainedReview.work_id,thirdCopy.workId);assert.equal(retainedReview.stars,5);
    assert.equal((await first('SELECT count(*)::int n FROM book_reviews WHERE member_id=$1',[f.borrower.id])).n,1);
    assert.equal((await first('SELECT count(*)::int n FROM reading_states WHERE member_id=$1 AND work_id=$2',[f.borrower.id,thirdCopy.workId])).n,1);
    assert.equal((await first('SELECT count(*)::int n FROM reading_states WHERE member_id=$1 AND work_id=ANY($2::uuid[])',[f.borrower.id,[firstCopy.workId,secondCopy.workId]])).n,0);
    assert.equal((await first("SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='reading'",[f.borrower.id])).n,1);
    const publicEdition=resolved.editions[0];assert.ok(!Object.hasOwn(publicEdition.provenance,'actor'));
  });

  test('review and reading submissions waiting behind a merge attach to the canonical work',async()=>{
    const f=await fixtures(),source=await book(f.lender,f.library),target=await book(f.lender,f.library);
    const blockingReview=await bookReview(f.other,{workId:source.workId,stars:3,body:'TEST row used to hold the merge before commit.'});
    const blocker=await pool.connect(),pending:Promise<unknown>[]=[];let held=false;
    try{
      await blocker.query('BEGIN');held=true;
      await blocker.query('SELECT id FROM book_reviews WHERE id=$1 FOR UPDATE',[blockingReview.id]);
      const merging=mergeWorks(f.admin,source.workId,target.workId,'TEST deterministic review and reading merge serialization.');
      merging.catch(()=>{});pending.push(merging);
      // The held review stops merge after it acquires the work rows. NOWAIT
      // observes that barrier without relying only on a guessed delay.
      let workLocked=false;
      for(let attempt=0;attempt<100&&!workLocked;attempt++){
        try{await query('SELECT id FROM works WHERE id=$1 FOR SHARE NOWAIT',[source.workId]);}
        catch(error:any){if(error?.code!=='55P03')throw error;workLocked=true;}
        if(!workLocked)await delay(10);
      }
      assert.ok(workLocked,'The merge must hold its work lock before the submissions start.');
      let reviewDone=false,readingDone=false;
      const reviewing=bookReview(f.borrower,{workId:source.workId,stars:4,body:'TEST review submitted while the original work is merging.'});
      const reading=setReading(f.borrower,{workId:source.workId,state:'finished'});
      reviewing.then(()=>{reviewDone=true;},()=>{});reading.then(()=>{readingDone=true;},()=>{});pending.push(reviewing,reading);
      await delay(30);assert.equal(reviewDone,false);assert.equal(readingDone,false);
      await blocker.query('COMMIT');held=false;
      await Promise.all(pending);
      assert.equal((await first('SELECT work_id FROM book_reviews WHERE member_id=$1',[f.borrower.id])).work_id,target.workId);
      assert.equal((await first('SELECT work_id FROM reading_states WHERE member_id=$1',[f.borrower.id])).work_id,target.workId);
      assert.equal((await first("SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='reading'",[f.borrower.id])).n,1);
      const ledger=await first("SELECT data FROM xp_ledger WHERE member_id=$1 AND reason='reading'",[f.borrower.id]);assert.equal(ledger.data.workId,target.workId);
    }finally{
      if(held)await blocker.query('ROLLBACK');blocker.release();await Promise.allSettled(pending);
    }
  });

  test('matching-edition merge preserves cover proposals, approved cover and edition review references',async()=>{
    const f=await fixtures(),source=await book(f.lender,f.library),target=await book(f.borrower,f.library);
    async function proposal(copy:Awaited<ReturnType<typeof book>>,owner:Actor,state:'APPROVED'|'PENDING'){
      // Database-only synthetic evidence: no remote asset or actual image content is implied.
      const key=randomUUID().replaceAll('-','');
      const photo=await first("INSERT INTO copy_photos(copy_id,owner_id,storage_key,bytes,widths,state) VALUES($1,$2,$3,0,'{}','APPROVED') RETURNING id",[copy.id,owner.id,key]);
      const submission=await first('INSERT INTO edition_cover_submissions(edition_id,photo_id,member_id,rights_confirmed,state) VALUES($1,$2,$3,true,$4) RETURNING id',[copy.editionId,photo.id,owner.id,state]);
      return {key,photoId:photo.id,submissionId:submission.id};
    }
    const approved=await proposal(source,f.lender,'APPROVED'),pending=await proposal(source,f.lender,'PENDING');
    await query("UPDATE editions SET cover_key=$2,cover_state='APPROVED' WHERE id=$1",[source.editionId,approved.key]);
    const review=await bookReview(f.other,{workId:source.workId,editionId:source.editionId,stars:4});
    await mergeWorks(f.admin,source.workId,target.workId,'TEST reviewed duplicate edition with cover evidence.');
    const destination=await first('SELECT cover_key,cover_state FROM editions WHERE id=$1',[target.editionId]);
    assert.equal(destination.cover_key,approved.key);assert.equal(destination.cover_state,'APPROVED');
    assert.equal((await query('SELECT 1 FROM editions WHERE id=$1',[source.editionId])).rowCount,0);
    assert.equal((await first('SELECT edition_id FROM copies WHERE id=$1',[source.id])).edition_id,target.editionId);
    assert.equal((await first('SELECT edition_id,work_id FROM book_reviews WHERE id=$1',[review.id])).edition_id,target.editionId);
    const proposals=await query('SELECT id,edition_id,rights_confirmed,state FROM edition_cover_submissions WHERE id=ANY($1::uuid[])',[[approved.submissionId,pending.submissionId]]);
    assert.equal(proposals.rows.length,2);assert.ok(proposals.rows.every(row=>row.edition_id===target.editionId&&row.rights_confirmed));
    const pendingProposal=proposals.rows.find(row=>row.id===pending.submissionId);
    assert.ok(pendingProposal);assert.equal(pendingProposal.state,'PENDING');
    const next=await book(f.other,f.library),anotherApproved=await proposal(next,f.other,'APPROVED');
    await query("UPDATE editions SET cover_key=$2,cover_state='APPROVED' WHERE id=$1",[next.editionId,anotherApproved.key]);
    await mergeWorks(f.admin,next.workId,target.workId,'TEST keep the destination approved cover authoritative.');
    assert.equal((await first('SELECT cover_key FROM editions WHERE id=$1',[target.editionId])).cover_key,approved.key);
    assert.equal((await first('SELECT edition_id,state FROM edition_cover_submissions WHERE id=$1',[anotherApproved.submissionId])).edition_id,target.editionId);
    assert.equal((await first('SELECT edition_id,state FROM edition_cover_submissions WHERE id=$1',[anotherApproved.submissionId])).state,'APPROVED');
  });

  test('library aggregates count each active member and genuinely available public copy once',async()=>{
    const f=await fixtures(),empty=await fixtureLibrary(),suspended=await fixtureMember();
    await query('UPDATE members SET home_library_id=$2 WHERE id=$1',[suspended.id,f.library]);
    await book(f.lender,f.library);await book(f.lender,f.library);
    await book(f.borrower,f.library,{visibility:'PRIVATE'});await book(f.other,f.library);
    await book(suspended,f.library);
    await query("UPDATE members SET status='SUSPENDED' WHERE id=$1",[suspended.id]);
    await query('UPDATE members SET bookshelf_paused=true WHERE id=$1',[f.other.id]);
    const reserved=await book(f.lender,f.library),request=await requestLoan(f.borrower,{copyId:reserved.id});
    await decideRequest(f.lender,{id:request.id},'ACCEPTED');
    const hidden=await book(f.lender,f.library);await query("UPDATE works SET moderation_state='HIDDEN' WHERE id=$1",[hidden.workId]);
    const result=await libraries(),city=result.libraries.find(row=>row.id===f.library),emptyCity=result.libraries.find(row=>row.id===empty);
    assert.ok(city);assert.equal(city.member_count,4);assert.equal(city.available_count,2);
    assert.ok(emptyCity);assert.equal(emptyCity.member_count,0);assert.equal(emptyCity.available_count,0);
    const catalogue=await searchCatalogue('',f.library,1,{available:'true'});
    assert.equal(catalogue.works.reduce((sum:number,work:any)=>sum+work.availableCount,0),city.available_count);
  });

  test('a copy moderation hold survives owner edits and only authorised restoration permits publication',async()=>{
    const f=await fixtures(),copy=await book(f.lender,f.library,{notes:'TEST listing awaiting a moderation hold.'});
    await moderateContent(f.admin,{targetType:'copy',targetId:copy.id,approved:false,reason:'TEST copy listing held for a documented content decision.'});
    const held=await first('SELECT visibility,moderation_state,reviewed_at FROM copies WHERE id=$1',[copy.id]);
    assert.equal(held.visibility,'PRIVATE');assert.equal(held.moderation_state,'HIDDEN');assert.equal(held.reviewed_at,null);
    await rejectsCode(updateCopy(f.lender,{id:copy.id,visibility:'PUBLIC'}),'MODERATION_HOLD');
    await rejectsCode(updateCopy(f.lender,{id:copy.id,visibility:'PUBLIC',moderationState:'APPROVED'}),'MODERATION_HOLD');
    await updateCopy(f.lender,{id:copy.id,notes:'TEST correction stays private while awaiting review.'});
    const corrected=await first('SELECT visibility,moderation_state FROM copies WHERE id=$1',[copy.id]);assert.equal(corrected.visibility,'PRIVATE');assert.equal(corrected.moderation_state,'HIDDEN');
    assert.equal((await searchCatalogue('',f.library)).works.length,0);assert.equal((await workDetail(copy.workId,null)).copies.length,0);
    await rejectsCode(requestLoan(f.borrower,{copyId:copy.id}),'UNAVAILABLE');
    await rejectsCode(moderateContent(f.lender,{targetType:'copy',targetId:copy.id,approved:true,reason:'TEST member cannot release their own moderation hold.'}),'FORBIDDEN');
    await moderateContent(f.admin,{targetType:'copy',targetId:copy.id,approved:true,reason:'TEST authorised correction checked and listing restored.'});
    const restored=await first('SELECT visibility,moderation_state FROM copies WHERE id=$1',[copy.id]);assert.equal(restored.visibility,'PRIVATE');assert.equal(restored.moderation_state,'APPROVED');
    assert.equal((await searchCatalogue('',f.library)).works.length,0);await rejectsCode(requestLoan(f.borrower,{copyId:copy.id}),'UNAVAILABLE');
    await updateCopy(f.lender,{id:copy.id,visibility:'PUBLIC'});
    assert.equal((await searchCatalogue('',f.library)).works.length,1);assert.ok((await requestLoan(f.borrower,{copyId:copy.id})).id);
    const privateCopy=await book(f.other,f.library,{visibility:'PRIVATE'});
    await moderateContent(f.admin,{targetType:'copy',targetId:privateCopy.id,approved:true,reason:'TEST copy approval does not publish a private collection.'});
    assert.equal((await first('SELECT visibility FROM copies WHERE id=$1',[privateCopy.id])).visibility,'PRIVATE');
    await rejectsCode(requestLoan(f.borrower,{copyId:privateCopy.id}),'UNAVAILABLE');
  });

  test('locality submissions are requests; concurrent submission/approval creates one canonical library',async()=>{
    const f=await fixtures(),locality='TEST Locality '+randomUUID();
    const input={countryCode:'RO',locality,region:'Synthetic test region',explanation:'Synthetic explanation for a test-only community.'};
    const submissions=await Promise.allSettled([requestLibrary(f.borrower,input),requestLibrary(f.other,input)]);
    const successes=submissions.filter((r):r is PromiseFulfilledResult<{id:string}>=>r.status==='fulfilled');assert.equal(successes.length,1);
    assert.equal((await first('SELECT count(*)::int n FROM libraries WHERE name=$1',[locality])).n,0);
    await rejectsCode(decideLibrary(f.borrower,{id:successes[0].value.id},'APPROVED'),'FORBIDDEN');
    const approvals=await Promise.all([decideLibrary(f.admin,{id:successes[0].value.id},'APPROVED'),decideLibrary(f.admin,{id:successes[0].value.id},'APPROVED')]);
    assert.equal(approvals[0].libraryId,approvals[1].libraryId);
    assert.equal((await first('SELECT count(*)::int n FROM libraries WHERE name=$1',[locality])).n,1);
    await rejectsCode(requestLibrary(f.borrower,input),'LIBRARY_EXISTS');
  });
});

describe('physical lending and permanent gifts',{concurrency:false},()=>{
  test('hidden works and inactive libraries reject new requests and acceptance without blocking an existing physical return',async()=>{
    const f=await fixtures(),copy=await book(f.lender,f.library),request=await requestLoan(f.borrower,{copyId:copy.id});
    await query('UPDATE members SET public_collection=true WHERE id=$1',[f.lender.id]);
    await moderateContent(f.admin,{targetType:'work',targetId:copy.workId,approved:false,reason:'TEST work hidden after a borrower submitted a request.'});
    assert.ok(!(await profile(f.other,f.lender.id)).copies.some(row=>row.id===copy.id));
    await rejectsCode(requestLoan(f.other,{copyId:copy.id}),'UNAVAILABLE');
    await rejectsCode(decideRequest(f.lender,{id:request.id},'ACCEPTED'),'UNAVAILABLE');
    assert.equal((await first('SELECT state FROM loan_requests WHERE id=$1',[request.id])).state,'PENDING');
    assert.equal((await first('SELECT count(*)::int n FROM loans WHERE copy_id=$1',[copy.id])).n,0);
    await moderateContent(f.admin,{targetType:'work',targetId:copy.workId,approved:true,reason:'TEST the corrected work has been reviewed and restored.'});
    await query('UPDATE libraries SET active=false WHERE id=$1',[f.library]);
    await rejectsCode(requestLoan(f.other,{copyId:copy.id}),'UNAVAILABLE');
    await rejectsCode(decideRequest(f.lender,{id:request.id},'ACCEPTED'),'UNAVAILABLE');
    assert.equal((await first('SELECT state FROM copies WHERE id=$1',[copy.id])).state,'AVAILABLE');
    await query('UPDATE libraries SET active=true WHERE id=$1',[f.library]);
    await updateCopy(f.lender,{id:copy.id,visibility:'PRIVATE'});
    await rejectsCode(decideRequest(f.lender,{id:request.id},'ACCEPTED'),'UNAVAILABLE');
    await updateCopy(f.lender,{id:copy.id,visibility:'PUBLIC'});
    await query('UPDATE members SET bookshelf_paused=true WHERE id=$1',[f.lender.id]);
    await rejectsCode(decideRequest(f.lender,{id:request.id},'ACCEPTED'),'UNAVAILABLE');
    await query('UPDATE members SET bookshelf_paused=false WHERE id=$1',[f.lender.id]);
    const accepted=await decideRequest(f.lender,{id:request.id},'ACCEPTED');assert.ok(accepted.loanId);
    await transitionLoan(f.lender,{id:accepted.loanId},'handover');
    await moderateContent(f.admin,{targetType:'work',targetId:copy.workId,approved:false,reason:'TEST public visibility changes must preserve a real physical loan.'});
    await query('UPDATE libraries SET active=false WHERE id=$1',[f.library]);
    await transitionLoan(f.borrower,{id:accepted.loanId},'return');
    await transitionLoan(f.lender,{id:accepted.loanId},'receive');
    assert.equal((await first('SELECT state FROM loans WHERE id=$1',[accepted.loanId])).state,'RETURNED');
    assert.equal((await first('SELECT state FROM copies WHERE id=$1',[copy.id])).state,'AVAILABLE');
  });

  test('requests do not reserve; concurrent acceptance reserves exactly one copy',async()=>{
    const f=await fixtures(),copy=await book(f.lender,f.library);
    await rejectsCode(requestLoan(f.lender,{copyId:copy.id}),'SELF_BORROW');
    const requests=await Promise.all([requestLoan(f.borrower,{copyId:copy.id}),requestLoan(f.other,{copyId:copy.id})]);
    assert.equal((await first('SELECT state FROM copies WHERE id=$1',[copy.id])).state,'AVAILABLE');
    await rejectsCode(decideRequest(f.other,{id:requests[0].id},'ACCEPTED'),'FORBIDDEN');
    const accepted=await Promise.allSettled(requests.map(r=>decideRequest(f.lender,{id:r.id},'ACCEPTED')));
    assert.equal(accepted.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await first("SELECT count(*)::int n FROM loans WHERE copy_id=$1 AND state='RESERVED'",[copy.id])).n,1);
    assert.equal((await first('SELECT state FROM copies WHERE id=$1',[copy.id])).state,'RESERVED');
  });

  test('lender handover alone starts loan and due date; borrower return never closes it',async()=>{
    const f=await fixtures(),copy=await book(f.lender,f.library),request=await requestLoan(f.borrower,{copyId:copy.id});
    await query("UPDATE loan_requests SET created_at=now()-interval '60 days' WHERE id=$1",[request.id]);
    const accepted=await decideRequest(f.lender,{id:request.id,durationDays:14},'ACCEPTED');assert.ok(accepted.loanId);
    const reserved=await first('SELECT * FROM loans WHERE id=$1',[accepted.loanId]);assert.equal(reserved.handed_over_at,null);assert.equal(reserved.due_at,null);
    await assert.rejects(query("UPDATE loans SET state='ON_LOAN' WHERE id=$1",[accepted.loanId]),(error:any)=>error?.code==='23514');
    await assert.rejects(query("UPDATE loans SET state='ON_LOAN',handed_over_at=now(),handover_actor=NULL,original_due_at=now()+interval '14 days',due_at=now()+interval '14 days' WHERE id=$1",[accepted.loanId]),(error:any)=>error?.code==='23514');
    await rejectsCode(transitionLoan(f.borrower,{id:accepted.loanId},'handover'),'INVALID_TRANSITION');
    const start=Date.now();await transitionLoan(f.lender,{id:accepted.loanId},'handover');
    const loan=await first('SELECT * FROM loans WHERE id=$1',[accepted.loanId]);assert.equal(loan.state,'ON_LOAN');assert.equal(loan.handover_actor,f.lender.id);
    assert.ok(new Date(loan.handed_over_at).getTime()>=start);assert.equal(new Date(loan.due_at).getTime()-new Date(loan.handed_over_at).getTime(),14*86400000);
    await assert.rejects(query('UPDATE loans SET handover_actor=NULL WHERE id=$1',[accepted.loanId]),(error:any)=>error?.code==='23514');
    await assert.rejects(query("UPDATE loans SET state='RETURNED',returned_at=now(),return_actor=NULL WHERE id=$1",[accepted.loanId]),(error:any)=>error?.code==='23514');
    await transitionLoan(f.borrower,{id:accepted.loanId},'acknowledge');await transitionLoan(f.borrower,{id:accepted.loanId},'return');
    assert.equal((await first('SELECT state FROM loans WHERE id=$1',[accepted.loanId])).state,'RETURN_PENDING');
    assert.equal((await first('SELECT state FROM copies WHERE id=$1',[copy.id])).state,'RETURN_PENDING');
    await rejectsCode(transitionLoan(f.borrower,{id:accepted.loanId},'receive'),'INVALID_TRANSITION');
    await transitionLoan(f.lender,{id:accepted.loanId},'receive');await transitionLoan(f.lender,{id:accepted.loanId},'receive');
    const completed=await first('SELECT * FROM loans WHERE id=$1',[accepted.loanId]);assert.equal(completed.state,'RETURNED');assert.equal(completed.return_actor,f.lender.id);
    await assert.rejects(query('UPDATE loans SET return_actor=NULL WHERE id=$1',[accepted.loanId]),(error:any)=>error?.code==='23514');
    assert.equal((await first('SELECT state FROM copies WHERE id=$1',[copy.id])).state,'AVAILABLE');
    assert.equal((await first('SELECT count(*)::int n FROM reward_events WHERE loan_id=$1',[accepted.loanId])).n,1);
  });

  test('extension preserves original due date; lender can receive a real return without borrower indication',async()=>{
    const f=await fixtures(),active=await activeLoan(f,14),before=await first('SELECT * FROM loans WHERE id=$1',[active.loanId]);
    const requested=await transitionLoan(f.borrower,{id:active.loanId,days:7},'extensionRequest');
    const extension=await first("SELECT id FROM extensions WHERE loan_id=$1 AND state='PENDING'",[active.loanId]);
    assert.equal(requested.extensionId,extension.id);
    await rejectsCode(transitionLoan(f.borrower,{id:active.loanId,extensionId:extension.id},'extensionApprove'),'INVALID_TRANSITION');
    await transitionLoan(f.lender,{id:active.loanId,extensionId:extension.id},'extensionApprove');
    const extended=await first('SELECT * FROM loans WHERE id=$1',[active.loanId]);assert.equal(new Date(extended.original_due_at).getTime(),new Date(before.original_due_at).getTime());
    assert.equal(new Date(extended.due_at).getTime()-new Date(before.due_at).getTime(),7*86400000);
    await transitionLoan(f.lender,{id:active.loanId},'receive');assert.equal((await first('SELECT state FROM loans WHERE id=$1',[active.loanId])).state,'RETURNED');
  });

  test('extension approval binds a specific request and retries never approve a newer pending extension',async()=>{
    const f=await fixtures(),active=await activeLoan(f,14),original=await first('SELECT due_at,original_due_at FROM loans WHERE id=$1',[active.loanId]);
    const requested=await transitionLoan(f.borrower,{id:active.loanId,days:7},'extensionRequest');
    const firstExtension=await first("SELECT id FROM extensions WHERE loan_id=$1 AND state='PENDING'",[active.loanId]);
    assert.equal(requested.extensionId,firstExtension.id);
    const requestRetry=await transitionLoan(f.borrower,{id:active.loanId,days:7},'extensionRequest');assert.equal(requestRetry.extensionId,firstExtension.id);
    assert.equal((await first("SELECT count(*)::int n FROM loan_events WHERE loan_id=$1 AND event='EXTENSIONREQUEST'",[active.loanId])).n,1);
    assert.equal((await first('SELECT count(*)::int n FROM notifications WHERE member_id=$1 AND dedupe_key=$2',[f.lender.id,'loan:'+active.loanId+':extensionRequest:'+firstExtension.id])).n,1);
    const results=await Promise.all([
      transitionLoan(f.lender,{id:active.loanId,extensionId:firstExtension.id},'extensionApprove'),
      transitionLoan(f.lender,{id:active.loanId,extensionId:firstExtension.id},'extensionApprove'),
    ]);assert.ok(results.every(result=>result.ok&&result.extensionId===firstExtension.id));
    const expectedFirst=new Date(original.due_at).getTime()+7*86400000;
    assert.equal(new Date((await first('SELECT due_at FROM loans WHERE id=$1',[active.loanId])).due_at).getTime(),expectedFirst);
    assert.equal((await first("SELECT count(*)::int n FROM loan_events WHERE loan_id=$1 AND event='EXTENSIONAPPROVE'",[active.loanId])).n,1);
    const nextRequested=await transitionLoan(f.borrower,{id:active.loanId,days:3},'extensionRequest');
    const nextExtension=await first("SELECT id FROM extensions WHERE loan_id=$1 AND state='PENDING'",[active.loanId]);
    assert.equal(nextRequested.extensionId,nextExtension.id);
    assert.notEqual(nextExtension.id,firstExtension.id);
    const beforeRetry=await first("SELECT count(*)::int n FROM jobs WHERE type='loan_reminder' AND payload->>'loanId'=$1",[active.loanId]);
    await transitionLoan(f.lender,{id:active.loanId,extensionId:firstExtension.id},'extensionApprove');
    assert.equal(new Date((await first('SELECT due_at FROM loans WHERE id=$1',[active.loanId])).due_at).getTime(),expectedFirst);
    assert.equal((await first('SELECT state FROM extensions WHERE id=$1',[nextExtension.id])).state,'PENDING');
    assert.equal((await first("SELECT count(*)::int n FROM jobs WHERE type='loan_reminder' AND payload->>'loanId'=$1",[active.loanId])).n,beforeRetry.n);
    assert.equal((await first("SELECT count(*)::int n FROM loan_events WHERE loan_id=$1 AND event='EXTENSIONAPPROVE'",[active.loanId])).n,1);
    await rejectsCode(transitionLoan(f.lender,{id:active.loanId},'extensionApprove'),'NOT_FOUND');
    const other=await fixtures(),foreign=await activeLoan(other);
    await transitionLoan(other.borrower,{id:foreign.loanId,days:11},'extensionRequest');
    const foreignExtension=await first("SELECT id FROM extensions WHERE loan_id=$1 AND state='PENDING'",[foreign.loanId]);
    await rejectsCode(transitionLoan(f.lender,{id:active.loanId,extensionId:foreignExtension.id},'extensionApprove'),'NOT_FOUND');
    assert.equal((await first('SELECT state FROM extensions WHERE id=$1',[nextExtension.id])).state,'PENDING');
    assert.equal((await first('SELECT state FROM extensions WHERE id=$1',[foreignExtension.id])).state,'PENDING');
    await transitionLoan(f.lender,{id:active.loanId,extensionId:nextExtension.id},'extensionApprove');
    const final=await first('SELECT due_at,original_due_at FROM loans WHERE id=$1',[active.loanId]);
    assert.equal(new Date(final.due_at).getTime(),expectedFirst+3*86400000);
    assert.equal(new Date(final.original_due_at).getTime(),new Date(original.original_due_at).getTime());
    assert.equal((await first("SELECT count(*)::int n FROM loan_events WHERE loan_id=$1 AND event='EXTENSIONAPPROVE'",[active.loanId])).n,2);
    await transitionLoan(f.lender,{id:active.loanId},'receive');
    const afterTerminal=await transitionLoan(f.lender,{id:active.loanId,extensionId:firstExtension.id},'extensionApprove');assert.equal(afterTerminal.extensionId,firstExtension.id);
    assert.equal((await first('SELECT state FROM loans WHERE id=$1',[active.loanId])).state,'RETURNED');
    assert.equal((await first("SELECT count(*)::int n FROM loan_events WHERE loan_id=$1 AND event='EXTENSIONAPPROVE'",[active.loanId])).n,2);
    assert.equal((await first("SELECT count(*)::int n FROM jobs WHERE type='loan_reminder' AND payload->>'loanId'=$1 AND status IN('PENDING','RUNNING')",[active.loanId])).n,0);
  });

  test('cancellation and reservation expiry release copies only before physical handover',async()=>{
    const f=await fixtures(),copy=await book(f.lender,f.library),request=await requestLoan(f.borrower,{copyId:copy.id});
    const accepted=await decideRequest(f.lender,{id:request.id},'ACCEPTED');assert.ok(accepted.loanId);
    await transitionLoan(f.borrower,{id:accepted.loanId},'cancel');
    assert.equal((await first('SELECT state FROM loans WHERE id=$1',[accepted.loanId])).state,'CANCELLED');
    assert.equal((await first('SELECT state FROM copies WHERE id=$1',[copy.id])).state,'AVAILABLE');
    const next=await requestLoan(f.borrower,{copyId:copy.id}),reserved=await decideRequest(f.lender,{id:next.id},'ACCEPTED');assert.ok(reserved.loanId);
    await query("UPDATE loans SET reserved_until=now()-interval '1 minute' WHERE id=$1",[reserved.loanId]);
    await rejectsCode(transitionLoan(f.lender,{id:reserved.loanId},'handover'),'RESERVATION_EXPIRED');
    await processMaintenance();
    assert.equal((await first('SELECT state FROM loans WHERE id=$1',[reserved.loanId])).state,'EXPIRED');
    assert.equal((await first('SELECT state FROM copies WHERE id=$1',[copy.id])).state,'AVAILABLE');
    const current=await activeLoan(f);await rejectsCode(transitionLoan(f.borrower,{id:current.loanId},'cancel'),'INVALID_TRANSITION');
  });

  test('accepted gifting transfers existing copy once, stays private, cancels reminders and never counts a return',async()=>{
    const f=await fixtures(),active=await activeLoan(f);await rejectsCode(gift(f.borrower,{loanId:active.loanId},'offer'),'INVALID_TRANSITION');
    const oldReminder=await first("SELECT id,type,payload FROM jobs WHERE type='loan_reminder' AND payload->>'loanId'=$1 LIMIT 1",[active.loanId]);
    const offer=await gift(f.lender,{loanId:active.loanId},'offer');
    assert.equal((await first('SELECT state FROM loans WHERE id=$1',[active.loanId])).state,'ON_LOAN');
    await rejectsCode(gift(f.other,{giftId:offer.id,confirmPermanent:true},'accept'),'FORBIDDEN');
    await rejectsCode(gift(f.borrower,{giftId:offer.id,confirmPermanent:false},'accept'),'CONFIRM_REQUIRED');
    await gift(f.borrower,{giftId:offer.id,confirmPermanent:true},'accept');await gift(f.borrower,{giftId:offer.id,confirmPermanent:true},'accept');
    const copy=await first('SELECT * FROM copies WHERE id=$1',[active.copy.id]);assert.equal(copy.owner_id,f.borrower.id);assert.equal(copy.visibility,'PRIVATE');assert.equal(copy.collection_note,'');
    const loan=await first('SELECT * FROM loans WHERE id=$1',[active.loanId]);assert.equal(loan.state,'DONATED');assert.equal(loan.lender_id,f.lender.id);assert.equal(loan.returned_at,null);
    assert.equal((await first("SELECT count(*)::int n FROM ownership_history WHERE copy_id=$1 AND reason='DONATED'",[active.copy.id])).n,1);
    assert.equal((await first("SELECT count(*)::int n FROM jobs WHERE type='loan_reminder' AND payload->>'loanId'=$1 AND status IN ('PENDING','RUNNING')",[active.loanId])).n,0);
    await processDomainJob(oldReminder as {id:string;type:string;payload:any});
    assert.equal((await first('SELECT count(*)::int n FROM notifications WHERE dedupe_key=$1',['reminder:'+oldReminder.id])).n,0);
    const donor=await memberStats(f.lender.id),recipient=await memberStats(f.borrower.id);assert.equal(donor.gifts_given,1);assert.equal(donor.returned_lending,0);assert.equal(recipient.gifts_received,1);assert.equal(recipient.returned_borrowing,0);
  });

  test('simultaneous return/gift has one terminal lifecycle and incompatible reward families cannot stack',async()=>{
    const f=await fixtures(),active=await activeLoan(f),offer=await gift(f.lender,{loanId:active.loanId},'offer');
    const race=await Promise.allSettled([transitionLoan(f.lender,{id:active.loanId},'receive'),gift(f.borrower,{giftId:offer.id,confirmPermanent:true},'accept')]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    const loan=await first('SELECT state FROM loans WHERE id=$1',[active.loanId]);assert.ok(['RETURNED','DONATED'].includes(loan.state));
    const reward=await first('SELECT outcome FROM reward_events WHERE loan_id=$1',[active.loanId]);assert.equal(reward.outcome,loan.state);
    const xp=await query("SELECT reason FROM xp_ledger WHERE event_key=$1",['loan:'+active.loanId]);
    assert.ok(!(xp.rows.some(r=>r.reason==='gift')&&xp.rows.some(r=>['lender_return','borrower_return','on_time'].includes(r.reason))));
    const history=await first("SELECT count(*)::int n FROM ownership_history WHERE copy_id=$1 AND reason='DONATED'",[active.copy.id]);assert.equal(history.n,loan.state==='DONATED'?1:0);
  });

  test('concurrent same-pair completions and an immediate gifting loop cannot farm XP',async()=>{
    const f=await fixtures(),one=await activeLoan(f),two=await activeLoan(f);
    await Promise.all([transitionLoan(f.lender,{id:one.loanId},'receive'),transitionLoan(f.lender,{id:two.loanId},'receive')]);
    assert.equal((await first("SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='lender_return'",[f.lender.id])).n,1);
    assert.equal((await first("SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='borrower_return'",[f.borrower.id])).n,1);
    const loop=await fixtures(),active=await activeLoan(loop),offer=await gift(loop.lender,{loanId:active.loanId},'offer');
    await gift(loop.borrower,{giftId:offer.id,confirmPermanent:true},'accept');await updateCopy(loop.borrower,{id:active.copy.id,visibility:'PUBLIC'});
    const request=await requestLoan(loop.lender,{copyId:active.copy.id}),accepted=await decideRequest(loop.borrower,{id:request.id},'ACCEPTED');assert.ok(accepted.loanId);
    await transitionLoan(loop.borrower,{id:accepted.loanId},'handover');const backOffer=await gift(loop.borrower,{loanId:accepted.loanId},'offer');
    await gift(loop.lender,{giftId:backOffer.id,confirmPermanent:true},'accept');
    assert.equal((await first("SELECT count(*)::int n FROM xp_ledger WHERE member_id=ANY($1::text[]) AND reason='gift'",[[loop.lender.id,loop.borrower.id]])).n,1);
  });
});

describe('messages, reviews, forum and privacy',{concurrency:false},()=>{
  test('message retry keys bind the same conversation and body and identical retries notify once',async()=>{
    const f=await fixtures(),firstLoan=await activeLoan(f),nextLoan=await activeLoan(f);
    const one=await first('SELECT id FROM conversations WHERE loan_id=$1',[firstLoan.loanId]),two=await first('SELECT id FROM conversations WHERE loan_id=$1',[nextLoan.loanId]);
    const input={conversationId:one.id,body:'TEST retry-safe private message.',clientKey:randomUUID()};
    const initial=await Promise.all([sendMessage(f.lender,input),sendMessage(f.lender,input)]),sent=initial[0];assert.equal(initial[1].id,sent.id);
    const repeated=await Promise.all([sendMessage(f.lender,input),sendMessage(f.lender,{...input,body:' '+input.body+' '})]);
    assert.ok(repeated.every(message=>message.id===sent.id));
    await rejectsCode(sendMessage(f.lender,{...input,body:'TEST different body must not reuse an old delivery.'}),'MESSAGE_RETRY_CONFLICT');
    await rejectsCode(sendMessage(f.lender,{...input,conversationId:two.id}),'MESSAGE_RETRY_CONFLICT');
    const saved=await query('SELECT id,conversation_id,body FROM messages WHERE sender_id=$1 AND client_key=$2',[f.lender.id,input.clientKey]);
    assert.equal(saved.rows.length,1);assert.equal(saved.rows[0].id,sent.id);assert.equal(saved.rows[0].conversation_id,one.id);assert.equal(saved.rows[0].body,input.body);
    assert.equal((await first('SELECT count(*)::int n FROM messages WHERE conversation_id=$1',[two.id])).n,0);
    assert.equal((await first("SELECT count(*)::int n FROM notifications WHERE member_id=$1 AND type='message'",[f.borrower.id])).n,1);
    const separate=await sendMessage(f.lender,{...input,conversationId:two.id,clientKey:randomUUID()});assert.notEqual(separate.id,sent.id);
    assert.equal((await first("SELECT count(*)::int n FROM notifications WHERE member_id=$1 AND type='message'",[f.borrower.id])).n,2);
  });

  test('book review edition context updates in place, survives omitted context and can be explicitly cleared',async()=>{
    const f=await fixtures(),copy=await book(f.lender,f.library,{publisher:'Editură sintetică',year:2020});
    const edition=await addCopy(f.lender,{workId:copy.workId,libraryId:f.library,language:'ro',publisher:'Editură sintetică',year:2021,visibility:'PRIVATE'});
    const foreign=await book(f.other,f.library);
    const review=await bookReview(f.borrower,{workId:copy.workId,editionId:copy.editionId,stars:3,body:'TEST review of the first edition.'});
    assert.equal((await first('SELECT edition_id FROM book_reviews WHERE id=$1',[review.id])).edition_id,copy.editionId);
    const updated=await bookReview(f.borrower,{workId:copy.workId,editionId:edition.editionId,stars:4,body:'TEST corrected edition context.'});
    assert.equal(updated.id,review.id);assert.equal((await first('SELECT edition_id FROM book_reviews WHERE id=$1',[review.id])).edition_id,edition.editionId);
    await bookReview(f.borrower,{workId:copy.workId,stars:5,body:'TEST text-only edit retains edition context.'});
    assert.equal((await first('SELECT edition_id FROM book_reviews WHERE id=$1',[review.id])).edition_id,edition.editionId);
    await bookReview(f.borrower,{workId:copy.workId,editionId:null,stars:4,body:'TEST review now applies to the work generally.'});
    assert.equal((await first('SELECT edition_id FROM book_reviews WHERE id=$1',[review.id])).edition_id,null);
    await rejectsCode(bookReview(f.borrower,{workId:copy.workId,editionId:foreign.editionId,stars:4}),'INVALID_EDITION');
    assert.equal((await first('SELECT count(*)::int n FROM book_reviews WHERE work_id=$1 AND member_id=$2',[copy.workId,f.borrower.id])).n,1);
    assert.equal((await first('SELECT edition_id FROM book_reviews WHERE id=$1',[review.id])).edition_id,null);
  });

  test('public service contact stores minimal unverified evidence without opening a referenced private case',async()=>{
    const f=await fixtures(),active=await activeLoan(f);
    const original=await fileReport(f.borrower,{targetType:'loan',targetId:active.loanId,category:'other',explanation:'TEST original confidential loan case explanation.'});
    const source=await first('SELECT state,evidence,reporter_id,library_id FROM reports WHERE id=$1',[original.id]);
    const submitted=await fileReport(null,{targetType:'service',targetId:original.id,reportId:original.id,category:'other',contactEmail:'public-service-test@example.invalid',explanation:'TEST public operator contact about a referenced decision.'});
    assert.deepEqual(Object.keys(submitted),['id']);
    const contact=await first('SELECT target_type,target_id,public_contact,reporter_id,library_id,evidence,state FROM reports WHERE id=$1',[submitted.id]);
    assert.equal(contact.target_type,'service');assert.equal(contact.target_id,'service');assert.equal(contact.public_contact,'public-service-test@example.invalid');
    assert.equal(contact.reporter_id,null);assert.equal(contact.library_id,null);assert.equal(contact.state,'RECEIVED');
    assert.deepEqual(contact.evidence,{serviceContact:true,caseReference:original.id,contactControlConfirmed:false});
    const strangerContact=await fileReport(f.other,{targetType:'service',reportId:randomUUID(),category:'other',explanation:'TEST a reference is untrusted and does not reveal existence.'});
    assert.ok(strangerContact.id);await rejectsCode(reportEvidence(f.other,original.id),'FORBIDDEN');
    const scoped=await fixtureMember({role:'MODERATOR'});await query('INSERT INTO moderator_scopes(member_id,library_id) VALUES($1,$2)',[scoped.id,f.library]);
    await rejectsCode(reportEvidence(scoped,submitted.id),'FORBIDDEN');
    const administrative=await reportEvidence(f.admin,submitted.id);
    assert.deepEqual(administrative.report.evidence,contact.evidence);assert.ok(!Object.hasOwn(administrative,'originalReport'));
    const after=await first('SELECT state,evidence,reporter_id,library_id FROM reports WHERE id=$1',[original.id]);assert.deepEqual(after,source);
    assert.equal((await first("SELECT count(*)::int n FROM audit_log WHERE action='REPORT_EVIDENCE_ACCESSED' AND target_id=$1",[original.id])).n,0);
    assert.equal((await first("SELECT count(*)::int n FROM audit_log WHERE action='REPORT_EVIDENCE_ACCESSED' AND target_id=$1",[submitted.id])).n,1);
  });

  test('moderation dashboard contains only scoped metadata and response decisions use the historical loan library',async()=>{
    const f=await fixtures(),foreign=await fixtures(),localModerator=await fixtureMember({role:'MODERATOR'}),foreignModerator=await fixtureMember({role:'MODERATOR'});
    await query('INSERT INTO moderator_scopes(member_id,library_id) VALUES($1,$2),($3,$4)',[localModerator.id,f.library,foreignModerator.id,foreign.library]);
    async function pendingItems(context:Awaited<ReturnType<typeof fixtures>>){
      const active=await activeLoan(context);await transitionLoan(context.lender,{id:active.loanId},'receive');
      const review=await memberReview(context.lender,{loanId:active.loanId,stars:4});await memberReview(context.borrower,{loanId:active.loanId,stars:4});
      await reviewResponse(context.borrower,{id:review.id,body:'TEST pending public response awaiting scoped moderation.'});
      const photo=await first("INSERT INTO copy_photos(copy_id,owner_id,storage_key,bytes,widths,state) VALUES($1,$2,$3,0,'{}','PENDING') RETURNING id",[active.copy.id,context.lender.id,randomUUID().replaceAll('-','')]);
      const report=await fileReport(context.borrower,{targetType:'member_review',targetId:review.id,category:'other',explanation:'TEST report attached to the historical transaction library.'});
      return {active,review,photo,report};
    }
    const local=await pendingItems(f),elsewhere=await pendingItems(foreign);
    await updateProfile(f.borrower,{homeLibraryId:foreign.library});
    assert.equal((await first('SELECT library_id FROM reports WHERE id=$1',[local.report.id])).library_id,f.library);
    const conversation=await first('SELECT id FROM conversations WHERE loan_id=$1',[local.active.loanId]);
    const privateBody='TEST private moderation evidence '+randomUUID();
    const message=await sendMessage(f.lender,{conversationId:conversation.id,body:privateBody,clientKey:randomUUID()});
    const preview=await reportMessagePreview(f.borrower,message.id);
    const messageCase=await fileReport(f.borrower,{targetType:'message',targetId:message.id,category:'other',explanation:'TEST case metadata may be listed without the private evidence.',confirmEvidence:true,evidenceToken:preview.evidenceToken});
    const globalCase=await fileReport(null,{targetType:'service',category:'other',explanation:'TEST global operator contact must not enter a local queue.'});
    await rejectsCode(moderationDashboard(f.borrower),'FORBIDDEN');
    await rejectsCode(moderationDashboard({...f.admin,stepUp:false}),'TWO_FACTOR_REQUIRED');
    const dashboard=await moderationDashboard(localModerator);
    assert.deepEqual(Object.keys(dashboard).sort(),['page','photos','reports','reviewResponses']);
    assert.deepEqual(new Set(dashboard.reports.map(row=>row.id)),new Set([local.report.id,messageCase.id]));
    assert.ok(dashboard.reports.every(row=>row.library_id===f.library&&!Object.hasOwn(row,'evidence')&&!Object.hasOwn(row,'public_contact')));
    assert.deepEqual(dashboard.photos.map(row=>row.id),[local.photo.id]);assert.equal(dashboard.photos[0].library_id,f.library);
    assert.deepEqual(dashboard.reviewResponses.map(row=>row.id),[local.review.id]);assert.equal(dashboard.reviewResponses[0].library_id,f.library);
    const serialized=JSON.stringify(dashboard);assert.ok(!serialized.includes(privateBody));assert.ok(!serialized.includes(globalCase.id));
    assert.ok(!serialized.includes(elsewhere.report.id));assert.ok(!serialized.includes(elsewhere.photo.id));assert.ok(!serialized.includes(elsewhere.review.id));
    const wrongQueue=await moderationDashboard(foreignModerator);
    assert.deepEqual(wrongQueue.reports.map(row=>row.id),[elsewhere.report.id]);assert.deepEqual(wrongQueue.photos.map(row=>row.id),[elsewhere.photo.id]);
    const decision={targetType:'member_review',targetId:local.review.id,response:true,approved:true,reason:'TEST response reviewed within the original loan library.'};
    await rejectsCode(moderateContent(foreignModerator,decision),'FORBIDDEN');await rejectsCode(moderateContent(f.borrower,decision),'FORBIDDEN');
    assert.equal((await first('SELECT response_state FROM member_reviews WHERE id=$1',[local.review.id])).response_state,'PENDING');
    await moderateContent(localModerator,decision);
    assert.equal((await first('SELECT response_state FROM member_reviews WHERE id=$1',[local.review.id])).response_state,'VISIBLE');
    assert.equal((await first("SELECT count(*)::int n FROM audit_log WHERE action='CONTENT_MODERATED' AND target_id=$1 AND actor_id=$2",[local.review.id,localModerator.id])).n,1);
    assert.equal((await moderationDashboard(localModerator)).reviewResponses.length,0);
  });

  test('work-page ad eligibility requires reviewed visible copies and reviews and resets after member edits',async()=>{
    const f=await fixtures(),copy=await book(f.lender,f.library,{notes:'TEST initial public copy description.'});
    const eligible=async()=>Boolean((await workDetail(copy.workId,null)).work.ads_eligible);
    assert.equal(await eligible(),false);
    await moderateContent(f.admin,{targetType:'work',targetId:copy.workId,approved:true,reason:'TEST work metadata reviewed for a public page.'});
    assert.equal(await eligible(),false);assert.equal((await first('SELECT reviewed_at FROM copies WHERE id=$1',[copy.id])).reviewed_at,null);
    await moderateContent(f.admin,{targetType:'copy',targetId:copy.id,approved:true,reason:'TEST public copy notes reviewed.'});
    assert.ok((await first('SELECT reviewed_at FROM copies WHERE id=$1',[copy.id])).reviewed_at);assert.equal(await eligible(),true);
    const review=await bookReview(f.borrower,{workId:copy.workId,stars:4,body:'TEST public book review awaiting content checks.'});
    assert.equal(await eligible(),false);assert.equal((await first('SELECT reviewed_at FROM book_reviews WHERE id=$1',[review.id])).reviewed_at,null);
    await moderateContent(f.admin,{targetType:'book_review',targetId:review.id,approved:true,reason:'TEST public book review checked.'});assert.equal(await eligible(),true);
    await bookReview(f.borrower,{workId:copy.workId,stars:3,body:'TEST edited review requires a fresh check.'});
    assert.equal(await eligible(),false);assert.equal((await first('SELECT reviewed_at FROM book_reviews WHERE id=$1',[review.id])).reviewed_at,null);
    await moderateContent(f.admin,{targetType:'book_review',targetId:review.id,approved:true,reason:'TEST review checked after editing.'});assert.equal(await eligible(),true);
    await updateCopy(f.lender,{id:copy.id,notes:'TEST updated public condition notes.'});
    assert.equal(await eligible(),false);assert.equal((await first('SELECT reviewed_at FROM copies WHERE id=$1',[copy.id])).reviewed_at,null);
    await moderateContent(f.admin,{targetType:'copy',targetId:copy.id,approved:true,reason:'TEST copy checked after editing.'});assert.equal(await eligible(),true);
    const extra=await addCopy(f.other,{editionId:copy.editionId,libraryId:f.library,visibility:'PUBLIC'});assert.equal(await eligible(),false);
    await updateCopy(f.other,{id:extra.id,visibility:'PRIVATE'});assert.equal(await eligible(),true);
    await moderateContent(f.admin,{targetType:'book_review',targetId:review.id,approved:false,reason:'TEST hidden review is removed from public page eligibility.'});
    assert.equal((await first('SELECT reviewed_at FROM book_reviews WHERE id=$1',[review.id])).reviewed_at,null);assert.equal(await eligible(),true);
  });

  test('equal microsecond timestamps preserve the selected evidence message in stable bounded order',async()=>{
    const f=await fixtures(),active=await activeLoan(f),conv=await first('SELECT id FROM conversations WHERE loan_id=$1',[active.loanId]);
    const ids:string[]=[],createdAt=new Date(Date.now()-60000);
    for(let index=0;index<7;index++){
      const message=await first("INSERT INTO messages(conversation_id,sender_id,body,client_key,created_at) VALUES($1,$2,$3,$4,$5::timestamptz+interval '1 microsecond') RETURNING id",[conv.id,f.lender.id,'TEST tied-time private context '+index,randomUUID(),createdAt]);ids.push(message.id);
    }
    ids.sort();
    for(const index of [0,3,6]){
      const preview=await reportMessagePreview(f.borrower,ids[index]);
      assert.equal(preview.messages.filter(message=>message.id===ids[index]).length,1);
      assert.ok(preview.messages.length<=5);assert.equal(new Set(preview.messages.map(message=>message.id)).size,preview.messages.length);
      assert.deepEqual(preview.messages.map(message=>message.id),ids.slice(Math.max(0,index-2),Math.min(ids.length,index+3)));
      const report=await fileReport(f.borrower,{targetType:'message',targetId:ids[index],category:'spam',explanation:'TEST evidence reporting with identical timestamps.',confirmEvidence:true,evidenceToken:preview.evidenceToken});
      const stored=await first('SELECT evidence FROM reports WHERE id=$1',[report.id]);
      assert.deepEqual(stored.evidence.messages.map((message:any)=>message.id),preview.messages.map(message=>message.id));
    }
  });

  test('messages isolate participants; reports preserve only previewed limited evidence and scoped access is logged',async()=>{
    const f=await fixtures(),active=await activeLoan(f),conv=await first('SELECT id FROM conversations WHERE loan_id=$1',[active.loanId]);
    const ids:string[]=[],base=Date.now()-60000;
    for(let index=0;index<7;index++){
      const row=await first('INSERT INTO messages(conversation_id,sender_id,body,client_key,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id',[conv.id,f.lender.id,'TEST private context '+index,randomUUID(),new Date(base+index*1000)]);ids.push(row.id);
    }
    await rejectsCode(messages(f.other,conv.id),'FORBIDDEN');await rejectsCode(messages(f.admin,conv.id),'FORBIDDEN');
    await rejectsCode(sendMessage(f.other,{conversationId:conv.id,body:'Unrelated test message',clientKey:randomUUID()}),'FORBIDDEN');
    const preview=await reportMessagePreview(f.borrower,ids[3]);assert.equal(preview.messages.length,5);assert.ok(preview.messages.some(m=>m.id===ids[3]));
    assert.ok(!preview.messages.some(m=>m.id===ids[0]||m.id===ids[6]));
    assert.ok(preview.evidenceToken);
    const reportInput={targetType:'message',targetId:ids[3],category:'harassment',explanation:'TEST selected-message report explanation.',confirmEvidence:true};
    await rejectsCode(fileReport(f.borrower,reportInput),'EVIDENCE_PREVIEW_EXPIRED');
    await rejectsCode(fileReport(f.lender,{...reportInput,evidenceToken:preview.evidenceToken}),'EVIDENCE_PREVIEW_EXPIRED');
    const report=await fileReport(f.borrower,{...reportInput,evidenceToken:preview.evidenceToken});
    await query('UPDATE messages SET body=$2 WHERE id=$1',[ids[3],'TEST edited after reporting']);
    const moderator=await fixtureMember({role:'MODERATOR'}),wrongLibrary=await fixtureLibrary();
    await query('INSERT INTO moderator_scopes(member_id,library_id) VALUES($1,$2)',[moderator.id,wrongLibrary]);await rejectsCode(reportEvidence(moderator,report.id),'FORBIDDEN');
    await query('UPDATE moderator_scopes SET library_id=$2 WHERE member_id=$1',[moderator.id,f.library]);
    const evidence=await reportEvidence(moderator,report.id);assert.deepEqual(evidence.report.evidence.messages.map((m:any)=>m.body),preview.messages.map(m=>m.body));
    assert.equal((await first("SELECT count(*)::int n FROM audit_log WHERE action='REPORT_EVIDENCE_ACCESSED' AND target_id=$1",[report.id])).n,1);
    await blockMember(f.borrower,{memberId:f.lender.id});await rejectsCode(sendMessage(f.lender,{conversationId:conv.id,body:'TEST blocked',clientKey:randomUUID()}),'BLOCKED');
    await resolveLoan(f.admin,{id:active.loanId,state:'DISPUTED',reason:'TEST mediated contact after blocking.'});
    assert.equal((await first('SELECT state FROM loans WHERE id=$1',[active.loanId])).state,'DISPUTED');
  });

  test('transaction reviews are eligible and double blind; book review updates are unique and cannot award XP',async()=>{
    const f=await fixtures(),active=await activeLoan(f);await transitionLoan(f.lender,{id:active.loanId},'receive');
    await rejectsCode(memberReview(f.other,{loanId:active.loanId,stars:5}),'REVIEW_NOT_ELIGIBLE');
    await memberReview(f.lender,{loanId:active.loanId,stars:4,body:'TEST lender review'});
    assert.equal((await first('SELECT published_at FROM member_reviews WHERE loan_id=$1',[active.loanId])).published_at,null);
    assert.equal((await profile(f.other,f.borrower.id)).reviews.length,0);
    await memberReview(f.lender,{loanId:active.loanId,stars:3,body:'TEST edited before blind release'});
    await memberReview(f.borrower,{loanId:active.loanId,stars:4});
    const reviews=await query('SELECT published_at FROM member_reviews WHERE loan_id=$1',[active.loanId]);assert.equal(reviews.rows.length,2);assert.ok(reviews.rows.every(r=>r.published_at));
    await rejectsCode(memberReview(f.lender,{loanId:active.loanId,stars:5}),'REVIEW_LOCKED');
    const before=await memberStats(f.borrower.id);await bookReview(f.borrower,{workId:active.copy.workId,stars:3});await bookReview(f.borrower,{workId:active.copy.workId,stars:5,spoiler:true});
    assert.equal((await first('SELECT count(*)::int n FROM book_reviews WHERE work_id=$1 AND member_id=$2',[active.copy.workId,f.borrower.id])).n,1);
    assert.equal((await memberStats(f.borrower.id)).xp,before.xp);
    const ownReview=await first('SELECT id FROM book_reviews WHERE work_id=$1 AND member_id=$2',[active.copy.workId,f.borrower.id]);
    await moderateContent(f.admin,{targetType:'book_review',targetId:ownReview.id,approved:false,reason:'TEST private moderation regression evidence.'});
    await bookReview(f.borrower,{workId:active.copy.workId,stars:4,body:'TEST revision stays hidden'});
    assert.equal((await first('SELECT state FROM book_reviews WHERE id=$1',[ownReview.id])).state,'HIDDEN');
  });

  test('reading toggles cannot repeat awards and concurrent finished-work events obey monthly caps',async()=>{
    const f=await fixtures(),copies=[];
    for(let index=0;index<config.readingMonthlyCap+3;index++)copies.push(await book(f.lender,f.library,{visibility:'PRIVATE'}));
    await Promise.all(copies.map(copy=>setReading(f.borrower,{workId:copy.workId,state:'finished'})));
    const reward=await first("SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='reading'",[f.borrower.id]);assert.equal(reward.n,config.readingMonthlyCap);
    await setReading(f.borrower,{workId:copies[0].workId,state:'want'});await setReading(f.borrower,{workId:copies[0].workId,state:'finished'});
    assert.equal((await first("SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='reading'",[f.borrower.id])).n,reward.n);
    const anonymous=await profile(f.other,f.borrower.id);assert.equal(anonymous.stats,null);assert.deepEqual(anonymous.copies,[]);
  });

  test('reward adjustment retries are idempotent and missing keys are rejected before writing',async()=>{
    const f=await fixtures(),input={memberId:f.borrower.id,points:7,reason:'TEST audited compensating reward adjustment.',idempotencyKey:randomUUID()};
    await rejectsCode(adjustReward(f.lender,input),'FORBIDDEN');
    const {idempotencyKey,...missingKey}=input;
    await rejectsCode(adjustReward(f.admin,missingKey),'INVALID_ADJUSTMENT');
    await rejectsCode(adjustReward(f.admin,{...input,idempotencyKey:'undefined'}),'INVALID_ADJUSTMENT');
    const result=await Promise.all([adjustReward(f.admin,input),adjustReward(f.admin,input)]);
    assert.ok(result.every(row=>row.ok));await adjustReward(f.admin,input);
    const ledger=await query("SELECT points,event_key FROM xp_ledger WHERE member_id=$1 AND reason='adjustment'",[f.borrower.id]);
    assert.equal(ledger.rows.length,1);assert.equal(ledger.rows[0].points,7);assert.equal(ledger.rows[0].event_key,'adjustment:'+idempotencyKey);
    assert.equal((await first("SELECT count(*)::int n FROM audit_log WHERE action='XP_ADJUSTED' AND target_id=$1",[f.borrower.id])).n,1);
    await adjustReward(f.admin,{...input,points:-7,idempotencyKey:randomUUID()});
    assert.equal((await first("SELECT count(*)::int n,coalesce(sum(points),0)::int points FROM xp_ledger WHERE member_id=$1 AND reason='adjustment'",[f.borrower.id])).points,0);
    assert.equal((await first("SELECT count(*)::int n FROM xp_ledger WHERE member_id=$1 AND reason='adjustment'",[f.borrower.id])).n,2);
    await assert.rejects(query('UPDATE xp_ledger SET points=99 WHERE member_id=$1',[f.borrower.id]),(error:any)=>error?.code==='P0001');
  });

  test('forum supports search, quoted replies, subscriptions and locks; hidden content cannot be restored by own edits',async()=>{
    const f=await fixtures(),category='test-'+randomUUID();await query('INSERT INTO forum_categories(id,title) VALUES($1,$2)',[category,'TEST category']);
    const topic=await createTopic(f.lender,{categoryId:category,libraryId:f.library,title:'TEST Topic '+randomUUID(),body:'TEST first post'});
    const original=await first('SELECT id FROM forum_posts WHERE topic_id=$1',[topic.id]);
    const report=await fileReport(f.borrower,{targetType:'post',targetId:original.id,category:'spam',explanation:'TEST forum reporting integration evidence.'});
    assert.equal((await first('SELECT target_type FROM reports WHERE id=$1',[report.id])).target_type,'post');
    const reply=await replyTopic(f.borrower,{topicId:topic.id,body:'TEST quoted reply',quotedPostId:original.id});
    assert.equal((await first('SELECT quoted_post_id FROM forum_posts WHERE id=$1',[reply.id])).quoted_post_id,original.id);
    assert.ok((await forumList(f.borrower,'quoted reply',f.library)).topics.some(t=>t.id===topic.id));
    await editPost(f.borrower,{postId:reply.id,body:'TEST revised reply'});assert.equal((await first('SELECT count(*)::int n FROM post_revisions WHERE post_id=$1',[reply.id])).n,1);
    await moderateForum(f.admin,{topicId:topic.id,action:'lock',reason:'TEST lock for integration validation.'});
    await rejectsCode(replyTopic(f.borrower,{topicId:topic.id,body:'TEST cannot reply'}),'TOPIC_LOCKED');
    await moderateForum(f.admin,{topicId:topic.id,action:'lock',enabled:false,reason:'TEST reopening after validation.'});
    await query("UPDATE forum_posts SET state='HIDDEN' WHERE id=$1",[reply.id]);
    await rejectsCode(editPost(f.borrower,{postId:reply.id,body:'TEST illicit restoration'}),'POST_RESTRICTED');
    await rejectsCode(editPost(f.admin,{postId:reply.id,body:'TEST moderation edit'}),'REASON_REQUIRED');
    await editPost(f.admin,{postId:reply.id,body:'TEST moderated content',reason:'TEST reason for scoped moderation.'});assert.equal((await first('SELECT state FROM forum_posts WHERE id=$1',[reply.id])).state,'HIDDEN');
    const target=await createTopic(f.other,{categoryId:category,libraryId:f.library,title:'TEST Merge target '+randomUUID(),body:'TEST target body'});
    await forumPreference(f.borrower,{topicId:topic.id,enabled:true},'follow');await forumPreference(f.borrower,{topicId:topic.id,enabled:true},'bookmark');
    await moderateForum(f.admin,{topicId:topic.id,targetId:target.id,action:'merge',reason:'TEST merge preserves participant preferences.'});
    const prefs=await first('SELECT bookmarked,followed FROM topic_preferences WHERE topic_id=$1 AND member_id=$2',[target.id,f.borrower.id]);assert.equal(prefs.bookmarked,true);assert.equal(prefs.followed,true);
    assert.equal((await first('SELECT topic_id FROM forum_posts WHERE id=$1',[reply.id])).topic_id,target.id);
    assert.ok(AVATAR_ICONS.length>=24);await rejectsCode(updateProfile(f.borrower,{icon:'https://example.invalid/avatar.png'}),'INVALID_ICON');
    await assert.rejects(query('UPDATE members SET icon=$2 WHERE id=$1',[f.borrower.id,'<svg/>']),(error:any)=>error?.code==='23514');
  });

  test('forum moves preserve omitted city and content state, validate destinations and audit explicit scope changes',async()=>{
    const f=await fixtures(),otherCity=await fixtureLibrary(),inactiveCity=await fixtureLibrary(),moderator=await fixtureMember({role:'MODERATOR'}),wrongModerator=await fixtureMember({role:'MODERATOR'});
    await query('UPDATE libraries SET active=false WHERE id=$1',[inactiveCity]);
    await query('INSERT INTO moderator_scopes(member_id,library_id) VALUES($1,$2),($3,$4)',[moderator.id,f.library,wrongModerator.id,otherCity]);
    const category='test-'+randomUUID(),destinationCategory='test-'+randomUUID();
    await query('INSERT INTO forum_categories(id,title) VALUES($1,$2),($3,$4)',[category,'TEST original move category',destinationCategory,'TEST destination move category']);
    const topic=await createTopic(f.lender,{categoryId:category,libraryId:f.library,title:'TEST Scoped move '+randomUUID(),body:'TEST preserved topic body.'});
    await query("UPDATE forum_topics SET state='HIDDEN',locked=true,pinned=true WHERE id=$1",[topic.id]);
    const original=await first('SELECT category_id,library_id,state,locked,pinned FROM forum_topics WHERE id=$1',[topic.id]);
    const move={topicId:topic.id,action:'move',categoryId:destinationCategory,reason:'  TEST documented category and city move with explicit scope.  '};
    await rejectsCode(moderateForum(f.borrower,move),'FORBIDDEN');await rejectsCode(moderateForum(wrongModerator,move),'FORBIDDEN');
    await rejectsCode(moderateForum(moderator,{...move,libraryId:null}),'FORBIDDEN');
    await rejectsCode(moderateForum(moderator,{...move,libraryId:otherCity}),'FORBIDDEN');
    await rejectsCode(moderateForum(moderator,{...move,libraryId:inactiveCity}),'INVALID_LIBRARY');
    await rejectsCode(moderateForum(moderator,{...move,libraryId:randomUUID()}),'INVALID_LIBRARY');
    await rejectsCode(moderateForum(moderator,{...move,libraryId:'invalid-city'}),'INVALID_LIBRARY');
    await rejectsCode(moderateForum(moderator,{...move,categoryId:'missing-test-category'}),'INVALID_CATEGORY');
    assert.deepEqual(await first('SELECT category_id,library_id,state,locked,pinned FROM forum_topics WHERE id=$1',[topic.id]),original);
    assert.equal((await first("SELECT count(*)::int n FROM audit_log WHERE action='FORUM_MOVE' AND target_id=$1",[topic.id])).n,0);
    await moderateForum(moderator,move);
    assert.deepEqual(await first('SELECT category_id,library_id,state,locked,pinned FROM forum_topics WHERE id=$1',[topic.id]),{...original,category_id:destinationCategory});
    const audit=await first("SELECT actor_id,reason,data FROM audit_log WHERE action='FORUM_MOVE' AND target_id=$1",[topic.id]);
    assert.equal(audit.actor_id,moderator.id);assert.equal(audit.reason,move.reason.trim());
    assert.deepEqual(audit.data,{fromCategoryId:category,toCategoryId:destinationCategory,fromLibraryId:f.library,toLibraryId:f.library});
    await query('INSERT INTO moderator_scopes(member_id,library_id) VALUES($1,$2)',[moderator.id,otherCity]);
    await moderateForum(moderator,{...move,libraryId:otherCity});
    assert.deepEqual(await first('SELECT category_id,library_id,state,locked,pinned FROM forum_topics WHERE id=$1',[topic.id]),{...original,category_id:destinationCategory,library_id:otherCity});
    await rejectsCode(moderateForum(moderator,{...move,libraryId:null}),'FORBIDDEN');
    await query('INSERT INTO moderator_scopes(member_id,global_scope) VALUES($1,true)',[moderator.id]);
    await moderateForum(moderator,{...move,libraryId:null});
    assert.deepEqual(await first('SELECT category_id,library_id,state,locked,pinned FROM forum_topics WHERE id=$1',[topic.id]),{...original,category_id:destinationCategory,library_id:null});
    const history=await query("SELECT data FROM audit_log WHERE action='FORUM_MOVE' AND target_id=$1 ORDER BY created_at",[topic.id]);
    assert.equal(history.rows.length,3);
    assert.deepEqual(history.rows[1].data,{fromCategoryId:destinationCategory,toCategoryId:destinationCategory,fromLibraryId:f.library,toLibraryId:otherCity});
    assert.deepEqual(history.rows[2].data,{fromCategoryId:destinationCategory,toCategoryId:destinationCategory,fromLibraryId:otherCity,toLibraryId:null});
    assert.equal((await first('SELECT body FROM forum_posts WHERE topic_id=$1',[topic.id])).body,'TEST preserved topic body.');
  });

  test('export excludes others messages/contact and deletion preserves active loan; moving home keeps historic loan library',async()=>{
    const f=await fixtures(),active=await activeLoan(f),conv=await first('SELECT id FROM conversations WHERE loan_id=$1',[active.loanId]);
    await sendMessage(f.lender,{conversationId:conv.id,body:'TEST other-person-private-body',clientKey:randomUUID()});
    await sendMessage(f.borrower,{conversationId:conv.id,body:'TEST my-exportable-message',clientKey:randomUUID()});
    const exported=await exportAccount(f.borrower),json=JSON.stringify(exported),lenderEmail=(await first('SELECT email FROM "user" WHERE id=$1',[f.lender.id])).email;
    assert.ok(json.includes('TEST my-exportable-message'));assert.ok(!json.includes('TEST other-person-private-body'));assert.ok(!json.includes(lenderEmail));
    assert.ok(!Object.hasOwn(exported,'moderationNotes'));assert.equal(exported.loans[0].state,'ON_LOAN');
    const request=await requestPrivacy(f.borrower,{kind:'DELETE'});await rejectsCode(resolvePrivacy(f.admin,{id:request.id,state:'COMPLETED',reason:'TEST retain unresolved physical loan proportionately.'}),'ACTIVE_LOANS');
    assert.equal((await first('SELECT status FROM members WHERE id=$1',[f.borrower.id])).status,'ACTIVE');
    const next=await fixtureLibrary();await updateProfile(f.borrower,{homeLibraryId:next});
    assert.equal((await first('SELECT library_id FROM loans WHERE id=$1',[active.loanId])).library_id,f.library);
    assert.equal((await first('SELECT library_id FROM copies WHERE id=$1',[active.copy.id])).library_id,f.library);
  });

  test('concurrent deletion and loan acceptance preserve active participants or reject creation',async()=>{
    for(const targetRole of ['lender','borrower'] as const){
      const f=await fixtures(),copy=await book(f.lender,f.library),request=await requestLoan(f.borrower,{copyId:copy.id});
      const deletion=await requestPrivacy(f[targetRole],{kind:'DELETE'});
      const [deleted,accepted]=await Promise.allSettled([
        resolvePrivacy(f.admin,{id:deletion.id,state:'COMPLETED',reason:'TEST deletion and reservation account-row race.'}),
        decideRequest(f.lender,{id:request.id,durationDays:14},'ACCEPTED'),
      ]);
      assert.equal([deleted,accepted].filter(row=>row.status==='fulfilled').length,1);
      const loans=await query('SELECT id,state,copy_id FROM loans WHERE request_id=$1',[request.id]);
      const member=await first('SELECT status FROM members WHERE id=$1',[f[targetRole].id]);
      const savedCopy=await first('SELECT state,visibility FROM copies WHERE id=$1',[copy.id]);
      if(accepted.status==='fulfilled'){
        assert.equal(deleted.status,'rejected');if(deleted.status==='rejected')assert.equal(deleted.reason?.code,'ACTIVE_LOANS');
        assert.equal(member.status,'ACTIVE');assert.equal(loans.rows.length,1);assert.equal(loans.rows[0].state,'RESERVED');
        assert.equal(loans.rows[0].copy_id,copy.id);assert.equal(savedCopy.state,'RESERVED');
        const participants=await query('SELECT status FROM members WHERE id=ANY($1::text[])',[[f.lender.id,f.borrower.id]]);
        assert.ok(participants.rows.every(row=>row.status==='ACTIVE'));
        await rejectsCode(resolvePrivacy(f.admin,{id:deletion.id,state:'COMPLETED',reason:'TEST active reservation remains protected on retry.'}),'ACTIVE_LOANS');
      }else{
        assert.equal(deleted.status,'fulfilled');assert.equal(accepted.reason?.code,'ACCOUNT_RESTRICTED');
        assert.equal(member.status,'DELETED');assert.equal(loans.rows.length,0);
        assert.equal((await first('SELECT state FROM privacy_requests WHERE id=$1',[deletion.id])).state,'COMPLETED');
        if(targetRole==='lender'){assert.equal(savedCopy.state,'REMOVED');assert.equal(savedCopy.visibility,'PRIVATE');}
        else assert.equal(savedCopy.state,'AVAILABLE');
      }
    }
  });
});
