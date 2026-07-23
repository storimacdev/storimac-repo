import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone — a self-contained server for Docker/Cloud Run
  // deployment. See web/Dockerfile.
  output: "standalone",
};

export default nextConfig;
