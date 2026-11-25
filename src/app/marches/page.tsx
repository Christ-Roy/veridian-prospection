import type { Metadata } from "next";

import { cheminMarche, marchesPublics } from "@/atlas/marches-publics";

import { CadrePublic, Invitation } from "../marche/cadre";
import { ListeMarches } from "./liste";

export const dynamic = "force-dynamic";
const INDEXER = process.env.ATLAS_PUBLIC_INDEX === "1";
export const metadata: Metadata = {
  title: "Les marchés français en chiffres",
  description: "Combien d'entreprises dans chaque activité, où, quelle taille : les marchés français, activité par activité.",
  robots: { index: INDEXER, follow: INDEXER },
};

export default async function PageMarches() {
  const l = await marchesPublics().catch((e) => {
    console.error("[marche-public] index", e instanceof Error ? e.message : e);
    return null;
  });
  return (
    <CadrePublic>
      <h1 className="text-3xl font-semibold tracking-tight">Les marchés français en chiffres</h1>
      <p className="mt-2 text-neutral-600">Choisissez une activité : combien d&apos;entreprises, où elles sont, quelle taille elles font.</p>
      {l ? <ListeMarches marches={l.map((m) => ({ ...m, chemin: cheminMarche(m.naf) }))} /> : <p className="mt-6 text-neutral-600">La liste est momentanément indisponible. Réessayez dans une minute.</p>}
      <Invitation quoi="votre marché" />
    </CadrePublic>
  );
}
