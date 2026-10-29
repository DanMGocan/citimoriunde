import {query} from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(){try{await query('SELECT 1');return Response.json({running:true},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({running:false},{status:503,headers:{'Cache-Control':'no-store'}});}}
