import { uiText, formatText } from "../../../components/ui-copy";
import { headers } from "next/headers";
import { cache } from "react";
import type { Metadata } from "next";
import { WorkPage } from "../../../components/catalogue";
import { workDetail } from "../../../domain/catalogue";
import { libraries } from "../../../domain/libraries";
import { config } from "../../../lib/config";
const getWork=cache(async(id:string)=>workDetail(id,null).catch(()=>undefined));
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{id:string}>}):Promise<Metadata>{const {id}=await params;const data=await getWork(id);if(!data)return {title:uiText.s19ccab84e4,robots:{index:false,follow:false}};return {title:data.work.title,description:data.work.description?.slice(0,160)||formatText(uiText.s3f4f8a7ea9, data.work.title, data.work.authors.join(", ")),alternates:{canonical:`${config.appUrl}/carti/${data.work.id}`},openGraph:{title:data.work.title,type:"book"},robots:{index:data.copies.length>0,follow:true}};}
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{library?:string|string[]}>}){
 const [{id},search]=await Promise.all([params,searchParams]);
 const nonce=(await headers()).get("x-nonce")||undefined;
 const requestedLibrary=typeof search.library==="string"?search.library:undefined;
 const [data,cities]=await Promise.all([getWork(id),requestedLibrary?libraries().catch(()=>({libraries:[]})):Promise.resolve({libraries:[]})]);
 const libraryId=requestedLibrary&&cities.libraries.some(city=>city.id===requestedLibrary)?requestedLibrary:undefined;
 const json=data?{"@context":"https://schema.org","@type":"Book",name:data.work.title,author:data.work.authors.map((name:string)=>({"@type":"Person",name})),inLanguage:"ro",url:`${config.appUrl}/carti/${data.work.id}`} : null;
 return <>{json&&<script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(json).replace(/</g,"\\u003c")}}/>}<WorkPage id={id} initial={data} libraryId={libraryId}/></>;
}
