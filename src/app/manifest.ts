import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: config.appName,
    short_name: config.appName,
    description: 'Descoperă și împrumută cărți în limba română de la cititorii din comunitatea ta.',
    lang: 'ro',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#faf6ed',
    theme_color: '#174f47',
    icons: [{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}],
  };
}
