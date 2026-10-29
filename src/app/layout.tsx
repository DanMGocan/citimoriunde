import { uiText } from "../components/ui-copy";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { config, publicConfig } from "../lib/config";
import { Shell } from "../components/shell";
import "./globals.css";
export const metadata:Metadata={metadataBase:new URL(config.appUrl),title:{default:config.appName,template:`%s · ${config.appName}`},description:uiText.s21276639da,openGraph:{locale:"ro_RO",type:"website",siteName:config.appName},robots:{index:true,follow:true}};
export default async function RootLayout({children}:{children:React.ReactNode}) {
 const nonce=(await headers()).get("x-nonce")||undefined;
 return <html lang="ro"><head>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap" rel="stylesheet"/>
 </head><body><Shell initial={{member:null,libraries:[],config:{...publicConfig(),cspNonce:nonce}}}>{children}</Shell></body></html>;
}
