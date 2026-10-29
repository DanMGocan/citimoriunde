import {randomBytes} from 'node:crypto';
import {NextResponse,type NextRequest} from 'next/server';
import {config as deployment} from './lib/config';
import {contentSecurityPolicy} from './domain/csp';
export function proxy(request:NextRequest){
 const nonce=randomBytes(24).toString('base64');
 const integrationsReady=deployment.environment==='production'&&(deployment.adsMode==='adsense'&&deployment.adsenseVerified&&!!deployment.adsenseClientId||deployment.analyticsEnabled&&!!deployment.googleAnalyticsId||deployment.googleAdsConversionEnabled&&!!deployment.googleAdsId)&&deployment.cmpProvider==='cookiebot'&&deployment.cmpCertified&&deployment.cmpValidated&&deployment.cmpCspEnabled&&!!deployment.cmpPublisherId&&!!deployment.cmpScriptUrl&&deployment.legalReviewed&&deployment.publicLaunchReviewed;
 const policy=contentSecurityPolicy(nonce,request.nextUrl.pathname,{development:deployment.environment==='development',integrationsReady});
 const requestHeaders=new Headers(request.headers);
 // Replace any caller-supplied nonce; Next extracts the nonce from this CSP.
 requestHeaders.set('x-nonce',nonce);requestHeaders.set('Content-Security-Policy',policy);
 const response=NextResponse.next({request:{headers:requestHeaders}});
 response.headers.set('Content-Security-Policy',policy);
 if(!request.nextUrl.pathname.startsWith('/api/'))response.headers.set('Cache-Control','private, no-store');
 return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)']};
