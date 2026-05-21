import type { NextConfig } from "next";
import path from "path";

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

export default nextConfig;
