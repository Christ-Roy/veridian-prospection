"use client";

import { useEffect, useState } from "react";

import { titreValeur } from "@/atlas/libelles";

import { appeler, estAnnulation, texteErreur } from "./api";
import { Chargement } from "./icones";
import { formaterNombre, phraseCondition } from "./logique";
import { AXES_MARCHE, CHAMP_DE_AXE, COLONNES_MARCHE, STATUTS_MARCHE, codesPreselectionnes, etiquetteLigne, evolution, parClasseEffectif, part, serieCreations, type StatutMarche } from "./marche";
import type { AnalyseMarche, AxeMarche, ChampInfo, Filtre } from "./types";
import { Erreur, Vide } from "./vues";

/** Ajoute le filtre « champ parmi valeur » (branché par l'écran parent). */
export type SurFiltrer = (champ: string, valeur: string) => void;

/** Une ligne qui se clique comme un bouton, sans changer la mise en page de la barre. */
const LIGNE_CLIQUABLE = { background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", width: "100%" } as const;

/** Lignes du tableau montrées d'abord : au-delà, le dossier disparaît sous 100 départements. */
const LIGNES_VISIBLES = 20;

type CodeActivite = { naf: string; libelle: string; signaux: string[]; par_nom: number; entreprises_actives: number; contactables: number; email_envoyable: number };

/** Trouver les codes d'un métier : libellés officiels et codes réellement portés par les entreprises du métier. */
function RechercheMetier({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const [mots, setMots] = useState("");
  const [codes, setCodes] = useState<CodeActivite[] | null>(null);
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const court = mots.trim().length > 0 && mots.trim().length < 3;
  const chercher = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await appeler<{ codes: CodeActivite[] }>("chercher_activites", { mots });
      setCodes(r.codes);
      setChoisis(new Set(codesPreselectionnes(r.codes)));
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
        <input id="atlas-metier" className="sel" type="search" placeholder="ex. chasse, toilettage chien" aria-describedby="atlas-metier-aide" value={mots} onChange={(e) => setMots(e.target.value)} />
        <button type="submit" className="btn" disabled={envoi || mots.trim().length < 3}>
          {envoi ? "Recherche…" : "Trouver les codes"}
        </button>
      </form>
      <p id="atlas-metier-aide" className="hint">
        {court ? "Tapez au moins 3 lettres pour lancer la recherche." : "Au moins 3 lettres. Plusieurs mots : tous doivent correspondre."}
      </p>
      {erreur && <Erreur texte={erreur} onReessayer={() => void chercher()} />}
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
          <button type="button" className="btn pri" disabled={choisis.size === 0} onClick={() => {
              onCodes([...choisis]);
              setCodes(null); // la liste se replie : le dossier du marché filtré reprend la place
            }}>
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
function Dossier({ filtre, onFiltrer }: { filtre: Filtre; onFiltrer?: SurFiltrer }) {
  const [d, setD] = useState<{ creations: AnalyseMarche; effectif: AnalyseMarche; forme: AnalyseMarche } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const cle = JSON.stringify(filtre);
  useEffect(() => {
    const ctl = new AbortController();
    const f = JSON.parse(cle) as Filtre;
    setD(null);
    setErreur(null);
    Promise.all([
      appeler<AnalyseMarche>("analyser_marche", { filtre: f, axe: "annee_creation", statut: "tous", limite: 200 }, ctl.signal),
      appeler<AnalyseMarche>("analyser_marche", { filtre: f, axe: "effectif", limite: 30 }, ctl.signal),
      appeler<AnalyseMarche>("analyser_marche", { filtre: f, axe: "forme_juridique", limite: 10 }, ctl.signal),
    ])
      .then(([creations, effectif, forme]) => setD({ creations, effectif, forme }))
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, essai]);
  if (erreur) return <Erreur texte={`Dossier du marché indisponible : ${erreur}`} onReessayer={() => setEssai((n) => n + 1)} />;
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
    <div className="dossier-marche">
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
        <h4 id="dossier-taille">Tranche d&apos;effectif</h4>
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
        <h4 id="dossier-forme">Forme juridique</h4>
        {formes.map((l) => {
          const etiquette = etiquetteLigne(l.cle, l.libelle, "forme_juridique");
          const contenu = (
            <>
              <span>{etiquette}</span>
              <span className="t" aria-hidden>
                <i style={{ width: `${(l.entreprises / maxF) * 100}%`, background: "var(--blue)" }} />
              </span>
              <span className="v num">{formaterNombre(l.entreprises)}</span>
            </>
          );
          return onFiltrer && l.cle !== "" ? (
            <button key={l.cle} type="button" className="hb" style={LIGNE_CLIQUABLE} title={`${titreValeur("forme_juridique", l.cle)} : filtrer sur cette forme`} onClick={() => onFiltrer("forme_juridique", l.cle)}>
              {contenu}
            </button>
          ) : (
            <div key={l.cle} className="hb" title={titreValeur("forme_juridique", l.cle)}>
              {contenu}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/**
 * Taille du marché entier (cube d'ODH) pour le filtre courant : l'étape « analyse du marché ».
 * Les autres vues ne montrent que les fiches prospectables ; celle-ci compte toutes les entreprises.
 */
export function VueMarche({
  filtre,
  index,
  onCodes,
  onFiltrer,
  onEffacerFiltres,
}: {
  filtre: Filtre;
  index: ReadonlyMap<string, ChampInfo>;
  onCodes: (codes: string[]) => void;
  /** Clic sur une ligne (NAF, département, forme juridique, tranche d'effectif) : ajoute ce filtre. */
  onFiltrer?: SurFiltrer;
  /** Propose « Effacer les filtres » quand rien ne correspond. */
  onEffacerFiltres?: () => void;
}) {
  const [axe, setAxe] = useState<AxeMarche>(() => (filtre.conditions.some((c) => c.champ === "naf" && c.op === "dans") ? "naf" : "departement"));
  const [statut, setStatut] = useState<StatutMarche>("actif");
  const [donnees, setDonnees] = useState<AnalyseMarche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const [toutVoir, setToutVoir] = useState(false);
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
      <Dossier filtre={filtre} onFiltrer={onFiltrer} />
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

      {erreur && <Erreur texte={erreur} onReessayer={() => setEssai((n) => n + 1)} />}
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
              <span>contactables dans Atlas</span>
            </div>
          </div>

          {donnees.conditions_ignorees.length > 0 && (
            <p className="hint">
              Le marché se compte sur l&apos;activité, le lieu, la forme, l&apos;effectif et l&apos;année de création. Non pris en compte ici :{" "}
              {donnees.conditions_ignorees.map((c) => phraseCondition(c, index)).join(" ; ")}.
            </p>
          )}

          {donnees.lignes.length === 0 ? (
            <Vide texte="Aucune entreprise pour ces critères." onEffacer={filtre.conditions.length ? onEffacerFiltres : undefined} />
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
                  {(toutVoir ? donnees.lignes : donnees.lignes.slice(0, LIGNES_VISIBLES)).map((l) => {
                    const etiquette = etiquetteLigne(l.cle, l.libelle, donnees.axe ?? undefined);
                    const champ = donnees.axe ? CHAMP_DE_AXE[donnees.axe] : undefined;
                    const filtrer = onFiltrer && champ && l.cle !== "" ? () => onFiltrer(champ, l.cle) : null;
                    return (
                      <tr
                        key={l.cle}
                        className={filtrer ? undefined : "statique"}
                        tabIndex={filtrer ? 0 : undefined}
                        onClick={filtrer ?? undefined}
                        onKeyDown={filtrer ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), filtrer()) : undefined}
                        aria-label={filtrer ? `Filtrer sur ${etiquette}` : undefined}
                      >
                        <td title={champ ? `${titreValeur(champ, l.cle)}${filtrer ? " : cliquer pour filtrer" : ""}` : etiquette}>
                          <span className="barre" aria-hidden style={{ width: `${Math.max(2, (l.entreprises / max) * 100)}%` }} />
                          <span className="barre-p" aria-hidden style={{ width: `${(l.prospectables / max) * 100}%` }} />
                          {etiquette}
                        </td>
                        {COLONNES_MARCHE.map((c) => (
                          <td key={c.id} className="num">
                            {formaterNombre(l[c.id])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {donnees.lignes.length > LIGNES_VISIBLES && (
            <button type="button" className="lnk" onClick={() => setToutVoir((v) => !v)}>
              {toutVoir ? "Réduire" : `Voir les ${donnees.lignes.length} lignes`}
            </button>
          )}

          {onFiltrer && CHAMP_DE_AXE[donnees.axe ?? axe] && <p className="hint">Cliquez une ligne pour filtrer le marché sur cette valeur.</p>}
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
