export type AdvisoryCandidate={id:string;title:string;authors:string[]};
export type AdvisoryResult={rankedIds:string[];title:string|null;authors:string[]};
export function validateAdvisoryOutput(value:unknown,candidates:AdvisoryCandidate[]):AdvisoryResult|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>,keys=Object.keys(v);if(keys.some(k=>!['rankedIds','title','authors'].includes(k)))return null;
 if(!Array.isArray(v.rankedIds)||v.rankedIds.length>candidates.length||!v.rankedIds.every(id=>typeof id==='string'&&candidates.some(c=>c.id===id))||new Set(v.rankedIds).size!==v.rankedIds.length)return null;
 if(v.title!==null&&(typeof v.title!=='string'||v.title.length>300))return null;
 if(!Array.isArray(v.authors)||v.authors.length>8||!v.authors.every(a=>typeof a==='string'&&a.length<=120))return null;
 // Extraction fields are displayed as unverified suggestions, never inserted automatically.
 return {rankedIds:v.rankedIds as string[],title:v.title as string|null,authors:v.authors as string[]};
}
