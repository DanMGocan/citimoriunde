import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone', poweredByHeader: false,
  outputFileTracingExcludes: { '*': ['.env', '.env.*', './storage/**/*', './backups/**/*', './test-artifacts/**/*', './test-results/**/*', './.git/**/*'] },
  experimental: { cpus: 1 },
  images: { remotePatterns: [] },
  async headers() { return [{source:'/(.*)',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'Permissions-Policy',value:'camera=(self), microphone=(), geolocation=()'},
    {key:'X-Frame-Options',value:'DENY'}
  ]}]; }
};
export default nextConfig;
