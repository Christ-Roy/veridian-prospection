"use client";

import { useEffect, useState } from "react";

import { appeler, estAnnulation, texteErreur } from "./api";
import { Chargement, Icone } from "./icones";
import { formaterNombre, phraseCondition } from "./logique";
import { AXES_MARCHE, COLONNES_MARCHE, STATUTS_MARCHE, etiquetteLigne, evolution, parClasseEffectif, part, serieCreations, type StatutMarche } from "./marche";
import type { AnalyseMarche, AxeMarche, ChampInfo, Filtre } from "./types";

type CodeActivite = { naf: string; libelle: string; signaux: string[]; par_nom: number; entreprises_actives: number; contactables: number; email_envoyable: number };

/** Trouver les codes d'un métier : libellés officiels et codes réellement portés par les entreprises du métier. */
function RechercheMetier({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const [mots, setMots] = useState("");
  const [codes, setCodes] = useState<CodeActivite[] | null>(null);
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const chercher = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await appeler<{ codes: CodeActivite[] }>("chercher_activites", { mots });
      setCodes(r.codes);
      setChoisis(new Set(r.codes.filter((c) => c.signaux.includes("libelle") || c.par_nom >= 20).map((c) => c.naf)));
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="metier">
      <form
        className="tools"
        onSubmit={(e) => {
          e.preventDefault();
          if (mots.trim().length >= 3) void chercher();
        }}
      >
        <label htmlFor="atlas-metier">Un métier</label>
        <input id="atlas-metier" className="sel" type="search" placeholder="ex. chasse, toilettage chien" value={mots} onChange={(e) => setMots(e.target.value)} />
        <button type="submit" className="btn" disabled={envoi || mots.trim().length < 3}>
          {envoi ? "Recherche…" : "Trouver les codes"}
        </button>
      </form>
      {erreur && <p className="err">{erreur}</p>}
      {codes && codes.length === 0 && <p className="hint">Aucun code trouvé : essayez un autre mot.</p>}
      {codes && codes.length > 0 && (
        <>
          <p className="hint">Codes dont le libellé correspond, et codes portés par les entreprises du métier (par leur nom). Cochez ceux qui ont du sens.</p>
          <div className="codes">
            {codes.map((c) => (
              <label key={c.naf} className="ck">
                <input
                  type="checkbox"
                  checked={choisis.has(c.naf)}
                  onChange={(e) => setChoisis((s) => { const n = new Set(s); if (e.target.checked) n.add(c.naf); else n.delete(c.naf); return n; })}
                />
                <span>
                  <b>{c.naf}</b> {c.libelle}
                  <i>
                    {formaterNombre(c.entreprises_actives)} entreprises · {formaterNombre(c.contactables)} contactables
                    {c.par_nom ? ` · ${formaterNombre(c.par_nom)} par le nom` : ""}
                  </i>
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="btn pri" disabled={choisis.size === 0} onClick={() => onCodes([...choisis])}>
            Filtrer sur ces {choisis.size} code{choisis.size > 1 ? "s" : ""}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Dossier du marché, sur toutes les entreprises (cube d'ODH) : la dynamique (créations sur quinze ans), la
 * structure (taille, forme) ; la partie financière s'ajoutera avec le cube v4.
 */
function Dossier({ filtre }: { filtre: Filtre }) {
  const [d, setD] = useState<{ creations: AnalyseMarche; effectif: AnalyseMarche; forme: AnalyseMarche } | null>(null);
  const cle = JSON.stringify(filtre);
  useEffect(() => {
    const ctl = new AbortController();
    const f = JSON.parse(cle) as Filtre;
    setD(null);
    Promise.all([
      appeler<AnalyseMarche>("analyser_marche", { filtre: f, axe: "annee_creation", statut: "tous", limite: 200 }, ctl.signal),
      appeler<AnalyseMarche>("analyser_marche", { filtre: f, axe: "effectif", limite: 30 }, ctl.signal),
      appeler<AnalyseMarche>("analyser_marche", { filtre: f, axe: "forme", limite: 10 }, ctl.signal),
    ])
      .then(([creations, effectif, forme]) => setD({ creations, effectif, forme }))
      .catch(() => {}); // le dossier est un complément : le tableau dessous dit l'erreur
    return () => ctl.abort();
  }, [cle]);
  if (!d) return <Chargement />;
  const fin = new Date().getFullYear();
  const serie = serieCreations(d.creations.lignes, fin);
  const maxC = Math.max(1, ...serie.map((s) => s.n));
  const evo = evolution(serie, fin);
  const classes = parClasseEffectif(d.effectif.lignes);
  const maxE = Math.max(1, ...classes.map((c) => c.n));
  const formes = d.forme.lignes.filter((l) => l.entreprises > 0);
  const maxF = Math.max(1, ...formes.map((l) => l.entreprises));
  return (
    <div className="dossier">
      <section aria-labelledby="dossier-creations">
        <h4 id="dossier-creations">
          Créations par an{evo ? <span className="evo"> · {evo}</span> : null}
        </h4>
        <div className="colonnes" role="img" aria-label={`Créations par an de ${serie[0].annee} à ${fin}`}>
          {serie.map((s) => (
            <div key={s.annee} className={s.annee === fin ? "col encours" : "col"} title={`${s.annee} : ${formaterNombre(s.n)} créations${s.annee === fin ? " (année en cours)" : ""}`}>
              <i style={{ height: `${Math.max(2, (s.n / maxC) * 100)}%` }} />
              <span>{String(s.annee).slice(2)}</span>
            </div>
          ))}
        </div>
        <p className="hint">Toutes les entreprises créées chaque année, actives ou fermées depuis. L&apos;année en cours est partielle.</p>
      </section>
      <section aria-labelledby="dossier-taille">
        <h4 id="dossier-taille">Taille (salariés)</h4>
        {classes.map((c) => (
          <div key={c.libelle} className="hb">
            <span>{c.libelle}</span>
            <span className="t" aria-hidden>
              <i style={{ width: `${(c.n / maxE) * 100}%`, background: "var(--blue)" }} />
            </span>
            <span className="v num">{formaterNombre(c.n)}</span>
          </div>
        ))}
      </section>
      <section aria-labelledby="dossier-forme">
        <h4 id="dossier-forme">Forme</h4>
        {formes.map((l) => (
          <div key={l.cle} className="hb">
            <span>{l.libelle}</span>
            <span className="t" aria-hidden>
              <i style={{ width: `${(l.entreprises / maxF) * 100}%`, background: "var(--blue)" }} />
            </span>
            <span className="v num">{formaterNombre(l.entreprises)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * Taille du marché entier (cube d'ODH) pour le filtre courant : l'étape « analyse du marché ».
 * Les autres vues ne montrent que les fiches prospectables ; celle-ci compte toutes les entreprises.
 */
export function VueMarche({ filtre, index, onCodes }: { filtre: Filtre; index: ReadonlyMap<string, ChampInfo>; onCodes: (codes: string[]) => void }) {
  const [axe, setAxe] = useState<AxeMarche>(() => (filtre.conditions.some((c) => c.champ === "naf" && c.op === "dans") ? "naf" : "departement"));
  const [statut, setStatut] = useState<StatutMarche>("actif");
  const [donnees, setDonnees] = useState<AnalyseMarche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const cle = JSON.stringify(filtre);

  useEffect(() => {
    const ctl = new AbortController();
    setErreur(null);
    setDonnees(null);
    appeler<AnalyseMarche>("analyser_marche", { filtre: JSON.parse(cle) as Filtre, axe, statut, limite: 200 }, ctl.signal)
      .then(setDonnees)
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, axe, statut, essai]);

  const t = donnees?.total;
  const max = Math.max(1, ...(donnees?.lignes ?? []).map((l) => l.entreprises));
  return (
    <div className="marche">
      <Dossier filtre={filtre} />
      <RechercheMetier onCodes={onCodes} />
      <div className="tools">
        <label htmlFor="atlas-axe-marche">Répartir par</label>
        <select id="atlas-axe-marche" className="sel" value={axe} onChange={(e) => setAxe(e.target.value as AxeMarche)}>
          {AXES_MARCHE.map((a) => (
            <option key={a.id} value={a.id}>
              {a.libelle}
            </option>
          ))}
        </select>
        <span className="seg3" role="radiogroup" aria-label="Statut des entreprises">
          {STATUTS_MARCHE.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={statut === s.id} className={statut === s.id ? "on" : undefined} onClick={() => setStatut(s.id)}>
              {s.libelle}
            </button>
          ))}
        </span>
      </div>

      {erreur && (
        <p className="err" role="alert">
          <Icone nom="alerte" />
          <span>{erreur}</span>
          <button type="button" onClick={() => setEssai((n) => n + 1)}>
            Réessayer
          </button>
        </p>
      )}
      {!donnees && !erreur && <Chargement />}

      {donnees && t && (
        <>
          <div className="kpis marche-kpis" aria-live="polite">
            <div className="kpi">
              <b className="num">{formaterNombre(t.entreprises)}</b>
              <span>entreprises sur le marché</span>
            </div>
            <div className="kpi">
              <b className="num">{formaterNombre(t.email_connu)}</b>
              <span>email connu · {part(t.email_connu, t.entreprises)}</span>
            </div>
            <div className="kpi">
              <b className="num">{formaterNombre(t.email_envoyable)}</b>
              <span>email envoyable · {part(t.email_envoyable, t.entreprises)}</span>
            </div>
            <div className="kpi">
              <b className="num">{formaterNombre(t.un_canal_connu)}</b>
              <span>au moins un canal connu</span>
            </div>
            <div className="kpi">
              <b className="num">{formaterNombre(t.prospectables)}</b>
              <span>prospectables dans Atlas</span>
            </div>
          </div>

          {donnees.conditions_ignorees.length > 0 && (
            <p className="hint">
              Le marché se compte sur l&apos;activité, le lieu, la forme, l&apos;effectif et l&apos;année de création. Non pris en compte ici :{" "}
              {donnees.conditions_ignorees.map((c) => phraseCondition(c, index)).join(" ; ")}.
            </p>
          )}

          {donnees.lignes.length === 0 ? (
            <p className="empty">Aucune entreprise pour ces critères.</p>
          ) : (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{AXES_MARCHE.find((a) => a.id === donnees.axe)?.libelle ?? "Valeur"}</th>
                    {COLONNES_MARCHE.map((c) => (
                      <th key={c.id} scope="col" className="num" title={c.aide}>
                        {c.libelle}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {donnees.lignes.map((l) => (
                    <tr key={l.cle} className="statique">
                      <td title={etiquetteLigne(l.cle, l.libelle)}>
                        <span className="barre" aria-hidden style={{ width: `${Math.max(2, (l.entreprises / max) * 100)}%` }} />
                        <span className="barre-p" aria-hidden style={{ width: `${(l.prospectables / max) * 100}%` }} />
                        {etiquetteLigne(l.cle, l.libelle)}
                      </td>
                      {COLONNES_MARCHE.map((c) => (
                        <td key={c.id} className="num">
                          {formaterNombre(l[c.id])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="hint">
            Source : cube de marché ODH (INSEE SIRENE et contacts trouvés par ODH)
            {donnees.provenance ? `, calculé le ${donnees.provenance.calcule_le.slice(0, 10).split("-").reverse().join("/")}` : ""}. « Connu » : contact trouvé,
            même écarté ensuite ; « envoyable » : ce qu&apos;on peut utiliser pour un envoi.
          </p>
        </>
      )}
    </div>
  );
}
