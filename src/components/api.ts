"use client";
import { uiText } from "./ui-copy";

import { useCallback, useEffect, useState, useRef } from "react";
// Domain results intentionally retain edition and copy identities instead of flattening them.
export type Entity = Record<string, any>;
export class ApiError extends Error { constructor(message: string, public code?: string) { super(message); } }
export async function request(path: string, options?: RequestInit) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new ApiError(typeof data.error === "string" ? data.error : data.error?.message || uiText.seb6804c4ed, data.code);
  return data;
}
export function resourcePath(resource: string, params: Entity = {}) {
  const search = new URLSearchParams({resource});
  for (const [key,value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key,String(value));
  return `/api/domain?${search.toString()}`;
}
export const act = (op: string, supplied: Entity = {}) => {
  const values:Entity={...supplied};
  if(op==="loan.accept"&&values.days!==undefined){values.durationDays=values.days;delete values.days;}
  if(op==="goal.set"&&values.year!==undefined){values.goalYear=values.year;delete values.year;}
  if(op==="review.respond"){values.id=values.reviewId;delete values.reviewId;}
  if(op==="photo.delete"){values.id=values.photoId;delete values.photoId;}
  if(op==="privacy.request"){values.kindPrivacy=values.kind;delete values.kind;}
  if(op==="admin.privacyResolve"){values.id=values.requestId;delete values.requestId;}
  if(op==="admin.suspend"){values.suspended=values.status!=="ACTIVE";delete values.status;}
  if(op==="loan.resolve"){values.state=values.outcome;delete values.outcome;}
  if(op==="catalogue.correct"){values.id=values.workId;values.targetType="work";if(typeof values.authors==="string")values.authors=values.authors.split(";").map((v:string)=>v.trim()).filter(Boolean);delete values.workId;}
  if(op==="message.accept"&&values.accept===false){values.decline=true;delete values.accept;}
  if(op==="moderation.report"){if(values.reason&&!values.explanation)values.explanation=values.reason;if(values.publicContact)values.contactEmail=values.publicContact;delete values.reason;delete values.publicContact;delete values.context;}
  if(op==="forum.moderate"){if(values.action==="unlock"){values.action="lock";values.enabled=false;}if(values.action==="unpin"){values.action="pin";values.enabled=false;}if(values.destinationId){if(values.action==="move")values.categoryId=values.destinationId;else values.targetId=values.destinationId;}delete values.destinationId;}
  for(const [key,value] of Object.entries(values)){
    if(value===""&&key==="homeLibraryId")values[key]=null;
    else if(value===""&&!["bio","notes","collectionNote","body","reason","explanation","description","region"].includes(key))delete values[key];
    else if(["year","days","durationDays","maxDays","points","sortOrder","target","goalYear"].includes(key)&&typeof value==="string")values[key]=Number(value);
  }
  return request("/api/domain", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op,...values})});
};
export const authAction = (path: string, fields: Entity = {}) => request(`/api/auth/${path}`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(fields)});
export function useResource(resource: string, params: Entity = {}, enabled = true, initialData?:Entity|null) {
  const path = resourcePath(resource, params);
  const [data,setData] = useState<Entity | null>(initialData||null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(enabled&&!initialData);
  const [settled,setSettled]=useState(false);
  const sequence=useRef(0);
  const reload = useCallback(async () => {
    const operation=++sequence.current;
    if (!enabled) {setLoading(false);return;}
    setLoading(!initialData);setError("");
    try {const value=await request(path);if(operation===sequence.current)setData(value);} catch (e) {if(operation===sequence.current)setError(e instanceof Error ? e.message : uiText.s09a8fc2740);} finally {if(operation===sequence.current){setLoading(false);setSettled(true);}}
  },[path,enabled]);
  useEffect(() => {void reload();return()=>{sequence.current++;};},[reload]);
  return {data,error,loading,reload,setData,settled};
}
export function fields(form: HTMLFormElement): Entity {return Object.fromEntries(new FormData(form).entries());}
export function idOf(entity: Entity) {return entity.id || entity.loan_id || entity.request_id || entity.copy_id;}
