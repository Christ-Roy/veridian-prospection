import type { Metadata } from "next";

import { AtlasApp } from "@/components/atlas/atlas-app";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Analyser un marché, définir ses cibles, les classer par priorité.",
};

/** L'app s'ouvre sur Atlas (docs/PLAN-ATLAS.md, phase 5) ; sans session, le middleware renvoie vers /login. */
export default function AccueilAtlas() {
  return <AtlasApp />;
}
