"use client";

import { useEffect, useRef, useState } from "react";

import { appeler, ErreurAtlas, texteErreur } from "./api";
import { cheminDossier } from "./logique";
import type { Arbre, Condition, Filtre, SegmentArbre } from "./types";

/** Réponse de `vue_depuis_phrase` (VER-130), lue par l'écran. */
export type PropositionPhrase = {
  nom_propose: string;
  filtre: Filtre;
  marche: Condition[];
  cible: Condition[];
  compris: { texte: string; libelle: string; paquet: "marche" | "cible" }[];
  non_compris: string[];
  total: number;
  marche_entier?: { entreprises_actives: number };
};

const nombre = (n: number) => n.toLocaleString("fr-FR");

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
  const [phrase, setPhrase] = useState("");
  const [proposition, setProposition] = useState<PropositionPhrase | null>(null);
  const [lecture, setLecture] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const t = TEXTES[creation.type];

  useEffect(() => {
    ref.current?.focus();
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [onFermer]);

  const proposer = async () => {
    setLecture(true);
    setErreur(null);
    try {
      const p = await appeler<PropositionPhrase>("vue_depuis_phrase", { phrase: phrase.trim() });
      setProposition(p);
      if (!nom.trim() || nom === proposition?.nom_propose) setNom(p.nom_propose);
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setLecture(false);
    }
  };

  const envoyer = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      let id: string;
      if (creation.type === "dossier") {
        id = (await appeler<{ id: string }>("creer_dossier", { nom: nom.trim(), ...(dossier ? { parent_id: dossier } : {}) })).id;
      } else if (creation.type === "marche" && proposition) {
        // La phrase décrit le marché (métier, zone, taille) et, s'il y en a, sa cible (joignabilité) : les deux se créent.
        const base = { colonnes: creation.colonnes, ...(dossier ? { dossier_id: dossier } : {}) };
        id = (await appeler<{ id: string }>("creer_segment", { nom: nom.trim(), filtre: { conditions: proposition.marche }, note: `D'après : « ${phrase.trim().slice(0, 250)} »`, ...base })).id;
        if (proposition.cible.length) {
          const libelles = proposition.compris.filter((c) => c.paquet === "cible").map((c) => c.libelle);
          const nomCible = `${nom.trim()} · ${libelles.join(", ")}`.slice(0, 120);
          id = (await appeler<{ id: string }>("creer_segment", { nom: nomCible, filtre: { conditions: proposition.cible }, parent_id: id, ...base })).id;
        }
      } else if (creation.type === "marche") {
        const filtre = garder && creation.filtre ? creation.filtre : { conditions: [] };
        id = (await appeler<{ id: string }>("creer_segment", { nom: nom.trim(), filtre, colonnes: creation.colonnes, ...(dossier ? { dossier_id: dossier } : {}) })).id;
      } else {
        id = (
          await appeler<{ id: string }>("creer_segment", {
            nom: nom.trim(),
            filtre: { conditions: proposition?.filtre.conditions ?? [] },
            colonnes: creation.colonnes,
            parent_id: creation.marche.id,
            ...(proposition ? { note: `D'après : « ${phrase.trim().slice(0, 250)} »` } : {}),
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
        {creation.type !== "dossier" && (
          <div className="phrase">
            <label>
              Décrire en une phrase (facultatif)
              <textarea
                value={phrase}
                maxLength={300}
                rows={2}
                placeholder={creation.type === "cible" ? "ex. de 10 à 49 salariés, joignables par email" : "ex. plombiers de 10 à 49 salariés en Isère, joignables par email"}
                onChange={(e) => {
                  setPhrase(e.target.value);
                  setProposition(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (phrase.trim().length >= 3) void proposer();
                  }
                }}
              />
            </label>
            <button type="button" className="btn" disabled={lecture || phrase.trim().length < 3} onClick={() => void proposer()}>
              {lecture ? "Lecture…" : "Proposer la vue"}
            </button>
            {proposition && (
              <div className="compris" aria-live="polite">
                {proposition.compris.length ? (
                  <ul>
                    {proposition.compris.map((c) => (
                      <li key={c.texte + c.libelle}>
                        <span className={c.paquet === "cible" ? "pq cible" : "pq"}>{c.paquet === "cible" ? "Cible" : "Marché"}</span> {c.libelle}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Rien de reconnu : précisez un métier, une zone, une taille ou un moyen de contact.</p>
                )}
                {proposition.non_compris.length > 0 && <p>Non compris : {proposition.non_compris.join(", ")}. Vous pourrez l&apos;ajouter à la main.</p>}
                <p>
                  <b>{nombre(proposition.total)}</b> entreprise{proposition.total > 1 ? "s" : ""} contactable{proposition.total > 1 ? "s" : ""}
                  {proposition.marche_entier ? ` sur ${nombre(proposition.marche_entier.entreprises_actives)} au marché entier` : ""}. Modifiable à la main après création ; votre IA reliée peut aussi l&apos;affiner.
                </p>
              </div>
            )}
          </div>
        )}
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
        {creation.type === "marche" && nbFiltres > 0 && !proposition && (
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
