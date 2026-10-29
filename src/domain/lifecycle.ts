import {roDomain} from './ro.ts';
import { ensure } from './errors.ts';
export type LoanState='RESERVED'|'ON_LOAN'|'RETURN_PENDING'|'RETURNED'|'DONATED'|'CANCELLED'|'EXPIRED'|'DISPUTED'|'LOST';
export type LoanRecord={id:string;state:LoanState;lender_id:string;borrower_id:string;duration_days:number;reserved_until:Date|string;handed_over_at:Date|string|null;due_at:Date|string|null};
export const activeStates:LoanState[]=['RESERVED','ON_LOAN','RETURN_PENDING','DISPUTED','LOST'];
export function allowedLoanAction(loan:LoanRecord,actor:string,action:string,now=new Date()):void {
  ensure(actor===loan.lender_id||actor===loan.borrower_id,'FORBIDDEN',roDomain.rad02b13ab3,403);
  const lender=actor===loan.lender_id;
  switch(action){
    case 'handover': ensure(lender&&loan.state==='RESERVED','INVALID_TRANSITION',roDomain.r5bcb84bbf7);ensure(new Date(loan.reserved_until)>now,'RESERVATION_EXPIRED',roDomain.rfcc851fb90);break;
    case 'acknowledge':ensure(!lender&&['ON_LOAN','RETURN_PENDING'].includes(loan.state),'INVALID_TRANSITION',roDomain.r24b2564af7);break;
    case 'return':ensure(!lender&&loan.state==='ON_LOAN','INVALID_TRANSITION',roDomain.rc9716b395d);break;
    case 'receive':ensure(lender&&['ON_LOAN','RETURN_PENDING','DISPUTED','LOST'].includes(loan.state)&&loan.handed_over_at,'INVALID_TRANSITION',roDomain.rc7e8c84b97);break;
    case 'cancel':ensure(loan.state==='RESERVED','INVALID_TRANSITION',roDomain.r69a94a127d);break;
    case 'extensionRequest':ensure(!lender&&loan.state==='ON_LOAN','INVALID_TRANSITION',roDomain.r6009239174);break;
    case 'extensionApprove':ensure(lender&&loan.state==='ON_LOAN','INVALID_TRANSITION',roDomain.re5810960ec);break;
    case 'dispute':ensure(['ON_LOAN','RETURN_PENDING','DISPUTED'].includes(loan.state),'INVALID_TRANSITION',roDomain.r5eab146bfe);break;
    case 'gift.offer':ensure(lender&&loan.state==='ON_LOAN','INVALID_TRANSITION',roDomain.r29a77c72c9);break;
    case 'gift.accept':ensure(!lender&&loan.state==='ON_LOAN','INVALID_TRANSITION',roDomain.r33e4b016a0);break;
    default:ensure(false,'INVALID_ACTION',roDomain.re4bf7d69cf);
  }
}
export function handoverDates(durationDays:number,now:Date):{handedOverAt:Date;dueAt:Date}{
  ensure(Number.isInteger(durationDays)&&durationDays>=1&&durationDays<=180,'INVALID_DURATION',roDomain.re161ee047c);
  return {handedOverAt:new Date(now),dueAt:new Date(now.getTime()+durationDays*86400000)};
}
export function isOverdue(loan:{state:LoanState;due_at:Date|string|null},now=new Date()):boolean {
  return ['ON_LOAN','RETURN_PENDING'].includes(loan.state)&&!!loan.due_at&&new Date(loan.due_at)<now;
}
export function eligibleReview(loan:LoanRecord,reviewer:string,recipient:string):boolean {
  return !!loan.handed_over_at&&['RETURNED','DONATED'].includes(loan.state)&&reviewer!==recipient&&[loan.lender_id,loan.borrower_id].includes(reviewer)&&[loan.lender_id,loan.borrower_id].includes(recipient);
}
