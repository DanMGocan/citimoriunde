import type {MetadataRoute} from 'next';
import {query} from '@/lib/db';
import {config} from '@/lib/config';
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 if(config.environment!=='production')return [];
 const publicCopies=`c.visibility='PUBLIC' AND c.moderation_state='APPROVED' AND c.state<>'REMOVED' AND m.status='ACTIVE' AND NOT m.bookshelf_paused AND l.active AND w.moderation_state='APPROVED' AND w.merged_into IS NULL`;
 const [books,libraries]=await Promise.all([
  query(`SELECT DISTINCT w.id FROM works w JOIN editions e ON e.work_id=w.id JOIN copies c ON c.edition_id=e.id JOIN members m ON m.id=c.owner_id JOIN libraries l ON l.id=c.library_id WHERE ${publicCopies} ORDER BY w.id LIMIT 10000`),
  query(`SELECT DISTINCT l.id FROM libraries l JOIN copies c ON c.library_id=l.id JOIN members m ON m.id=c.owner_id JOIN editions e ON e.id=c.edition_id JOIN works w ON w.id=e.work_id WHERE ${publicCopies} ORDER BY l.id LIMIT 10000`),
 ]);
 return [{url:config.appUrl},{url:config.appUrl+'/catalog'},...books.rows.map(b=>({url:config.appUrl+'/carti/'+b.id})),...libraries.rows.map(l=>({url:config.appUrl+'/biblioteci/'+l.id}))];
}
