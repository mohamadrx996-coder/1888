import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  productionBrowserSourceMaps: false,
  // Cloudflare Pages compatibility
  experimental: {
    // تحسين الـ bundle للـ edge runtime
    optimizePackageImports: ['react', 'react-dom'],
  },
};

export default nextConfig;
