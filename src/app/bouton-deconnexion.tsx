"use client";

import { useSession } from "next-auth/react";

import { seDeconnecter } from "@/components/atlas/menu-compte";

/** « Se déconnecter » hors d'Atlas (page introuvable) : affiché seulement à une session ouverte. */
export function BoutonDeconnexion() {
  const { data } = useSession();
  if (!data?.user) return null;
  return (
    <button
      type="button"
      title={data.user.email ? `Se déconnecter (${data.user.email})` : "Se déconnecter"}
      onClick={seDeconnecter}
      style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid oklch(0.85 0 0)", background: "white", cursor: "pointer" }}
    >
      Se déconnecter
    </button>
  );
}
