export const ro = {
  discover: "Descoperă", mine: "Biblioteca mea", loans: "Împrumuturi", messages: "Mesaje", community: "Comunitate",
  app: "Biblioteca Comunității", loading: "Se încarcă…", retry: "Încearcă din nou", save: "Salvează", cancel: "Renunță", send: "Trimite",
  search: "Titlu, autor sau ISBN", error: "Nu am putut încheia acțiunea. Încearcă din nou.", saved: "Modificările au fost salvate.",
  login: "Intră în cont", signup: "Creează un cont", add: "Adaugă o carte", openLibrary: "Adaugă orașul tău",
  emptyBooks: "Încă nu sunt cărți aici.", emptyBooksBody: "Adaugă o carte în română pe care o poți împrumuta cititorilor din apropiere.",
  noResults: "Nu am găsit cărți pentru această căutare.", noResultsBody: "Încearcă un titlu mai scurt, numele autorului sau un alt oraș.",
  safety: "Stabiliți întâlnirea într-un loc public. Nu publica adresa de acasă și nu te simți obligat să accepți o întâlnire care te neliniștește.",
  physical: "Confirmarea ta descrie un eveniment fizic. Platforma nu verifică independent predarea sau identitatea participanților.",
  gifts: "Dăruirea transferă definitiv proprietatea către acest cititor. Cartea nu mai trebuie returnată."
} as const;
export const states: Record<string, string> = {
  AVAILABLE: "Disponibilă", PAUSED: "Retrasă temporar", RESERVED: "Rezervată", ON_LOAN: "Împrumutată", RETURN_PENDING: "Așteaptă confirmarea returului",
  RETURNED: "Returnată", DONATED: "Dăruită", PENDING: "În așteptare", ACCEPTED: "Acceptată", DECLINED: "Refuzată", CANCELLED: "Anulată", EXPIRED: "Expirată",
  DISPUTED: "În clarificare", LOST: "Pierdută", RECEIVED: "Primită", TRIAGED: "Evaluată", INVESTIGATING: "În analiză", RESOLVED: "Soluționată", DISMISSED: "Închisă fără măsuri",
  APPEAL_REQUESTED: "Contestație primită", APPEAL_RESOLVED: "Contestație soluționată", WANT_TO_READ: "Vreau să citesc", READING: "În curs", FINISHED: "Citită", ABANDONED: "Abandonată"
};
export const conditions: Record<string, string> = {NEW:"Nouă",GOOD:"Bună",FAIR:"Uzată, dar completă",WORN:"Foarte uzată"};
export const reportCategories = [{id:"harassment",label:"Hărțuire"},{id:"threat",label:"Amenințări"},{id:"scam",label:"Înșelătorie"},{id:"spam",label:"Spam"},{id:"privacy",label:"Date personale expuse"},{id:"metadata",label:"Informații incorecte"},{id:"duplicate",label:"Dublură"},{id:"prohibited",label:"Conținut interzis"},{id:"other",label:"Alt motiv"}];
export const icons = ["book","leaf","owl","fox","cat","moon","sun","star","flower","tree","mountain","coffee","lamp","feather","quill","glasses","boat","compass","key","bee","butterfly","hedgehog","acorn","shell","candle","cloud","planet","mushroom","lighthouse","rabbit","cherry","kite"];
export const iconLabels: Record<string,string> = {book:"Carte",leaf:"Frunză",fox:"Vulpe",owl:"Bufniță",cat:"Pisică",hedgehog:"Arici",rabbit:"Iepure",butterfly:"Fluture",bee:"Albină",sun:"Soare",moon:"Lună",star:"Stea",flower:"Floare",tree:"Copac",mountain:"Munte",shell:"Scoică",coffee:"Ceai",lamp:"Lampă",compass:"Busolă",feather:"Pană",quill:"Peniță",glasses:"Ochelari",boat:"Barcă",key:"Cheie",acorn:"Ghindă",candle:"Lumânare",cloud:"Nor",planet:"Planetă",mushroom:"Ciupercă",lighthouse:"Far",cherry:"Cireșe",kite:"Zmeu"};
export const iconGlyphs: Record<string,string> = {book:"▤",leaf:"❧",fox:"🦊",owl:"🦉",cat:"🐱",hedgehog:"🦔",rabbit:"🐰",butterfly:"🦋",bee:"🐝",sun:"☀",moon:"☾",star:"✦",flower:"✿",tree:"♧",mountain:"△",shell:"🐚",coffee:"☕",lamp:"☀",compass:"✥",feather:"🪶",quill:"✒",glasses:"👓",boat:"⛵",key:"🗝",acorn:"🌰",candle:"🕯",cloud:"☁",planet:"🪐",mushroom:"🍄",lighthouse:"♜",cherry:"🍒",kite:"🪁"};
export const date = (value?: string | null) => value ? new Intl.DateTimeFormat("ro-RO", {day:"numeric",month:"long",year:"numeric"}).format(new Date(value)) : "Nespecificată";
export const time = (value?: string | null) => value ? new Intl.DateTimeFormat("ro-RO", {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(value)) : "";
export function plural(n: number, singular: string, pluralForm: string) { return `${n.toLocaleString("ro-RO")} ${n === 1 ? singular : (n === 0 || n % 100 < 20 ? pluralForm : `de ${pluralForm}`)}`; }
export const loanEvents:Record<string,string>={RESERVED:"Exemplar rezervat",HANDOVER:"Predare fizică confirmată de proprietar",ACKNOWLEDGE:"Primire confirmată de cititor",RETURN:"Returnare anunțată de cititor",RECEIVE:"Primire fizică înapoi confirmată de proprietar",CANCEL:"Rezervare anulată",EXTENSIONREQUEST:"Prelungire solicitată",EXTENSIONAPPROVE:"Prelungire aprobată de proprietar",DISPUTE:"Clarificare solicitată",GIFT_OFFERED:"Carte oferită în dar",GIFT_DECLINED:"Dar refuzat; împrumutul continuă",DONATED:"Dar acceptat și proprietate transferată",MEDIATED:"Decizie de mediere înregistrată",EXPIRED:"Rezervare expirată"};
export const roleLabels:Record<string,string>={MEMBER:"Membru",MODERATOR:"Moderator",ADMIN:"Administrator"};
Object.assign(states,{ACTIVE:"Activ",SUSPENDED:"Suspendat",DELETION_PENDING:"Cerere de ștergere în evaluare",DELETED:"Retras",APPROVED:"Aprobat",REJECTED:"Respins",LINKED:"Legat de o bibliotecă existentă",VISIBLE:"Vizibil",HIDDEN:"Ascuns",DONE:"Încheiat",RUNNING:"În curs",FAILED:"Necesită verificare",REVIEWING:"În evaluare",COMPLETED:"Încheiat",REFUSED:"Refuzat cu explicație"});
export const targetLabels:Record<string,string>={service:"Solicitare de contact",message:"Mesaj privat",work:"Operă literară",edition:"Ediție",copy:"Exemplar",photo:"Fotografie",member:"Membru",member_review:"Evaluare de membru",book_review:"Recenzie de carte",topic:"Discuție",post:"Mesaj în comunitate",loan:"Împrumut"};
export const jobLabels:Record<string,string>={auth_email:"E-mail de verificare sau resetare",notification_email:"E-mail de notificare",loan_reminder:"Memento pentru returnarea unei cărți",reservation_expire:"Expirarea unei rezervări",cleanup:"Întreținere periodică",review_release:"Publicarea evaluărilor"};
