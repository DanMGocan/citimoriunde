"use client";
import { uiText } from "../components/ui-copy";

export default function ErrorPage({reset}:{reset:()=>void}){return <div className="empty" role="alert"><h1>{uiText.s4ea8e10708}</h1><p>{uiText.s442247359e}</p><button className="button primary" onClick={reset}>{uiText.s2f27ef1cca}</button></div>;}
