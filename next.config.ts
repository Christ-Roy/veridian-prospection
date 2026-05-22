import type { NextConfig } from "next";
import path from "path";
import withBundleAnalyzerInit from "@next/bundle-analyzer";

// Analyse de bundle activée via ANALYZE=true (npm run build).
const withBundleAnalyzer = withBundleAnalyzerInit({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  webpack: (config) => {
    // Alias @veridian/shared → ./shared/shared/index.ts (Git submodule veridian-infra).
    // Le tsconfig paths suffit pour tsc/type-check mais pas pour webpack runtime.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@veridian/shared": path.resolve(__dirname, "shared/shared/index.ts"),
    };
    return config;
  },
};

export default withBundleAnalyzer(nextConfig);
