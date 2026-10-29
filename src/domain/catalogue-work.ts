import type {PoolClient} from 'pg';
import {ensure} from './errors.ts';
import {roDomain} from './ro.ts';

/** Hold the resolved work through the surrounding transaction so a merge
 * cannot move existing records and then strand a later write on its redirect.
 */
export async function canonicalWork(c:PoolClient,id:string){
  const seen=new Set<string>();
  while(true){
    ensure(!seen.has(id)&&seen.size<32,'INVALID_MERGE',roDomain.ra305ccf026);seen.add(id);
    const r=await c.query('SELECT id,merged_into FROM works WHERE id=$1 FOR SHARE',[id]);
    ensure(r.rowCount,'NOT_FOUND',roDomain.r6de06cd2b3);
    if(!r.rows[0].merged_into)return id;id=r.rows[0].merged_into;
  }
}
