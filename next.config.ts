import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  swcMinify: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  productionBrowserSourceMaps: false,
  experimental: {
    optimizePackageImports: ['z-ai-web-dev-sdk'],
  },
};

export default nextConfig;
