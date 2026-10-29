import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedLoanAction,handoverDates,isOverdue,eligibleReview,type LoanRecord} from '../../src/domain/lifecycle.ts';

const now=new Date('2026-10-09T12:00:00Z');
const reserved:LoanRecord={id:'synthetic-loan',state:'RESERVED',lender_id:'lender',borrower_id:'borrower',duration_days:28,reserved_until:'2026-10-10T12:00:00Z',handed_over_at:null,due_at:null};
const onLoan:LoanRecord={...reserved,state:'ON_LOAN',handed_over_at:now,due_at:'2026-11-06T12:00:00Z'};

test('handover belongs to the lender and requires an unexpired reservation',()=>{
  assert.doesNotThrow(()=>allowedLoanAction(reserved,'lender','handover',now));
  assert.throws(()=>allowedLoanAction(reserved,'borrower','handover',now));
  assert.throws(()=>allowedLoanAction({...reserved,reserved_until:'2026-10-08T12:00:00Z'},'lender','handover',now));
  assert.throws(()=>allowedLoanAction({...reserved,state:'CANCELLED'},'lender','handover',now));
});
test('due date starts at actual handover time and validates duration',()=>{
  const dates=handoverDates(28,now);
  assert.equal(dates.handedOverAt.toISOString(),now.toISOString());
  assert.equal(dates.dueAt.toISOString(),'2026-11-06T12:00:00.000Z');
  assert.throws(()=>handoverDates(0,now));assert.throws(()=>handoverDates(28.5,now));
});
test('borrower return indication and lender physical receipt are separate actions',()=>{
  assert.doesNotThrow(()=>allowedLoanAction(onLoan,'borrower','return',now));
  assert.throws(()=>allowedLoanAction(onLoan,'borrower','receive',now));
  assert.doesNotThrow(()=>allowedLoanAction(onLoan,'lender','receive',now));
  assert.doesNotThrow(()=>allowedLoanAction({...onLoan,state:'RETURN_PENDING'},'lender','receive',now));
  assert.throws(()=>allowedLoanAction(reserved,'lender','receive',now));
});
test('unrelated actors cannot operate any participant transition',()=>{
  for(const action of ['handover','acknowledge','return','receive','cancel','extensionRequest','extensionApprove','dispute','gift.offer','gift.accept'])assert.throws(()=>allowedLoanAction(onLoan,'unrelated',action,now));
});
test('extensions require borrower request and lender approval on an active loan',()=>{
  assert.doesNotThrow(()=>allowedLoanAction(onLoan,'borrower','extensionRequest',now));
  assert.doesNotThrow(()=>allowedLoanAction(onLoan,'lender','extensionApprove',now));
  assert.throws(()=>allowedLoanAction(onLoan,'borrower','extensionApprove',now));
  assert.throws(()=>allowedLoanAction({...onLoan,state:'RETURNED'},'lender','extensionApprove',now));
});
test('gift offer is owner-only and acceptance is intended-borrower-only',()=>{
  assert.doesNotThrow(()=>allowedLoanAction(onLoan,'lender','gift.offer',now));
  assert.doesNotThrow(()=>allowedLoanAction(onLoan,'borrower','gift.accept',now));
  assert.throws(()=>allowedLoanAction(onLoan,'borrower','gift.offer',now));
  assert.throws(()=>allowedLoanAction(onLoan,'lender','gift.accept',now));
  assert.throws(()=>allowedLoanAction({...onLoan,state:'RETURNED'},'borrower','gift.accept',now));
});
test('overdue is derived and never applies to terminal outcomes',()=>{
  const overdue={due_at:'2026-10-08T12:00:00Z'};
  assert.equal(isOverdue({...onLoan,...overdue},now),true);
  for(const state of ['RETURNED','DONATED','CANCELLED','EXPIRED','LOST'] as const)assert.equal(isOverdue({...overdue,state},now),false);
});
test('transaction review needs a recorded handover and completed participant interaction',()=>{
  assert.equal(eligibleReview({...onLoan,state:'RETURNED'},'lender','borrower'),true);
  assert.equal(eligibleReview({...onLoan,state:'DONATED'},'borrower','lender'),true);
  assert.equal(eligibleReview({...reserved,state:'RETURNED'},'lender','borrower'),false);
  assert.equal(eligibleReview(onLoan,'lender','borrower'),false);
  assert.equal(eligibleReview({...onLoan,state:'RETURNED'},'unrelated','borrower'),false);
  assert.equal(eligibleReview({...onLoan,state:'RETURNED'},'borrower','borrower'),false);
});
