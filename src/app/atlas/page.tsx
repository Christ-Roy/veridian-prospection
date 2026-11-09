import type { Metadata } from "next";

import { AtlasApp } from "@/components/atlas/atlas-app";

export const metadata: Metadata = {
  title: "Atlas des marchés",
  description: "Explorer, segmenter et scorer le marché des entreprises françaises.",
};

export default function AtlasPage() {
  return <AtlasApp />;
}
