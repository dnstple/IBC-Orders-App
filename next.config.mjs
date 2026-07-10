/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shop iPad runs iPadOS 12 (Safari 12). Supabase packages ship modern
  // syntax that old WebKit can't parse — transpile them down with the app.
  transpilePackages: [
    '@supabase/supabase-js',
    '@supabase/ssr',
    '@supabase/auth-js',
    '@supabase/realtime-js',
    '@supabase/postgrest-js',
    '@supabase/storage-js',
    '@supabase/functions-js',
    '@supabase/node-fetch',
  ],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'cdn.shopify.com' }],
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

export default nextConfig;
