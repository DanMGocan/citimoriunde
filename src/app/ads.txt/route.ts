import {config} from '@/lib/config';
export const dynamic='force-dynamic';
export async function GET(){if(!config.adsenseVerified||!/^ca-pub-\d{16}$/.test(config.adsenseClientId))return new Response('',{status:404});return new Response(`google.com, ${config.adsenseClientId.slice(3)}, DIRECT, f08c47fec0942fa0\n`,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600'}});}
