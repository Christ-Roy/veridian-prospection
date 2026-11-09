"use client";

import { useEffect, useRef, useState } from "react";

import { appeler, ErreurAtlas, texteErreur } from "./api";
import { cheminDossier } from "./logique";
import type { Arbre, Filtre, SegmentArbre } from "./types";

export type Creation = { type: "dossier" } | { type: "marche"; filtre: Filtre | null; colonnes: string[] } | { type: "cible"; marche: SegmentArbre; colonnes: string[] };

const TEXTES = {
  dossier: { titre: "Nouveau dossier", aide: "Pour ranger des marchés (ex. « Agriculture »)." },
  marche: { titre: "Nouveau marché", aide: "Un marché est un segment large que l'on analyse (ex. « Éleveurs de France »). Ses cibles en héritent." },
  cible: { titre: "Nouvelle cible", aide: "Une cible restreint le marché pour une approche ; elle hérite de ses conditions et reçoit sa priorité." },
};

/** Dialogue de la maquette (`.dlg`) : créer un dossier, un marché ou une cible. Renvoie l'id créé. */
export function DialogueCreation({
  creation,
  arbre,
  onFermer,
  onCree,
  onEcritureRefusee,
}: {
  creation: Creation;
  arbre: Arbre;
  onFermer: () => void;
  onCree: (type: Creation["type"], id: string) => void;
  onEcritureRefusee: () => void;
}) {
  const [nom, setNom] = useState("");
  const [dossier, setDossier] = useState("");
  const [garder, setGarder] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const t = TEXTES[creation.type];

  useEffect(() => {
    ref.current?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [onFermer]);

  const envoyer = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      let id: string;
      if (creation.type === "dossier") {
        id = (await appeler<{ id: string }>("creer_dossier", { nom: nom.trim(), ...(dossier ? { parent_id: dossier } : {}) })).id;
      } else if (creation.type === "marche") {
        const filtre = garder && creation.filtre ? creation.filtre : { conditions: [] };
        id = (await appeler<{ id: string }>("creer_segment", { nom: nom.trim(), filtre, colonnes: creation.colonnes, ...(dossier ? { dossier_id: dossier } : {}) })).id;
      } else {
        id = (
          await appeler<{ id: string }>("creer_segment", {
            nom: nom.trim(),
            filtre: { conditions: [] },
            colonnes: creation.colonnes,
            parent_id: creation.marche.id,
            ...(creation.marche.dossier_id ? { dossier_id: creation.marche.dossier_id } : {}),
          })
        ).id;
      }
      onCree(creation.type, id);
    } catch (e) {
      setErreur(texteErreur(e));
      if (e instanceof ErreurAtlas && e.status === 404) onEcritureRefusee();
    } finally {
      setEnvoi(false);
    }
  };

  const nbFiltres = creation.type === "marche" ? (creation.filtre?.conditions.length ?? 0) : 0;
  return (
    <div className="dlg" onMouseDown={(e) => e.target === e.currentTarget && onFermer()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-dlg-titre"
        onSubmit={(e) => {
          e.preventDefault();
          if (nom.trim()) void envoyer();
        }}
      >
        <h2 id="atlas-dlg-titre">{t.titre}</h2>
        <p>{creation.type === "cible" ? `Cible du marché « ${creation.marche.nom} ». ${t.aide}` : t.aide}</p>
        <label>
          Nom
          <input ref={ref} type="text" value={nom} maxLength={120} required onChange={(e) => setNom(e.target.value)} />
        </label>
        {creation.type !== "cible" && arbre.dossiers.length > 0 && (
          <label>
            {creation.type === "dossier" ? "Dans le dossier (facultatif)" : "Dossier (facultatif)"}
            <select value={dossier} onChange={(e) => setDossier(e.target.value)}>
              <option value="">Aucun</option>
              {arbre.dossiers.map((d) => (
                <option key={d.id} value={d.id}>
                  {cheminDossier(arbre, d.id).join(" › ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {creation.type === "marche" && nbFiltres > 0 && (
          <label className="ck">
            <input type="checkbox" checked={garder} onChange={(e) => setGarder(e.target.checked)} />
            Partir des filtres en cours ({nbFiltres})
          </label>
        )}
        {erreur && (
          <p role="alert" style={{ color: "var(--danger)" }}>
            {erreur}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onFermer}>
            Annuler
          </button>
          <button type="submit" className="btn pri" disabled={envoi || !nom.trim()}>
            {envoi ? "Création…" : "Créer"}
          </button>
        </div>
      </form>
    </div>
  );
}
