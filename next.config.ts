import type { NextConfig } from "next";

// Use the project's tsc binary so build-time checking matches `npm run typecheck`.
const nextConfig: NextConfig = {
  output: "standalone",
  experimental: { useTypeScriptCli: true },
};

export default nextConfig;
