"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ClavierReact } from "react";

import { libelleValeur, titreValeur } from "@/atlas/libelles";

import { appeler, ErreurAtlas, estAnnulation, texteErreur } from "./api";
import { EditeurConditions } from "./editeur-conditions";
import { avecCondition, type EtapeEntonnoir } from "./flux";
import { lienValeur } from "./fiche-logique";
import { Chargement, Icone } from "./icones";
import { DEMANDE_PRIORITE, lignesDepuis, suggestionsRestantes, validerCriteres, type LigneEditeur } from "./lignes";
import { CLE_COLONNES_MAITRE, COLONNES_MAITRE_CHOIX, colonnesAffichees, contactConnu, formaterCellule, lireColonnesMaitre, formaterNombre, grouperChamps, largeurBarre, libellePoints, libelleColonne, phraseCondition, titreCellule } from "./logique";
import type { ApercuMarche, ChampInfo, Critere, Filtre, LigneMarche, RepartitionMarche } from "./types";

const PAR_PAGE = 20;

/** Une ligne de barre qui se clique comme un bouton, sans changer la mise en page. */
const LIGNE_CLIQUABLE = { background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer", width: "100%" } as const;

/** Rien à montrer : un message, et « Effacer les filtres » quand l'écran sait le faire. */
export function Vide({ texte, onEffacer }: { texte: string; onEffacer?: () => void }) {
  return (
    <div className="empty">
      <p style={{ margin: 0 }}>{texte}</p>
      {onEffacer && (
        <button type="button" className="btn sm" style={{ marginTop: 12 }} onClick={onEffacer}>
          Effacer les filtres
        </button>
      )}
    </div>
  );
}

export function Erreur({ texte, onReessayer }: { texte: string; onReessayer?: () => void }) {
  return (
    <p className="err" role="alert">
      <Icone nom="alerte" />
      <span>{texte}</span>
      {onReessayer && (
        <button type="button" onClick={onReessayer}>
          Réessayer
        </button>
      )}
    </p>
  );
}

// ---------------------------------------------------------------- répartition

export function VueBarres({
  filtre,
  champs,
  index,
  onFiltrer,
  onEffacerFiltres,
}: {
  filtre: Filtre;
  champs: ChampInfo[];
  index: ReadonlyMap<string, ChampInfo>;
  /** Clic sur une barre : ajoute le filtre « champ de l'axe = cette valeur » (branché par l'écran parent). */
  onFiltrer?: (champ: string, valeur: string) => void;
  onEffacerFiltres?: () => void;
}) {
  const axes = champs.filter((c) => c.repartition);
  const [champ, setChamp] = useState(() => (axes.some((c) => c.id === "departement") ? "departement" : (axes[0]?.id ?? "")));
  const [donnees, setDonnees] = useState<{ cle: string; total: number; site: number | null }[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const cle = JSON.stringify(filtre);
  const avecSite = index.has("site");

  useEffect(() => {
    if (!champ) return;
    const ctl = new AbortController();
    const f = JSON.parse(cle) as Filtre;
    setErreur(null);
    Promise.all([
      appeler<RepartitionMarche>("repartir_marche", { filtre: f, champ, limite: 30 }, ctl.signal),
      avecSite ? appeler<RepartitionMarche>("repartir_marche", { filtre: avecCondition(f, { champ: "site", op: "renseigne", valeur: true }), champ, limite: 200 }, ctl.signal) : Promise.resolve(null),
    ])
      .then(([t, s]) => {
        const parCle = new Map((s?.valeurs ?? []).map((x) => [x.cle, x.nombre]));
        setDonnees(t.valeurs.map((x) => ({ cle: x.cle, total: x.nombre, site: s ? Math.min(x.nombre, parCle.get(x.cle) ?? 0) : null })));
      })
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle, champ, avecSite, essai]);

  const max = Math.max(0, ...(donnees ?? []).map((d) => d.total));
  return (
    <div>
      <div className="tools">
        <label htmlFor="atlas-axe">Répartir par</label>
        <select id="atlas-axe" className="sel" value={champ} onChange={(e) => setChamp(e.target.value)}>
          {grouperChamps(axes).map((g) => (
            <optgroup key={g.groupe} label={g.groupe}>
              {g.champs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.libelle}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {erreur && <Erreur texte={erreur} onReessayer={() => setEssai((n) => n + 1)} />}
      {!donnees && !erreur && <Chargement />}
      {donnees && donnees.length === 0 && <Vide texte="Aucune valeur renseignée pour ces filtres." onEffacer={filtre.conditions.length ? onEffacerFiltres : undefined} />}
      {donnees && donnees.length > 0 && (
        <div className="hbars">
          {donnees.map((d) => {
            const etiquette = libelleValeur(champ, d.cle);
            const contenu = (
              <>
                <span>{etiquette}</span>
                <span className="t" aria-hidden>
                  {d.site === null ? (
                    <i style={{ width: `${largeurBarre(d.total, max)}%`, background: "var(--blue)" }} />
                  ) : (
                    <>
                      <i style={{ width: `${largeurBarre(d.site, max)}%`, background: "var(--primary)" }} />
                      <i style={{ width: `${largeurBarre(d.total - d.site, max)}%`, background: "var(--blue)" }} />
                    </>
                  )}
                </span>
                <span className="v num">{formaterNombre(d.total)}</span>
              </>
            );
            const titre = titreValeur(champ, d.cle);
            return onFiltrer && d.cle !== "" ? (
              <button key={d.cle} type="button" className="hb" style={LIGNE_CLIQUABLE} title={`${titre} : filtrer sur cette valeur`} onClick={() => onFiltrer(champ, d.cle)}>
                {contenu}
              </button>
            ) : (
              <div key={d.cle} className="hb" title={titre}>
                {contenu}
              </div>
            );
          })}
          {avecSite && (
            <p className="hint">
              <span style={{ color: "var(--fg)" }}>■</span> avec site web &nbsp; <span style={{ color: "var(--blue)" }}>■</span> sans site web.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- entonnoir

export function VueEntonnoir({ etapes }: { etapes: EtapeEntonnoir[] }) {
  const [comptes, setComptes] = useState<number[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const cle = JSON.stringify(etapes.map((e) => e.filtre));

  useEffect(() => {
    const ctl = new AbortController();
    const filtres = JSON.parse(cle) as Filtre[];
    setComptes(null);
    setErreur(null);
    Promise.all(filtres.map((filtre) => appeler<ApercuMarche>("explorer_marche", { filtre, colonnes: ["nom"], page: 1, par_page: 1 }, ctl.signal)))
      .then((r) => setComptes(r.map((x) => x.total)))
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [cle]);

  if (erreur) return <Erreur texte={erreur} />;
  if (!comptes) return <Chargement />;
  const max = comptes[0] || 1;
  return (
    <div className="hbars">
      {etapes.map((e, i) => (
        <div key={`${i}-${e.libelle}`} className="hb">
          <span title={e.libelle}>{e.libelle}</span>
          <span className="t" aria-hidden>
            <i style={{ width: `${largeurBarre(comptes[i] ?? 0, max)}%`, background: i === etapes.length - 1 ? "var(--blue)" : "oklch(.82 0 0)" }} />
          </span>
          <span className="v num">{formaterNombre(comptes[i] ?? 0)}</span>
        </div>
      ))}
      <p className="hint">{etapes.length > 1 ? "Ce que coûte chaque filtre, dans l'ordre." : "Ajoutez des filtres pour voir ce que coûte chacun."}</p>
    </div>
  );
}

// ---------------------------------------------------------------- tableau

const MAX_COLONNES = 25;

export function SelecteurColonnes({ champs, colonnes, onChange }: { champs: ChampInfo[]; colonnes: string[]; onChange: (c: string[]) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", fermer);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", fermer);
    };
  }, [ouvert]);
  const bascule = (id: string) => {
    if (colonnes.includes(id)) {
      if (colonnes.length > 1) onChange(colonnes.filter((c) => c !== id));
    } else if (colonnes.length < MAX_COLONNES) onChange([...colonnes, id]);
  };
  return (
    <div ref={ref} style={{ position: "relative", marginLeft: "auto" }}>
      <button type="button" className="btn sm" aria-expanded={ouvert} aria-haspopup="dialog" onClick={() => setOuvert((o) => !o)}>
        <Icone nom="colonnes" />
        Colonnes <span className="num" style={{ color: "var(--muted)" }}>{colonnes.length}</span>
      </button>
      {ouvert && (
        <div className="colpop" role="dialog" aria-label="Colonnes affichées">
          <p className="hint">
            {colonnes.length} sur {MAX_COLONNES} colonnes au plus.
          </p>
          {grouperChamps(champs.filter((c) => c.colonne !== false)).map((g) => (
            <fieldset key={g.groupe}>
              <legend>{g.groupe}</legend>
              {g.champs.map((c) => (
                <label key={c.id} className="ck">
                  <input type="checkbox" checked={colonnes.includes(c.id)} disabled={!colonnes.includes(c.id) && colonnes.length >= MAX_COLONNES} onChange={() => bascule(c.id)} />
                  {c.libelle}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

function Tableau({
  apercu,
  index,
  rang,
  onFiche,
  busy,
  montrerSiren = false,
  colonnesChoisies,
}: {
  apercu: ApercuMarche;
  index: ReadonlyMap<string, ChampInfo>;
  rang?: number;
  montrerSiren?: boolean;
  /** Base maître : colonnes choisies côté navigateur (« contact » composée des drapeaux). */
  colonnesChoisies?: readonly string[];
  onFiche: (siren: string, nom: string) => void;
  busy: boolean;
}) {
  const cols = colonnesChoisies
    ? colonnesChoisies.filter((c) => c === "contact" || apercu.colonnes.includes(c))
    : colonnesAffichees(apercu.colonnes, apercu.lignes).filter((c) => c !== "siren" || montrerSiren);
  // Nom figé à gauche quand le tableau défile (parente, 27/11) ; pas dans un classement, où le rang le précède.
  const fige = (c: string) => (c === "nom" && rang === undefined ? "fige" : undefined);
  const ouvrir = (l: LigneMarche) => {
    const siren = typeof l.siren === "string" ? l.siren : typeof l.siren === "number" ? String(l.siren).padStart(9, "0") : null;
    if (siren) onFiche(siren, typeof l.nom === "string" ? l.nom : siren);
  };
  const clavier = (e: ClavierReact<HTMLTableRowElement>, l: LigneMarche) => {
    if (e.target !== e.currentTarget) return; // Entrée sur un lien de la ligne suit le lien, n'ouvre pas la fiche
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ouvrir(l);
    }
  };
  return (
    <div className={busy ? "tbl busy" : "tbl"} aria-busy={busy}>
      <table>
        <thead>
          <tr>
            {rang !== undefined && <th className="r">#</th>}
            {cols.map((c) => (
              <th key={c} className={[c === "score" ? "r" : "", fige(c) ?? ""].join(" ").trim() || undefined} scope="col">
                {libelleColonne(c, index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {apercu.lignes.map((l, i) => (
            <tr key={`${String(l.siren ?? "")}-${i}`} tabIndex={0} onClick={() => ouvrir(l)} onKeyDown={(e) => clavier(e, l)} aria-label={`Ouvrir la fiche de ${String(l.nom ?? l.siren ?? "l'entreprise")}`}>
              {rang !== undefined && <td className="r num" style={{ color: "var(--muted)" }}>{rang + i}</td>}
              {cols.map((c) => {
                const v = c === "contact" ? contactConnu(l) : l[c];
                if (c === "score" && typeof v === "number") {
                  return (
                    <td key={c} className="r">
                      <span className="score num">
                        <i aria-hidden>
                          <b style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
                        </i>
                        {v}
                      </span>
                    </td>
                  );
                }
                const texte = formaterCellule(v, index.get(c), c);
                const href = typeof v === "string" && v !== "" ? lienValeur(c, v) : undefined;
                return (
                  <td key={c} className={[typeof v === "number" ? "r num" : "", fige(c) ?? ""].join(" ").trim() || undefined} title={titreCellule(v, index.get(c), c)}>
                    {href ? (
                      <a href={href} onClick={(e) => e.stopPropagation()} {...(c === "site" ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                        {texte}
                      </a>
                    ) : (
                      texte
                    )}
                    {c === "nom" && l.client === true && <span className="badge-client">Client</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({ page, total, parPage, busy, onPage }: { page: number; total: number; parPage: number; busy: boolean; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / parPage));
  const debut = total ? (page - 1) * parPage + 1 : 0;
  const fin = Math.min(total, page * parPage);
  return (
    <div className="pager hint">
      <span className="num">
        {formaterNombre(debut)} à {formaterNombre(fin)} sur {formaterNombre(total)}. Cliquez une ligne pour la fiche complète.
      </span>
      <div>
        <button type="button" className="x" aria-label="Page précédente" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
          <Icone nom="retour" />
        </button>
        <span className="num">
          {formaterNombre(page)} / {formaterNombre(Math.min(pages, 500))}
        </span>
        <button type="button" className="x" aria-label="Page suivante" disabled={page >= Math.min(pages, 500) || busy} onClick={() => onPage(page + 1)}>
          <Icone nom="chev" />
        </button>
      </div>
    </div>
  );
}

export function VueTableau({
  filtre,
  colonnes,
  champs,
  index,
  onColonnes,
  onFiche,
  onEffacerFiltres,
  base = "prospection",
}: {
  /** « maitre » : toutes les entreprises (lister_entreprises) ; « prospection » : les entreprises contactables. */
  base?: "maitre" | "prospection";
  filtre: Filtre;
  colonnes: string[];
  champs: ChampInfo[];
  index: ReadonlyMap<string, ChampInfo>;
  onColonnes: (c: string[]) => void;
  onFiche: (siren: string, nom: string) => void;
  /** Propose « Effacer les filtres » quand aucune entreprise ne correspond. */
  onEffacerFiltres?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [apercu, setApercu] = useState<ApercuMarche | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const cle = JSON.stringify(filtre);
  const cleCols = colonnes.join(",");
  // Base maître : colonnes choisies dans ce navigateur (pas une version du segment), relues au montage.
  const [colsMaitre, setColsMaitre] = useState<string[]>(() => lireColonnesMaitre(null));
  useEffect(() => {
    try {
      setColsMaitre(lireColonnesMaitre(localStorage.getItem(CLE_COLONNES_MAITRE)));
    } catch {
      /* stockage fermé : défaut */
    }
  }, []);
  const choisirMaitre = (c: string[]) => {
    setColsMaitre(c);
    try {
      localStorage.setItem(CLE_COLONNES_MAITRE, JSON.stringify(c));
    } catch {
      /* stockage fermé : le choix vaut pour la visite */
    }
  };

  useEffect(() => setPage(1), [cle]);
  // Base maître sans critère : 30 M d'entreprises, on demande d'abord un critère (aucune requête).
  const sansCritere = base === "maitre" && filtre.conditions.length === 0;
  useEffect(() => {
    if (sansCritere) return;
    const ctl = new AbortController();
    setBusy(true);
    setErreur(null);
    const f = JSON.parse(cle) as Filtre;
    const requete =
      base === "maitre"
        ? appeler<Omit<ApercuMarche, "total"> & { total: number | null; page_suivante: number | null }>("lister_entreprises", { filtre: f, page, par_page: PAR_PAGE }, ctl.signal).then(
            (r): ApercuMarche => ({ ...r, parPage: PAR_PAGE, tri: "rank", total: r.total ?? (page - 1) * PAR_PAGE + r.lignes.length + (r.page_suivante ? 1 : 0) }),
          )
        : appeler<ApercuMarche>("explorer_marche", { filtre: f, colonnes: cleCols.split(","), page, par_page: PAR_PAGE }, ctl.signal);
    requete
      .then(setApercu)
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)))
      .finally(() => !ctl.signal.aborted && setBusy(false));
    return () => ctl.abort();
  }, [cle, cleCols, page, essai, base, sansCritere]);

  return (
    <div>
      <div className="tools">
        {base === "maitre" ? (
          <>
            <span>Toutes les entreprises actives de France (base maître) : identité et lieu. Les coordonnées s&apos;ouvrent dans la fiche des entreprises contactables.</span>
            <SelecteurColonnes
              champs={COLONNES_MAITRE_CHOIX.map((id) => ({ ...(index.get(id) ?? {}), id, libelle: libelleColonne(id, index), groupe: "Base maître" }) as ChampInfo)}
              colonnes={colsMaitre}
              onChange={choisirMaitre}
            />
          </>
        ) : (
          <>
            <span>Entreprises contactables du marché ou de la cible, par ordre du catalogue.</span>
            <SelecteurColonnes champs={champs} colonnes={colonnes} onChange={onColonnes} />
          </>
        )}
      </div>
      {sansCritere ? (
        <Vide texte="Choisissez une activité, un nom ou un département (Filtres, ou un métier dans « Taille du marché ») pour lister les entreprises." />
      ) : (
        <>
      {erreur && <Erreur texte={erreur} onReessayer={() => setEssai((n) => n + 1)} />}
      {!apercu && !erreur && <Chargement />}
      {apercu && apercu.lignes.length === 0 && <Vide texte="Aucune entreprise ne répond à ces filtres." onEffacer={filtre.conditions.length ? onEffacerFiltres : undefined} />}
      {apercu && apercu.lignes.length > 0 && (
        <>
          {apercu.coordonnees_retirees && <p className="hint note-plan" role="note">{apercu.coordonnees_retirees}</p>}
          <Tableau apercu={apercu} index={index} onFiche={onFiche} busy={busy} montrerSiren={colonnes.includes("siren")} colonnesChoisies={base === "maitre" ? colsMaitre : undefined} />
          <Pager page={page} total={apercu.total} parPage={PAR_PAGE} busy={busy} onPage={setPage} />
        </>
      )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- priorité (cible)

export function VuePriorite({
  segmentId,
  scoring,
  champs,
  index,
  peutEcrire,
  versionComparee,
  onEnregistre,
  onEcritureRefusee,
  onFiche,
  rafraichir,
}: {
  segmentId: string;
  scoring: { version: number; criteres: Critere[] } | null;
  champs: ChampInfo[];
  index: ReadonlyMap<string, ChampInfo>;
  peutEcrire: boolean;
  versionComparee: number | null;
  onEnregistre: (version: number) => void;
  onEcritureRefusee: () => void;
  onFiche: (siren: string, nom: string) => void;
  rafraichir: number;
}) {
  const [lignes, setLignes] = useState<LigneEditeur[]>(() => lignesDepuis(scoring?.criteres ?? []));
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [page, setPage] = useState(1);
  const [apercu, setApercu] = useState<ApercuMarche | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const cleScoring = JSON.stringify(scoring);

  useEffect(() => {
    const s = JSON.parse(cleScoring) as typeof scoring;
    setLignes(lignesDepuis(s?.criteres ?? []));
    setErreurs([]);
  }, [cleScoring]);
  useEffect(() => setPage(1), [segmentId, versionComparee, cleScoring]);

  const aScoring = scoring !== null;
  useEffect(() => {
    if (!aScoring) return;
    const ctl = new AbortController();
    setBusy(true);
    setErreur(null);
    appeler<ApercuMarche>("classer_segment", { segment_id: segmentId, page, par_page: PAR_PAGE, ...(versionComparee ? { scoring_version: versionComparee } : {}) }, ctl.signal)
      .then(setApercu)
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)))
      .finally(() => !ctl.signal.aborted && setBusy(false));
    return () => ctl.abort();
  }, [aScoring, segmentId, page, versionComparee, cleScoring, rafraichir]);

  const enregistrer = async () => {
    const r = validerCriteres(lignes, index);
    if (!r.ok) return setErreurs(r.erreurs);
    setEnvoi(true);
    setErreurs([]);
    try {
      const res = await appeler<{ scoring: number }>("definir_scoring", { segment_id: segmentId, scoring: { criteres: r.valeur } });
      onEnregistre(res.scoring);
    } catch (e) {
      setErreurs([texteErreur(e)]);
      if (e instanceof ErreurAtlas && e.status === 404) onEcritureRefusee();
    } finally {
      setEnvoi(false);
    }
  };

  const poidsTotal = lignes.reduce((a, l) => a + (Number(l.poids.replace(",", ".")) || 0), 0);
  const suggestions = suggestionsRestantes(lignes, index);
  const [copie, setCopie] = useState(false);
  const [propose, setPropose] = useState<{ busy: boolean; texte: string | null }>({ busy: false, texte: null });
  const proposer = async () => {
    setPropose({ busy: true, texte: null });
    try {
      const r = await appeler<{ clients: number; message?: string; regles: { condition: Critere; libelle: string; points: number; part_clients_pct: number; part_segment_pct: number; part_montant_pct?: number; moyenne?: number; moyenne_autres?: number }[] }>("proposer_priorite", { segment_id: segmentId });
      // Une règle déjà dans la liste ne s'ajoute pas deux fois.
      const corps = (c: Critere) => JSON.stringify(lignesDepuis([c]).map(({ champ, op, saisie }) => [champ, op, saisie]));
      const deja = new Set(lignes.map(({ champ, op, saisie }) => JSON.stringify([[champ, op, saisie]])));
      const neuves = r.regles.filter((x) => !deja.has(corps({ ...x.condition, poids: x.points })));
      if (neuves.length) setLignes((l) => [...l, ...lignesDepuis(neuves.map((x) => ({ ...x.condition, poids: x.points })))]);
      const pct = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
      setPropose({ busy: false, texte: r.message ?? r.regles.map((x) => `${x.libelle} : ${x.part_montant_pct !== undefined ? `${pct(x.part_montant_pct)} % de vos ventes (${pct(x.moyenne ?? 0)} € par client contre ${pct(x.moyenne_autres ?? 0)} €)` : `${pct(x.part_clients_pct)} % de vos clients`}, ${pct(x.part_segment_pct)} % de la cible`).join(" · ") });
    } catch (e) {
      setPropose({ busy: false, texte: texteErreur(e) });
    }
  };

  return (
    <div className="prio">
      <section className="ed" aria-labelledby="atlas-prio-titre">
        <h3 id="atlas-prio-titre">Priorité{scoring ? ` · v${scoring.version}` : ""}</h3>
        <p className="callout">
          Une règle = une condition et des points. Les entreprises qui cumulent le plus de points sont contactées en premier (score ramené sur 100).
        </p>
        {peutEcrire && (
          <div className="ia-reco">
            <b>Hautement recommandé : laissez votre IA écrire les règles.</b>
            <span>Elle connaît les champs et les essaie sur la cible ; vous validez.</span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(DEMANDE_PRIORITE).then(() => {
                  setCopie(true);
                  setTimeout(() => setCopie(false), 1500);
                });
              }}
            >
              {copie ? "Demande copiée" : "Copier la demande pour l'IA"}
            </button>
            <button type="button" className="btn" disabled={propose.busy} onClick={() => void proposer()}>
              {propose.busy ? "Comparaison…" : "Proposer d'après mes clients et ventes"}
            </button>
            {propose.texte && <span role="status">{propose.texte}</span>}
          </div>
        )}
        {peutEcrire ? (
          <>
            <EditeurConditions champs={champs} index={index} lignes={lignes} onChange={setLignes} avecPoids />
            {suggestions.length > 0 && (
              <div className="sugg" aria-label="Règles suggérées">
                <span className="hint">Ajouter en un clic :</span>
                {suggestions.map((r) => (
                  <button key={r.id} type="button" className="chip" onClick={() => setLignes((l) => [...l, ...lignesDepuis([{ ...r.condition, poids: r.points }])])}>
                    + {r.libelle} · {libellePoints(r.points)}
                  </button>
                ))}
              </div>
            )}
            {lignes.length > 0 && <p className="hint num">Total : {libellePoints(Math.round(poidsTotal * 10) / 10)}</p>}
            {erreurs.length > 0 && (
              <ul className="msg" role="alert" style={{ paddingLeft: 18, margin: 0 }}>
                {erreurs.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div>
              <button type="button" className="btn pri" onClick={enregistrer} disabled={envoi || lignes.length === 0}>
                {envoi ? "Enregistrement…" : scoring ? "Enregistrer une nouvelle version" : "Créer la priorité"}
              </button>
            </div>
          </>
        ) : (
          <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
            {(scoring?.criteres ?? []).map((c, i) => (
              <li key={i}>
                {phraseCondition(c, index)} · +{libellePoints(c.poids)}
              </li>
            ))}
            {!scoring && <li>Aucune priorité définie. Lecture seule sur cet espace.</li>}
          </ul>
        )}
      </section>

      <section aria-labelledby="atlas-classement-titre" style={{ minWidth: 0 }}>
        <h3 id="atlas-classement-titre" className="hint" style={{ margin: "0 0 10px", fontWeight: 500 }}>
          Classement{versionComparee ? ` selon la v${versionComparee} (comparaison)` : ""}
        </h3>
        {!scoring && <Vide texte="Ajoutez des règles pour classer la cible." />}
        {scoring && erreur && <Erreur texte={erreur} />}
        {scoring && !apercu && !erreur && <Chargement />}
        {scoring && apercu && apercu.lignes.length === 0 && <Vide texte="Aucune entreprise dans cette cible." />}
        {scoring && apercu && apercu.lignes.length > 0 && (
          <>
            {apercu.coordonnees_retirees && <p className="hint note-plan" role="note">{apercu.coordonnees_retirees}</p>}
            <Tableau apercu={apercu} index={index} rang={(page - 1) * PAR_PAGE + 1} onFiche={onFiche} busy={busy} />
            <Pager page={page} total={apercu.total} parPage={PAR_PAGE} busy={busy} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}
