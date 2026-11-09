"use client";

import { useEffect, useRef, useState } from "react";

import { messageExport } from "./api";
import { Icone } from "./icones";

const HUB = process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";

/** Exporter le segment : Excel, CSV ; Notifuse arrive. Téléchargement par fetch pour lire un refus. */
export function MenuExport({ segmentId, notifier }: { segmentId: string; notifier: (texte: string, ko?: boolean) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [payant, setPayant] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOuvert(false);
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const exporter = async (format: "xlsx" | "csv") => {
    setEnvoi(format);
    try {
      const r = await fetch(`/api/atlas/export?segment_id=${encodeURIComponent(segmentId)}&format=${format}`);
      if (!r.ok) {
        if (r.status === 402) setPayant(false);
        notifier(messageExport(r.status, await r.json().catch(() => null)), true);
        return;
      }
      const nom = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `atlas.${format}`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      notifier(`${r.headers.get("x-atlas-lignes") ?? ""} entreprises exportées`.trim());
      setOuvert(false);
    } catch {
      notifier("Export impossible : réseau indisponible.", true);
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <div className="mexport" ref={ref}>
      <button type="button" className="btn ghost" aria-haspopup="menu" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}>
        <Icone nom="tableau" />
        Exporter
      </button>
      {ouvert && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" disabled={!!envoi} onClick={() => void exporter("xlsx")}>
            {envoi === "xlsx" ? "Préparation…" : "Tableau Excel (.xlsx)"}
          </button>
          <button type="button" role="menuitem" disabled={!!envoi} onClick={() => void exporter("csv")}>
            {envoi === "csv" ? "Préparation…" : "Fichier CSV"}
          </button>
          <span role="menuitem" aria-disabled="true" className="later">
            Vers Notifuse · bientôt
          </span>
          <p className="hint">{payant ? "5 000 entreprises au plus, classées par la priorité." : "Réservé aux plans payants."}</p>
          {!payant && (
            <a className="lnk" href={`${HUB}/dashboard/billing`} target="_blank" rel="noopener noreferrer">
              Voir les plans
            </a>
          )}
        </div>
      )}
    </div>
  );
}
