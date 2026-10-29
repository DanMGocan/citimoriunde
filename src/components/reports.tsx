"use client";
import { uiText } from "./ui-copy";
import Link from "next/link";
import { useResource, type Entity } from "./api";
import { Icon } from "./icons";
import { ActionForm, Badge, Empty, ErrorNotice, Field, Loading, MemberGate, PageHeading, Panel } from "./ui";
import { date } from "./strings";
export function ReportsPage(){return <MemberGate><ReportsContent/></MemberGate>;}
function ReportsContent(){const result=useResource("reports");return <><PageHeading eyebrow={uiText.s9c6ab08fe3} title={uiText.sa194683c2e} description={uiText.s86ceb62796} action={<Link href="/contact" className="button secondary">{uiText.seeba4f2b4b}<Icon name="flag" size={17}/></Link>}/>{result.loading?<Loading/>:result.error?<ErrorNotice message={result.error} retry={result.reload}/>:result.data?.reports?.length?result.data.reports.map((report:Entity)=><Panel key={report.id}><div className="section-heading"><h2>{uiText.sce144b81ef}{date(report.created_at)}</h2><Badge state={report.state}/></div><p>{report.explanation}</p>{report.decision&&<blockquote>{report.decision}</blockquote>}{["RESOLVED","DISMISSED"].includes(report.state)&&<ActionForm op="moderation.appeal" extra={{reportId:report.id}} submit={uiText.s7747bc6a33} onSuccess={result.reload}><Field label={uiText.s548ccc9fae} name="reason" type="textarea" required maxLength={3000}/></ActionForm>}</Panel>):<Empty title={uiText.s38af1869dd} body={uiText.sbd274b1e08} icon="shield"/>}</>;}
