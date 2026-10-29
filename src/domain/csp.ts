import { privateAdRoutes } from './ad-policy.ts';
// Each HTML response receives its own nonce. Google Fonts is limited to its
// stylesheet and font hosts. Other third-party resources remain blocked until
// the deployment's publisher/CMP setup has been reviewed. This permission does
// not load a script: the browser consent boundary separately controls that.
export function contentSecurityPolicy(nonce:string,path:string,options:{development:boolean;integrationsReady:boolean}){
 if(!/^[A-Za-z0-9+/_=-]{24,100}$/.test(nonce))throw new Error('Invalid CSP nonce.');
 const external=options.integrationsReady&&!privateAdRoutes.test(path);
 const scripts=`'self' 'nonce-${nonce}' 'strict-dynamic'${options.development||external?" 'unsafe-eval'":''}`;
 return ["default-src 'self'",`script-src ${scripts}`,"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",`img-src 'self' data: blob:${external?' https:':''}`,"font-src 'self' https://fonts.gstatic.com",`connect-src 'self'${options.development?' ws:':''}${external?' https:':''}`,`frame-src ${external?'https:':"'none'"}`,"object-src 'none'","base-uri 'none'","form-action 'self'","frame-ancestors 'none'"].join('; ');
}
