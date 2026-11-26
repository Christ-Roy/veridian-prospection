import type { Metadata } from "next";
import Link from "next/link";

import { BoutonDeconnexion } from "./bouton-deconnexion";

export const metadata: Metadata = { title: "Page introuvable · Atlas", robots: { index: false } };

/**
 * Adresse inconnue : en français, avec un chemin de sortie (Atlas) et la déconnexion, jamais un 404 nu
 * (26/11 : un compte neuf arrivé sur une ancienne adresse ne pouvait ni revenir ni se déconnecter).
 */
export default function Introuvable() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "var(--font-sans, system-ui)" }}>
      <div style={{ maxWidth: 420, textAlign: "center", display: "grid", gap: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Cette page n&apos;existe pas</h1>
        <p style={{ margin: 0, color: "oklch(0.45 0 0)", lineHeight: 1.5 }}>
          L&apos;adresse est ancienne ou mal recopiée. Tout Prospection se trouve maintenant dans Atlas.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" style={{ padding: "8px 14px", borderRadius: 8, background: "oklch(0.2 0 0)", color: "white", textDecoration: "none" }}>
            Retour à Atlas
          </Link>
          <BoutonDeconnexion />
        </div>
      </div>
    </main>
  );
}
