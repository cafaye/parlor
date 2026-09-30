import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: the Dockerfile ships only .next/standalone plus static
  // assets, so no sources or devDependencies land in the image.
  output: "standalone",
};

export default nextConfig;
