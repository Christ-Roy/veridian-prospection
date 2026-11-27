/** Brancher une IA : logique pure de l'écran de premier passage. Les liens d'installation vivent dans la carte « Relier mon IA » (mon-ia.tsx). */

export type { AssistantIA, LiensIA } from "@/lib/hub/liens-ia-client";

/** L'écran de premier passage s'ouvre sur un espace sans marché, une fois par navigateur. */
export function montrerAccueil(nbSegments: number | null, dejaVu: boolean): boolean {
  return nbSegments === 0 && !dejaVu;
}
