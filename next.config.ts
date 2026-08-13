import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Puppeteer must stay a real Node dependency - never bundled/traced into the
  // serverless-style output, or the bundled Chromium path breaks at runtime.
  serverExternalPackages: ['puppeteer'],

  // The app is LAN-only. Next dev warns about cross-origin requests from other
  // machines on the network; these are exactly the department-head PCs we want.
  allowedDevOrigins: ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'],

  eslint: {
    ignoreDuringBuilds: true,
  },

  async headers() {
    return [
      {
        // Everything except the public video route is private LAN data.
        // Belt-and-braces: tell every cache and crawler to keep out.
        source: '/((?!videos).*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
