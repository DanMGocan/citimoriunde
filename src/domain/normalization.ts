import {roDomain} from './ro.ts';
import { DomainError } from './errors.ts';
export function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('ro-RO').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
export function authorKey(authors: string[]): string {
  return authors.map(a => {
    const parts=a.split(',');
    const ordered=parts.length===2 ? `${parts[1]} ${parts[0]}` : a;
    return normalize(ordered);
  }).sort().join(' | ');
}
export function isbnCanonical(input?: string | null): string | null {
  if (!input?.trim()) return null;
  const n=input.replace(/[\s-]/g,'').toUpperCase();
  if (/^\d{9}[\dX]$/.test(n)) {
    if ([...n].reduce((s,c,i)=>s+(c==='X'?10:Number(c))*(10-i),0)%11!==0) throw new DomainError('ISBN_INVALID',roDomain.r02f86755f0);
    const base='978'+n.slice(0,9);
    return base+String((10-[...base].reduce((s,c,i)=>s+Number(c)*(i%2?3:1),0)%10)%10);
  }
  if (/^(978|979)\d{10}$/.test(n) && [...n].reduce((s,c,i)=>s+Number(c)*(i%2?3:1),0)%10===0) return n;
  throw new DomainError('ISBN_INVALID',roDomain.r02f86755f0);
}
export type Candidate={id:string;title:string;authors:string[];aliases?:string[]};
export function candidateConfidence(query:string,work:Candidate):number {
  const q=normalize(query),titles=[work.title,...(work.aliases??[])].map(normalize);
  if(titles.includes(q)) return .92;
  const a=authorKey(work.authors).replace(/ \| /g,' ');
  if(titles.some(t=>q===`${t} ${a}`||q===`${a} ${t}`)) return 1;
  const tokens=new Set(q.split(' '));
  const text=new Set(normalize(`${work.title} ${work.authors.join(' ')} ${(work.aliases??[]).join(' ')}`).split(' '));
  const found=[...tokens].filter(t=>text.has(t)).length;
  return tokens.size ? Math.min(.89,found/tokens.size*.85):0;
}
export function editionFingerprint(e:{language:string;publisher?:string|null;year?:number|null;translator?:string|null;volume?:string|null;abridged?:boolean|null;unspecified?:boolean;isbn?:string|null}):string {
  if(e.isbn) return 'isbn:'+isbnCanonical(e.isbn);
  return JSON.stringify([e.unspecified?'unspecified':'specified',e.language,normalize(e.publisher??''),e.year??null,normalize(e.translator??''),normalize(e.volume??''),e.abridged??null]);
}
export function safeHref(value:string):string|null {
  try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}
}
