import type { NextConfig } from "next";
import path from "path";
import withBundleAnalyzerInit from "@next/bundle-analyzer";

// Analyse de bundle activée via ANALYZE=true (npm run build).
const withBundleAnalyzer = withBundleAnalyzerInit({
  enabled: process.env.ANALYZE === "true",
});

/**
 * Pages de l'ancienne app (retirée les 15-16/11, tag archive/prospection-v1-20261109) : un favori, un lien d'un vieux
 * mail ou le Hub y menaient vers un 404 nu, sans menu ni déconnexion (mesuré le 26/11). Elles mènent à Atlas.
 */
export const ANCIENNES_PAGES = [
  "/prospects", "/pipeline", "/historique", "/inbox", "/guide", "/dashboard", "/dashboard/:rest*",
  "/segments", "/segments/:rest*", "/leads/:rest*", "/settings", "/settings/:rest*", "/admin", "/admin/:rest*", "/invite/:rest*",
];

const commit = process.env.COMMIT_SHA;
const nextConfig: NextConfig = {
  output: "standalone",
  // Deux versions servies pendant un canari (2 exemplaires, lot C) : chaque build porte son identifiant.
  ...(commit && commit !== "unknown" ? { deploymentId: commit.slice(0, 12) } : {}),
  async redirects() {
    return ANCIENNES_PAGES.map((source) => ({ source, destination: "/", permanent: false }));
  },
  productionBrowserSourceMaps: true,
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
