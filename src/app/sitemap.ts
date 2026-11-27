import type { MetadataRoute } from "next";

import { cheminMarche, marchesPublics } from "@/atlas/marches-publics";

/** Les pages publiques des marchés (500 au plus), vide tant que l'indexation n'est pas ouverte (ATLAS_PUBLIC_INDEX=1). */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.ATLAS_PUBLIC_INDEX !== "1") return [];
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://prospection.app.veridian.site";
  const marches = await marchesPublics().catch((e) => {
    console.error("[sitemap] marchés illisibles", e instanceof Error ? e.message : e);
    return [];
  });
  return [{ url: `${site}/marches`, changeFrequency: "weekly", priority: 0.8 }, ...marches.map((m) => ({ url: `${site}${cheminMarche(m.naf)}`, changeFrequency: "monthly" as const, priority: 0.6 }))];
}
