/** Brancher une IA : logique pure du panneau et de l'écran de premier passage. */

export type LiensIA = { url: string; claude: string | null; chatgpt: string | null; cursor: string | null; vscode: string | null; claudeCode: string | null; aideChatgpt: string | null };

/** Première demande proposée : décrit l'offre, l'IA construit marché, cibles et priorité dans Atlas. */
export const PREMIERE_DEMANDE =
  "Avec Veridian (Atlas), aide-moi à définir mon marché : je vends [mon offre] à [mes clients]. Propose un marché, deux ou trois cibles et une priorité pour la prospection à froid, puis crée-les dans Atlas.";

/** Boutons dans l'ordre d'usage, Claude d'abord ; seuls ceux dont le Hub donne le lien. */
export function boutonsIA(liens: LiensIA | null): { id: string; libelle: string; href: string }[] {
  if (!liens) return [];
  const l: { id: string; libelle: string; href: string | null }[] = [
    { id: "claude", libelle: "Ajouter à Claude", href: liens.claude },
    { id: "chatgpt", libelle: "Ouvrir ChatGPT", href: liens.chatgpt },
    { id: "cursor", libelle: "Ajouter à Cursor", href: liens.cursor },
    { id: "vscode", libelle: "Ajouter à VS Code", href: liens.vscode },
  ];
  return l.filter((b): b is { id: string; libelle: string; href: string } => !!b.href);
}

/** L'écran de premier passage s'ouvre sur un espace sans marché, une fois par navigateur. */
export function montrerAccueil(nbSegments: number | null, dejaVu: boolean): boolean {
  return nbSegments === 0 && !dejaVu;
}
