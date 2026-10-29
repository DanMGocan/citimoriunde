import { uiText, formatText } from "./ui-copy";
import { iconGlyphs, iconLabels } from "./strings";
export function Icon({name,className="",size=22}:{name:string;className?:string;size?:number}) {
  const paths: Record<string, React.ReactNode> = {
    book:<><path d="M12 5.5C8.8 3.8 5.5 3.8 2 5v14c3.5-1.2 6.8-1.2 10 .5 3.2-1.7 6.5-1.7 10-.5V5c-3.5-1.2-6.8-1.2-10 .5Z"/><path d="M12 5.5v14"/></>,
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    home:<><path d="m3 10 9-7 9 7v11H3Z"/><path d="M9 21v-8h6v8"/></>,
    loan:<><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></>,
    message:<path d="M21 4H3v13h5l4 4 4-4h5Z"/>,
    people:<><circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m-1-17a3 3 0 0 1 0 6m4 4a5 5 0 0 1 3 5v2"/></>,
    plus:<path d="M12 4v16M4 12h16"/>,arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
    heart:<path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>,
    bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8m-11 12h4"/></>,
    shield:<><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/></>,
    leaf:<><path d="M20 3C7 2 2 8 5 15s13 6 15-12Z"/><path d="M4 21 15 9"/></>,
    pin:<><path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 0 1 14 0Z"/><circle cx="12" cy="9" r="2"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="m9 2-1 3-3 1-3 3 2 3-2 3 3 3 3 1 1 3h6l1-3 3-1 3-3-2-3 2-3-3-3-3-1-1-3Z"/></>,
    check:<path d="m4 12 5 5L20 6"/>,close:<path d="m5 5 14 14M19 5 5 19"/>,menu:<path d="M3 6h18M3 12h18M3 18h18"/>,
    gift:<><path d="M3 8h18v4H3Zm2 4v9h14v-9M12 8v13"/><path d="M12 8C5 8 4 2 8 2c3 0 4 6 4 6Zm0 0c7 0 8-6 4-6-3 0-4 6-4 6Z"/></>,
    sun:<><circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
    upload:<><path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    flag:<><path d="M5 22V3c6-4 9 4 15 0v11c-6 4-9-4-15 0"/></>,
    logout:<><path d="M9 3H3v18h6m1-9h11m-5-5 5 5-5 5"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name] || paths.book}</svg>;
}
export function Avatar({icon="book",name,size=""}:{icon?:string;name?:string;size?:string}) {return <span className={`avatar ${size}`} role="img" aria-label={name ? formatText(uiText.sa277296c6f, name, iconLabels[icon] || iconLabels.book) : iconLabels[icon] || iconLabels.book}>{iconGlyphs[icon] || iconGlyphs.book}</span>;}
export function LiteraryArt() {return <svg className="literary-art" viewBox="0 0 560 450" role="img" aria-label={uiText.s85be96af09}><defs><pattern id="paper" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 1h5" stroke="#fff" strokeOpacity=".11"/></pattern></defs><circle cx="300" cy="205" r="176" fill="#e4ece0"/><circle cx="470" cy="78" r="19" fill="#e5b679"/><path d="M62 382c82-10 352-17 445-1" stroke="#e0d8c9" strokeWidth="2"/><g transform="rotate(-11 155 305)"><rect x="113" y="161" width="69" height="220" rx="5" fill="#254a3e"/><rect x="122" y="161" width="4" height="220" fill="#486352"/><path d="M136 190h30M136 195h30M135 346h32" stroke="#b9c7a8" strokeWidth="2"/><path d="M150 248c-12 13-8 33 1 46 10-18 11-32-1-46Z" fill="none" stroke="#b9c7a8"/></g><rect x="188" y="126" width="80" height="253" rx="5" fill="#bb7055"/><rect x="198" y="126" width="5" height="253" fill="#d18b6b"/><path d="M217 154h31M217 159h31M217 347h31" stroke="#ead3af" strokeWidth="2"/><circle cx="233" cy="244" r="18" stroke="#ead3af" fill="none"/><path d="M222 244h22m-11-11v22" stroke="#ead3af"/><g transform="rotate(9 310 290)"><rect x="279" y="182" width="69" height="198" rx="5" fill="#d0b371"/><rect x="287" y="182" width="4" height="198" fill="#e1c78e"/><path d="M302 207h29M302 213h29M302 352h29" stroke="#6d623f" strokeWidth="2"/><path d="m317 263 12 12-12 12-12-12Z" stroke="#6d623f" fill="none"/></g><path d="M386 350h87l-10 31h-68Z" fill="#f9f5ec" stroke="#aaa48f" strokeWidth="2"/><path d="M469 353c30-4 21 23-7 21" fill="none" stroke="#aaa48f" strokeWidth="3"/><path d="M402 337c-8-13 7-20 0-32m24 30c-7-14 8-21 0-35" fill="none" stroke="#b7b8a2" strokeWidth="2"/><path d="M399 259c-10-63 7-123 38-176" fill="none" stroke="#576b4e" strokeWidth="3"/><g fill="#718569"><ellipse cx="405" cy="216" rx="11" ry="28" transform="rotate(-33 405 216)"/><ellipse cx="394" cy="182" rx="10" ry="25" transform="rotate(-54 394 182)"/><ellipse cx="425" cy="178" rx="10" ry="25" transform="rotate(31 425 178)"/><ellipse cx="413" cy="141" rx="10" ry="25" transform="rotate(-45 413 141)"/><ellipse cx="442" cy="121" rx="10" ry="25" transform="rotate(36 442 121)"/></g><path d="m93 112 4 11 11 4-11 4-4 11-4-11-11-4 11-4Zm391 167 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#bda97b"/></svg>;}
