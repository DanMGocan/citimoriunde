"use client";
import { uiText, formatText } from "./ui-copy";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";
import { Avatar, Icon } from "./icons";
import type { Entity } from "./api";
import { ro } from "./strings";
import { ConsentControl, CmpBootstrap, GoogleTags } from "./ads";
import { SessionProvider, useSession } from "./ui";
const navigation=[{href:"/catalog",label:ro.discover,icon:"search"},{href:"/biblioteca-mea",label:ro.mine,icon:"book"},{href:"/imprumuturi",label:ro.loans,icon:"loan"},{href:"/mesaje",label:ro.messages,icon:"message"},{href:"/comunitate",label:ro.community,icon:"people"}];
export function Shell({children,initial}:{children:ReactNode;initial?:Entity}) {return <SessionProvider initial={initial}><AppShell>{children}</AppShell></SessionProvider>;}
function RomanianValidation(){useEffect(()=>{const clear=(event:Event)=>{const field=event.target;if(field instanceof HTMLInputElement||field instanceof HTMLSelectElement||field instanceof HTMLTextAreaElement){field.setCustomValidity("");field.removeAttribute("aria-invalid");}};const invalid=(event:Event)=>{const field=event.target;if(!(field instanceof HTMLInputElement||field instanceof HTMLSelectElement||field instanceof HTMLTextAreaElement))return;field.setCustomValidity("");const validity=field.validity;const message=validity.valueMissing?(field instanceof HTMLInputElement&&field.type==="checkbox"?uiText.sf1cbe9b9ac:uiText.s435d7addad):validity.typeMismatch&&field instanceof HTMLInputElement&&field.type==="email"?uiText.s1aba08f37c:validity.tooShort?uiText.s06ca5c252f:validity.rangeUnderflow||validity.rangeOverflow?uiText.s06608c6e36:uiText.s310cf2a860;field.setCustomValidity(message);field.setAttribute("aria-invalid","true");};document.addEventListener("invalid",invalid,true);document.addEventListener("input",clear,true);document.addEventListener("change",clear,true);return()=>{document.removeEventListener("invalid",invalid,true);document.removeEventListener("input",clear,true);document.removeEventListener("change",clear,true);};},[]);return null;}
function AppShell({children}:{children:ReactNode}) {
  const {me}=useSession(),path=usePathname();
  const [menu,setMenu]=useState(false);
  const appName=me?.config?.appName||ro.app;
  const publicNavigation=[{href:"/catalog",label:"Cărți",icon:"search"},{href:"/biblioteci",label:"Orașe",icon:"pin"},{href:"/comunitate",label:ro.community,icon:"people"}];
  const visibleNavigation=me?.member?navigation:publicNavigation;
  useEffect(()=>{setMenu(false);},[path]);
  return <>
    <RomanianValidation/><CmpBootstrap/><GoogleTags/>
    <a className="skip-link" href="#main">{uiText.s1b6bbc0149}</a>
    <header className="site-header"><div className="header-inner">
      <Link className="brand" href="/" aria-label={formatText(uiText.sc5b383a5a5,appName)}><span className="brand-mark"><Icon name="book" size={22}/></span><span>{appName.split(" ")[0]}<small>{appName.split(" ").slice(1).join(" ")}</small></span></Link>
      <nav className="desktop-nav" aria-label={uiText.s04b8298e25}>{visibleNavigation.map(item=><Link className={path.startsWith(item.href)?"active":""} aria-current={path.startsWith(item.href)?"page":undefined} key={item.href} href={item.href}>{item.label}</Link>)}</nav>
      <div className="header-actions">{me?.member?<><Link className="icon-button notification-link" href="/notificari" aria-label={uiText.sab34a40884}><Icon name="bell"/>{Number(me.unreadNotifications)>0&&<span className="notification-dot"/>}</Link><Link href="/cont" className="profile-link" aria-label={uiText.s64cbc8a8b0}><Avatar icon={me.member.icon}/><span>{me.member.display_name||me.member.name}</span></Link></>:<Link className="button small secondary" href="/autentificare">{ro.login}</Link>}<button className="icon-button menu-button" aria-label={menu?uiText.se09ac1c7e0:uiText.s3e2da3b693} aria-expanded={menu} aria-controls="mobile-menu" onClick={()=>setMenu(!menu)}><Icon name={menu?"close":"menu"}/></button></div>
    </div>{menu&&<nav className="mobile-menu" id="mobile-menu" aria-label={uiText.s5fa9587a05}>{visibleNavigation.map(item=><Link onClick={()=>setMenu(false)} href={item.href} key={item.href}>{item.label}</Link>)}{me?.member&&<><Link onClick={()=>setMenu(false)} href="/biblioteci">Orașe</Link><Link onClick={()=>setMenu(false)} href="/adauga">{uiText.sd572483d81}</Link><Link onClick={()=>setMenu(false)} href="/cont">{uiText.s42be19d443}</Link></>}{["ADMIN","MODERATOR"].includes(me?.member?.role)&&<Link onClick={()=>setMenu(false)} href="/admin">{uiText.s5851882e97}</Link>}</nav>}</header>
    <main id="main" className="main-container" tabIndex={-1}>{children}</main>
    <footer className="site-footer"><div className="footer-bottom"><Link className="footer-name" href="/">{appName}</Link><nav aria-label={uiText.sad26b42d8b}><Link href="/legal/termeni">{uiText.se8d8e5b780}</Link><Link href="/legal/confidentialitate">{uiText.sa9831d3948}</Link><Link href="/legal/reguli-comunitate">{uiText.se4ca8832a8}</Link><Link href="/legal/siguranta">{uiText.s784893e277}</Link><Link href="/contact">{uiText.sd275749bd9}</Link><ConsentControl/>{["ADMIN","MODERATOR"].includes(me?.member?.role)&&<Link href="/admin">{uiText.s5851882e97}</Link>}</nav></div></footer>
    {me?.member&&<nav className="bottom-nav" aria-label={uiText.s2bbcfb4638}>{navigation.map(item=><Link key={item.href} href={item.href} className={path.startsWith(item.href)?"active":""} aria-current={path.startsWith(item.href)?"page":undefined}><Icon name={item.icon} size={22}/><span>{item.label}</span></Link>)}</nav>}
  </>;
}
