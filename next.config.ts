import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GramJS needs Node APIs on the server
  serverExternalPackages: ["telegram"],
  experimental: {
    // raised streaming-target for chunked upload routes (still capped at 4.5MB by host)
  },
};

export default nextConfig;
