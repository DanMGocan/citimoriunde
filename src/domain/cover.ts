import {query} from '../lib/db';
// Public covers are approved proposals with recorded contributor rights assertions.
export async function approvedCover(workId:string){const r=await query("SELECT cover_key FROM editions WHERE work_id=$1 AND cover_state='APPROVED' AND cover_key IS NOT NULL LIMIT 1",[workId]);return r.rows[0]?.cover_key?'/api/images/'+r.rows[0].cover_key+'/640':null;}
