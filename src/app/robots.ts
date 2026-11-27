import type { MetadataRoute } from "next";

/**
 * robots.txt (pSEO, VISION-ATLAS R1) : seules les pages publiques des marchés s'indexent, et seulement si
 * ATLAS_PUBLIC_INDEX=1 (décision du 27/11). Lu à chaque requête : la variable vient du job Nomad, pas du build.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://prospection.app.veridian.site";
  if (process.env.ATLAS_PUBLIC_INDEX !== "1") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: ["/marches", "/marche/"], disallow: ["/", "/api/", "/login"] },
    sitemap: `${site}/sitemap.xml`,
  };
}
