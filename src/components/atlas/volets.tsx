"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { appeler, ErreurAtlas, estAnnulation, texteErreur } from "./api";
import { enteteFiche, themesFiche } from "./fiche-logique";
import { diffFiltres, estAuteurIA, formaterHorodatage, nomAuteur } from "./flux";
import { Chargement, Icone } from "./icones";
import { formaterNombre, libelleColonne } from "./logique";
import type { ChampInfo, Epingle, Fiche, Filtre, Historique } from "./types";

// ---------------------------------------------------------------- cadre commun

/** Volet à droite avec voile : Échap ferme, le focus reste dans le volet et revient d'où il vient. */
export function Volet({ titre, sous, large, onFermer, children }: { titre: ReactNode; sous?: ReactNode; large?: boolean; onFermer: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const fermer = useRef<HTMLButtonElement>(null);
  const id = useId();
  const rappel = useRef(onFermer);
  useEffect(() => {
    rappel.current = onFermer;
  });
  useEffect(() => {
    const avant = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fermer.current?.focus();
    const clavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        rappel.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const premier = f[0];
      const dernier = f[f.length - 1];
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    };
    document.addEventListener("keydown", clavier);
    return () => {
      document.removeEventListener("keydown", clavier);
      avant?.focus();
    };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onFermer} aria-hidden />
      <aside ref={ref} className={large ? "sheet wide" : "sheet"} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="shead">
          <div>
            <h2 id={id}>{titre}</h2>
            {sous && <p>{sous}</p>}
          </div>
          <button ref={fermer} type="button" className="x" aria-label="Fermer" onClick={onFermer}>
            <Icone nom="x" />
          </button>
        </div>
        <div className="sbody">{children}</div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- fiche entreprise

export function VoletFiche({
  siren,
  nom,
  epingle,
  peutEcrire,
  onEpingler,
  onRetirer,
  onFermer,
}: {
  siren: string;
  nom: string;
  epingle: boolean;
  peutEcrire: boolean;
  onEpingler: (siren: string, nom: string) => Promise<void>;
  onRetirer: (siren: string) => Promise<void>;
  onFermer: () => void;
}) {
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    setFiche(null);
    setErreur(null);
    appeler<{ fiche: Fiche }>("fiche_entreprise_atlas", { siren }, ctl.signal)
      .then((r) => setFiche(r.fiche))
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [siren]);

  const tete = fiche ? enteteFiche(fiche, nom) : { titre: nom, sous: "" };
  const basculer = async () => {
    setEnvoi(true);
    try {
      if (epingle) await onRetirer(siren);
      else await onEpingler(siren, tete.titre);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Volet titre={tete.titre} sous={tete.sous || `SIREN ${siren}`} onFermer={onFermer}>
      {peutEcrire && (
        <div className="sact">
          <button type="button" className={epingle ? "btn" : "btn pri"} onClick={basculer} disabled={envoi} aria-pressed={epingle}>
            <Icone nom="dossier" />
            {envoi ? "…" : epingle ? "Dans le dossier · retirer" : "Ajouter au dossier"}
          </button>
        </div>
      )}
      {erreur && (
        <p className="err" role="alert">
          <Icone nom="alerte" />
          {erreur}
        </p>
      )}
      {!fiche && !erreur && <Chargement texte="Lecture de la fiche…" />}
      {fiche &&
        themesFiche(fiche).map((t) => (
          <div className="block" key={t.id}>
            <h3>{t.titre}</h3>
            <dl>
              {t.lignes.map((l) => (
                <div key={l.cle} style={{ display: "contents" }}>
                  <dt>{l.libelle}</dt>
                  <dd className={l.mono ? "mono" : undefined}>
                    {l.lien ? (
                      <a href={l.lien} target={l.cle === "site" ? "_blank" : undefined} rel={l.cle === "site" ? "noopener noreferrer" : undefined}>
                        {l.texte}
                      </a>
                    ) : (
                      l.texte
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      {fiche && <p className="hint">Données ODH, affichées telles qu&apos;elles sont ; les champs vides sont masqués.</p>}
    </Volet>
  );
}

// ---------------------------------------------------------------- dossier de travail

export function VoletDossier({
  epingles,
  erreur,
  peutEcrire,
  onOuvrir,
  onRetirer,
  onFermer,
}: {
  epingles: Epingle[] | null;
  erreur: string | null;
  peutEcrire: boolean;
  onOuvrir: (siren: string, nom: string) => void;
  onRetirer: (siren: string) => Promise<void>;
  onFermer: () => void;
}) {
  const n = epingles?.length ?? 0;
  return (
    <Volet titre="Dossier de travail" sous={`${formaterNombre(n)} entreprise${n > 1 ? "s" : ""} · partagé avec vos IA`} onFermer={onFermer}>
      <div className="callout">Claude et ChatGPT lisent ce dossier par le connecteur Prospection. Ils peuvent y épingler des fiches et interroger les mêmes données que vous.</div>
      {erreur && (
        <p className="err" role="alert">
          <Icone nom="alerte" />
          {erreur}
        </p>
      )}
      {!epingles && !erreur && <Chargement />}
      {epingles && epingles.length === 0 && <p className="empty">Dossier vide. Ouvrez une fiche et « Ajouter au dossier ».</p>}
      {epingles && epingles.length > 0 && (
        <div>
          {epingles.map((e) => (
            <div className="dwrap" key={e.siren}>
              <button type="button" className="ditem" onClick={() => onOuvrir(e.siren, e.nom)}>
                <span className="ic" style={estAuteurIA(e.auteur) ? { background: "oklch(.96 .03 45)", color: "oklch(.45 .1 45)" } : undefined}>
                  <Icone nom="ent" />
                </span>
                <span>
                  <b>{e.nom}</b>
                  <small>
                    Ajoutée par {estAuteurIA(e.auteur) ? nomAuteur(e.auteur) : "l'interface"} · {formaterHorodatage(e.date)}
                  </small>
                  {e.note && <small style={{ color: "var(--fg2)" }}>{e.note}</small>}
                </span>
              </button>
              {peutEcrire && (
                <button type="button" className="x" aria-label={`Retirer ${e.nom} du dossier`} onClick={() => void onRetirer(e.siren)}>
                  <Icone nom="x" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Volet>
  );
}

// ---------------------------------------------------------------- historique

export function VoletHistorique({
  segmentId,
  nom,
  index,
  apercu,
  peutEcrire,
  versionComparee,
  rafraichir,
  onApercu,
  onRestaurer,
  onComparer,
  onEcritureRefusee,
  onFermer,
}: {
  segmentId: string;
  nom: string;
  index: ReadonlyMap<string, ChampInfo>;
  apercu: { version: number; filtre: Filtre } | null;
  peutEcrire: boolean;
  versionComparee: number | null;
  rafraichir: number;
  onApercu: (a: { version: number; filtre: Filtre } | null) => void;
  onRestaurer: (version: number, nouvelle: number) => void;
  onComparer: (v: number | null) => void;
  onEcritureRefusee: () => void;
  onFermer: () => void;
}) {
  const [h, setH] = useState<Historique | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    setErreur(null);
    appeler<Historique>("historique_segment", { segment_id: segmentId }, ctl.signal)
      .then(setH)
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [segmentId, rafraichir]);

  const tete = h?.filtre[0]?.version ?? null;
  const montree = apercu?.version ?? tete;

  const restaurer = async () => {
    if (!apercu) return;
    setEnvoi(true);
    try {
      const r = await appeler<{ version: number }>("restaurer_version_segment", { segment_id: segmentId, version: apercu.version });
      onRestaurer(apercu.version, r.version);
    } catch (e) {
      setErreur(texteErreur(e));
      if (e instanceof ErreurAtlas && e.status === 404) onEcritureRefusee();
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Volet titre="Historique" sous={nom} onFermer={onFermer}>
      {apercu && (
        <div className="callout" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>Aperçu de la v{apercu.version}</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn" onClick={() => onApercu(null)}>
              Revenir
            </button>
            {peutEcrire && (
              <button type="button" className="btn pri" onClick={restaurer} disabled={envoi}>
                {envoi ? "…" : "Restaurer"}
              </button>
            )}
          </span>
        </div>
      )}
      {erreur && (
        <p className="err" role="alert">
          <Icone nom="alerte" />
          {erreur}
        </p>
      )}
      {!h && !erreur && <Chargement />}
      {h && (
        <div>
          <div className="block">
            <h3>Filtres</h3>
          </div>
          {h.filtre.map((v, i) => {
            const precedente = h.filtre[i + 1];
            const ia = estAuteurIA(v.auteur);
            return (
              <button
                key={v.version}
                type="button"
                className={montree === v.version ? "v cur" : "v"}
                aria-current={montree === v.version ? "true" : undefined}
                onClick={() => onApercu(v.version === tete ? null : { version: v.version, filtre: v.filtre })}
              >
                <span className="b" />
                <span>
                  <b>v{v.version}</b> <span className={ia ? "tag claude" : "tag"}>{nomAuteur(v.auteur)}</span>
                  <small>
                    {v.via === "mcp" ? "Connecteur" : "Interface"} · {formaterHorodatage(v.date)}
                  </small>
                  <ul>
                    {diffFiltres(precedente?.filtre ?? null, v.filtre, index).map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                    {v.note && <li style={{ fontFamily: "var(--f-sans)", color: "var(--muted)" }}>{v.note}</li>}
                  </ul>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {h && h.scoring.length > 0 && (
        <div>
          <div className="block">
            <h3>Priorité</h3>
          </div>
          {h.scoring.map((v, i) => {
            const compare = versionComparee === v.version || (versionComparee === null && i === 0);
            return (
              <button key={v.version} type="button" className={compare ? "v cur" : "v"} aria-pressed={compare} onClick={() => onComparer(i === 0 ? null : v.version)}>
                <span className="b" />
                <span>
                  <b>v{v.version}</b> <span className={estAuteurIA(v.auteur) ? "tag claude" : "tag"}>{nomAuteur(v.auteur)}</span>
                  <small>
                    {v.via === "mcp" ? "Connecteur" : "Interface"} · {formaterHorodatage(v.date)}
                    {i > 0 ? " · cliquer pour classer selon cette version" : " · en vigueur"}
                  </small>
                  <ul>
                    {v.criteres.map((c, j) => (
                      <li key={j}>
                        {libelleColonne(c.champ, index)} · {c.poids}
                      </li>
                    ))}
                  </ul>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Volet>
  );
}
