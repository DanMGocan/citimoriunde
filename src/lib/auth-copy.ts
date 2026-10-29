// Romanian authentication/service copy is centralized for future locale dictionaries.
export const authCopy = {
  unavailable: "Serviciul de autentificare nu este disponibil momentan.",
  endpointDisabled: "Această operațiune nu este disponibilă.",
  registrationDisabled: "Înregistrarea nu este disponibilă momentan.",
  invalidOrigin: "Cererea nu este permisă.",
  bodyLimit: "Cererea este prea mare.",
  invalidInput: "Cererea nu este validă.",
  adultTermsRequired: "Confirmă că ai cel puțin 18 ani și că accepți condițiile pentru a crea contul.",
  legalNotReady: "Înregistrarea nu este disponibilă până când documentele necesare sunt pregătite.",
  iconOnly: "Alege o pictogramă din colecția disponibilă.",
  oauthFlow: "Folosește autentificarea Google prin redirecționare.",
  freshSession: "Autentifică-te din nou pentru a conecta contul Google.",
  sessionRequired: "Autentifică-te pentru a gestiona sesiunile.",
  invalidSession: "Alege sesiunea pe care dorești să o închizi.",
  sessionNotFound: "Sesiunea nu mai este disponibilă.",
  adminFactorRequired: "Administratorii trebuie să păstreze autentificarea în doi pași.",
  rateLimit: "Prea multe încercări. Încearcă din nou peste un minut.",
  accountLink: "Autentifică-te prin metoda existentă, apoi conectează contul Google din setări.",
  failed: "Nu am putut finaliza autentificarea. Verifică datele sau încearcă din nou.",
  emailUnavailable: "Emailul nu este disponibil momentan.",
  accountRestricted: "Autentificarea nu este disponibilă pentru acest cont.",
  resetRequested: "Dacă adresa există, îți trimitem un link pentru resetarea parolei.",
  verificationRequested: "Dacă adresa poate fi confirmată, primești un email cu instrucțiuni.",
  emailChanged: "Verifică emailul pentru a confirma schimbarea adresei.",
  completed: "Operațiunea a fost finalizată.",
} as const;
export function authEmailCopy(appName: string, url: string, reset: boolean) {
  return {
    subject: `${appName}: ${reset ? "resetarea parolei" : "confirmarea adresei de email"}`,
    text: `${reset ? "Ai cerut resetarea parolei. Alege o parolă nouă folosind acest link:" : "Confirmă adresa ta de email folosind acest link:"}\n\n${url}\n\nDacă nu ai făcut această cerere, poți ignora mesajul. Nu trimite acest link altor persoane.`,
  };
}
export function notificationEmailCopy(appName: string, appUrl: string) {
  return {
    subject: `${appName}: ai o notificare`,
    text: `Ai o notificare nouă în ${appName}.\n\nDeschide platforma: ${appUrl}/notificari\n\nConținutul mesajelor private nu este trimis prin email. Preferințe și dezabonare de la emailurile opționale: ${appUrl}/cont`,
  };
}
