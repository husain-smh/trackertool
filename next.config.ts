import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lock Next.js to this repo so it doesn't walk up to C:\Users\smhus
  outputFileTracingRoot: path.join(__dirname, "."),
  
  // Ensure mongodb is treated as external for proper serverless bundling
  serverExternalPackages: ['mongodb'],
  
  // URL rewrites for cleaner OAuth callback URLs
  async rewrites() {
    return [
      // Clean callback URL: /auth/twitter/callback → /api/socap/auth/twitter/callback
      {
        source: '/auth/twitter/callback',
        destination: '/api/socap/auth/twitter/callback',
      },
    ];
  },
};

export default nextConfig;
