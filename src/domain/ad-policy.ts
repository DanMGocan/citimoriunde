export const privateAdRoutes=/^\/(autentificare|inregistrare|parola|resetare|verificare|cont|admin|mesaje|imprumuturi|biblioteca-mea|adauga|notificari|legal|contact|sesizari)(\/|-|$)/;
export function adDecision(input:{mode:'off'|'placeholder'|'adsense';production:boolean;placeholdersPublic:boolean;adminPreview:boolean;placementEnabled:boolean;path:string;contentEligible:boolean;ready:boolean;consent:boolean}):'hidden'|'placeholder'|'live'{
 if(!input.placementEnabled||privateAdRoutes.test(input.path))return 'hidden';
 if(input.adminPreview)return 'placeholder';
 if(input.mode==='placeholder'&&(input.placeholdersPublic||!input.production))return 'placeholder';
 if(input.mode==='adsense'&&input.ready&&input.consent&&input.contentEligible)return 'live';
 return 'hidden';
}
export function googleConsentAllowed(tc:{eventStatus?:string;purpose?:{consents?:Record<number,boolean>};vendor?:{consents?:Record<number,boolean>}}):boolean{
 return ['tcloaded','useractioncomplete'].includes(tc.eventStatus??'')&&[1,2,3,4,7,9,10].every(p=>tc.purpose?.consents?.[p]===true)&&tc.vendor?.consents?.[755]===true;
}
