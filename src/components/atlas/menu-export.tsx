"use client";

import { useEffect, useRef, useState } from "react";

import { messageExport } from "./api";
import { LiaisonsEteintes } from "./envois";
import { Icone } from "./icones";
import type { EtatLiaisons } from "./liaisons-logique";

const HUB = process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";

/** Exporter le segment : Excel, CSV, et les applications reliées. Téléchargement par fetch pour lire un refus. */
export function MenuExport({
  segmentId,
  liaisons,
  onEnvoi,
  notifier,
}: {
  segmentId: string;
  liaisons: EtatLiaisons;
  onEnvoi: (cible: "crm" | "notifuse") => void;
  notifier: (texte: string, ko?: boolean) => void;
}) {
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
        const corps = await r.json().catch(() => null);
        if (r.status === 402 && corps?.error === "export_reserve_plan_payant") setPayant(false);
        notifier(messageExport(r.status, corps), true);
        return;
      }
      const nom = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `atlas.${format}`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const coupe = r.headers.get("x-atlas-coupe-quota") === "1" ? " : quota du jour atteint, la suite demain (5 000 lignes par jour pour l'espace)" : "";
      notifier(`${r.headers.get("x-atlas-lignes") ?? ""} entreprises exportées${coupe}`.trim());
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
          <a role="menuitem" href={`/api/atlas/rapport?segment_id=${encodeURIComponent(segmentId)}`} target="_blank" rel="noopener noreferrer" onClick={() => setOuvert(false)}>
            Rapport PDF
          </a>
          {liaisons.crm && (
            <button type="button" role="menuitem" onClick={() => (setOuvert(false), onEnvoi("crm"))}>
              Envoyer au CRM
            </button>
          )}
          {liaisons.notifuse && (
            <button type="button" role="menuitem" onClick={() => (setOuvert(false), onEnvoi("notifuse"))}>
              Envoyer vers Mail
            </button>
          )}
          <LiaisonsEteintes etat={liaisons} />
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
