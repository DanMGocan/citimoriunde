import { cache } from "react";
import { uiText } from "../../../components/ui-copy";
import { LegalPage } from "../../../components/legal";
import { query } from "../../../lib/db";
import { config } from "../../../lib/config";
export const dynamic="force-dynamic";
const getDocument=cache(async(slug:string)=>query(`SELECT slug,version,title,body,is_draft,published_at FROM legal_documents WHERE slug=$1 ${config.environment==="production"?"AND NOT is_draft AND published_at IS NOT NULL AND published_at<=now()":""} ORDER BY is_draft,version DESC LIMIT 1`,[slug]).catch(()=>({rows:[]})));
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const doc=await getDocument(slug);return {title:doc.rows[0]?.title||uiText.s42e9582a97,alternates:{canonical:`${config.appUrl}/legal/${slug}`},robots:{index:doc.rows[0]?.is_draft===false,follow:true}};}
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;return <LegalPage slug={slug} initial={{documents:(await getDocument(slug)).rows}}/>;}
