"use client";

import "./atlas.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEPARTMENT_NAMES } from "@/components/dashboard/france-map-data";

import { appeler, ErreurAtlas, estAnnulation, texteErreur } from "./api";
import { Carte } from "./carte";
import { departementsFiltre, titreZone } from "./carte-logique";
import { Accueil, DialogueIA } from "./brancher-ia";
import { MenuExport } from "./menu-export";
import { DialogueCreation, type Creation } from "./dialogues";
import { montrerAccueil, type LiensIA } from "./ia";
import {
  avecCondition,
  avecDepartement,
  estAuteurIA,
  estMarche,
  etapeCourante,
  etapesEntonnoir,
  initialeAuteur,
  joursEnvoi,
  kpisDisponibles,
  marcheDe,
  nomAuteur,
  phraseActivite,
  sectionsRail,
  segmentsChanges,
  ciblesDe,
  fusionnerIAs,
  KPIS_MARCHE,
  type ConnexionIA,
} from "./flux";
import { Chargement, Icone, type NomIcone } from "./icones";
import { cheminDossier, combiner, conditionsHeritees, formaterNombre, indexerChamps, phraseCondition, phraseFiltre } from "./logique";
import { part } from "./marche";
import { PopoverFiltres } from "./popover-filtres";
import { VueMarche } from "./vue-marche";
import { HUB_IA, Rail, type IAVue } from "./rail";
import type { AnalyseMarche, ApercuMarche, Arbre, ChampInfo, Condition, Epingle, Filtre, Historique, SegmentArbre, SegmentDetail, Vue } from "./types";
import { VoletDossier, VoletFiche, VoletHistorique } from "./volets";
import { VueBarres, VueEntonnoir, VuePriorite, VueTableau } from "./vues";

const COLONNES_LIBRES = ["nom", "commune", "departement", "naf", "taille", "chiffre_affaires", "site", "email"];
const FILTRE_VIDE: Filtre = { conditions: [] };
const SONDE_MS = 15_000;

type Volet = { type: "fiche"; siren: string; nom: string } | { type: "dossier" } | { type: "historique" } | null;
type Apercu = { version: number; filtre: Filtre } | null;

const VUES: { id: Vue; libelle: string; icone: NomIcone }[] = [
  { id: "carte", libelle: "Carte", icone: "carte" },
  { id: "marche", libelle: "Taille du marché", icone: "marche" },
  { id: "barres", libelle: "Répartition", icone: "barres" },
  { id: "entonnoir", libelle: "Entonnoir", icone: "entonnoir" },
  { id: "tableau", libelle: "Entreprises", icone: "tableau" },
  { id: "priorite", libelle: "Priorité", icone: "priorite" },
];

const heure = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Relance une animation CSS (la classe `flash` de la maquette) sur un élément. */
function flasher(el: Element | null) {
  if (!el) return;
  el.classList.remove("flash");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("flash");
}

export function AtlasApp() {
  // ---- socle : catalogue, arbre, droits
  const [champs, setChamps] = useState<ChampInfo[] | null>(null);
  const [arbre, setArbre] = useState<Arbre | null>(null);
  const [peutEcrire, setPeutEcrire] = useState(false);
  const [erreurInit, setErreurInit] = useState<{ message: string; status: number } | null>(null);
  const [essaiInit, setEssaiInit] = useState(0);

  // ---- ce qui est regardé
  const [selection, setSelection] = useState<string | null>(null);
  const [detail, setDetail] = useState<SegmentDetail | null>(null);
  const [rechargeDetail, setRechargeDetail] = useState(0);
  const [travail, setTravail] = useState<Filtre>(FILTRE_VIDE);
  const [colonnesLibres, setColonnesLibres] = useState<string[]>(COLONNES_LIBRES);
  const [apercu, setApercu] = useState<Apercu>(null);
  const [vue, setVue] = useState<Vue>("carte");
  const [descente, setDescente] = useState<string | null>(null);
  const [versionComparee, setVersionComparee] = useState<number | null>(null);
  const [rafraichir, setRafraichir] = useState(0);

  // ---- chiffres clés
  const [kpis, setKpis] = useState<Record<string, number> | null>(null);
  const [kpisBusy, setKpisBusy] = useState(false);
  const [simulee, setSimulee] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // ---- surfaces
  const [pop, setPop] = useState(false);
  const [volet, setVolet] = useState<Volet>(null);
  const [creation, setCreation] = useState<Creation | null>(null);
  const [railOuvert, setRailOuvert] = useState(false);
  const [toast, setToast] = useState<{ texte: string; ko?: boolean } | null>(null);

  // ---- dossier de travail
  const [epingles, setEpingles] = useState<Epingle[] | null>(null);
  const [erreurEpingles, setErreurEpingles] = useState<string | null>(null);

  // ---- présence de l'IA
  const [activite, setActivite] = useState<{ ia: string; texte: string } | null>(null);
  const [ias, setIas] = useState<IAVue[]>([]);
  const [connexions, setConnexions] = useState<ConnexionIA[]>([]);
  const [liensIA, setLiensIA] = useState<LiensIA | null>(null);
  const [dialogueIA, setDialogueIA] = useState(false);
  const [accueil, setAccueil] = useState(false);
  const [clignote, setClignote] = useState<string | null>(null);
  const reference = useRef<SegmentArbre[] | null>(null);
  const referenceEpingles = useRef<Set<string> | null>(null);
  const selectionRef = useRef<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const kpisRef = useRef<HTMLDivElement>(null);
  const dossierRef = useRef<HTMLButtonElement>(null);
  const premiereSelection = useRef(false);

  const index = useMemo(() => indexerChamps(champs ?? []), [champs]);

  const notifier = useCallback((texte: string, ko = false) => setToast({ texte, ko }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------------------------------------------------------------- chargement initial
  // IA branchées (venues par le connecteur du Hub), relues chaque minute : une connexion faite dans un
  // autre onglet apparaît sans recharger.
  useEffect(() => {
    let vivant = true;
    const lire = () =>
      appeler<{ connexions: ConnexionIA[]; liens: LiensIA | null }>("connexions_ia")
        .then((r) => {
          if (!vivant) return;
          setConnexions(r.connexions);
          setLiensIA(r.liens);
        })
        .catch(() => {}); // un échec garde la dernière liste : l'indicateur n'est pas une donnée critique
    void lire();
    const t = setInterval(lire, 60_000);
    return () => {
      vivant = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    Promise.all([appeler<{ champs: ChampInfo[] }>("lister_champs", {}, ctl.signal), appeler<Arbre>("lister_segments_atlas", {}, ctl.signal)])
      .then(([c, a]) => {
        setChamps(c.champs);
        setArbre(a);
        reference.current = a.segments;
        setPeutEcrire(a.peut_ecrire === true);
        setErreurInit(null);
        if (!premiereSelection.current) {
          premiereSelection.current = true;
          const premier = sectionsRail(a)[0]?.marches[0];
          if (premier) setSelection(premier.id);
        }
      })
      .catch((e) => !estAnnulation(e) && setErreurInit({ message: texteErreur(e), status: e instanceof ErreurAtlas ? e.status : 0 }));
    return () => ctl.abort();
  }, [essaiInit]);

  const chargerEpingles = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await appeler<{ epingles: Epingle[] }>("lister_epingles", {}, signal);
      setEpingles(r.epingles);
      setErreurEpingles(null);
      return r.epingles;
    } catch (e) {
      if (!estAnnulation(e)) setErreurEpingles(texteErreur(e));
      return null;
    }
  }, []);
  useEffect(() => {
    const ctl = new AbortController();
    void chargerEpingles(ctl.signal).then((l) => {
      if (l) referenceEpingles.current = new Set(l.map((e) => e.siren));
    });
    return () => ctl.abort();
  }, [chargerEpingles]);

  const rechargerArbre = useCallback(async () => {
    try {
      const a = await appeler<Arbre>("lister_segments_atlas");
      reference.current = a.segments;
      setArbre(a);
      setPeutEcrire(a.peut_ecrire === true);
    } catch (e) {
      notifier(texteErreur(e), true);
    }
  }, [notifier]);

  // ---------------------------------------------------------------- segment regardé
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    if (!selection) {
      setDetail(null);
      return;
    }
    const ctl = new AbortController();
    appeler<SegmentDetail>("lire_segment", { segment_id: selection }, ctl.signal)
      .then((d) => {
        setDetail(d);
        setTravail(d.filtre);
        if (d.donnees_simulees) setSimulee(true);
      })
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [selection, rechargeDetail]);

  const choisir = useCallback(
    (id: string | null) => {
      if (id === selection) return setRailOuvert(false);
      setSelection(id);
      setDetail(null);
      setTravail(FILTRE_VIDE);
      setApercu(null);
      setDescente(null);
      setVersionComparee(null);
      setErreur(null);
      setPop(false);
      setRailOuvert(false);
      setVolet((v) => (v?.type === "historique" ? null : v));
      setVue((v) => (v === "priorite" ? "carte" : v));
    },
    [selection],
  );

  const segment = arbre && selection ? (arbre.segments.find((s) => s.id === selection) ?? null) : null;
  const marche = arbre && selection ? marcheDe(arbre, selection) : null;
  const estCible = !!(segment && arbre && !estMarche(segment, arbre));
  const attente = !!selection && !detail;
  const ecritureSegment = !!selection && peutEcrire;

  const heritees = useMemo(() => (detail ? conditionsHeritees(detail.filtre_effectif, detail.filtre) : []), [detail]);
  const propres = apercu ? apercu.filtre : travail;
  const filtreVue = useMemo(() => combiner(propres, heritees), [propres, heritees]);
  const cleVue = JSON.stringify(filtreVue);
  const filtreChiffres = useMemo(() => avecDepartement(filtreVue, descente), [filtreVue, descente]);
  const cleChiffres = JSON.stringify(filtreChiffres);
  const colonnes = detail?.colonnes.length ? detail.colonnes : colonnesLibres;
  // Étape marché (rien de choisi, ou un marché) : toutes les entreprises, d'après le cube. Étape cible : les
  // fiches prospectables, avec tous les filtres.
  const baseMarche = etapeCourante(arbre, selection, false) === "marche";
  const listeKpis = useMemo(() => (baseMarche ? KPIS_MARCHE : kpisDisponibles(index)), [baseMarche, index]);
  const champsVisibles = useMemo(() => (baseMarche ? (champs ?? []).filter((c) => c.marche) : (champs ?? [])), [baseMarche, champs]);
  const [ignoreesMarche, setIgnoreesMarche] = useState<Condition[]>([]);

  // ---------------------------------------------------------------- chiffres clés
  useEffect(() => {
    if (attente || !champs) return;
    const ctl = new AbortController();
    const f = JSON.parse(cleChiffres) as Filtre;
    setKpisBusy(true);
    if (baseMarche) {
      appeler<AnalyseMarche>("analyser_marche", { filtre: f }, ctl.signal)
        .then((r) => {
          setKpis({ ...r.total });
          setIgnoreesMarche(r.conditions_ignorees);
          setErreur(null);
        })
        .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)))
        .finally(() => !ctl.signal.aborted && setKpisBusy(false));
      return () => ctl.abort();
    }
    setIgnoreesMarche([]);
    // Cible : sa part du marché entier (le cube compte le marché parent sur toutes les entreprises).
    const marcheTotal = heritees.length
      ? appeler<AnalyseMarche>("analyser_marche", { filtre: { conditions: heritees } }, ctl.signal).then((r) => r.total.entreprises).catch(() => null)
      : Promise.resolve(null);
    Promise.all(
      listeKpis.map((k) =>
        appeler<ApercuMarche>("explorer_marche", { filtre: k.condition ? avecCondition(f, k.condition) : f, colonnes: ["nom"], page: 1, par_page: 1 }, ctl.signal).then((r) => {
          if (r.donnees_simulees) setSimulee(true);
          return [k.id, r.total] as const;
        }),
      ),
    )
      .then(async (r) => {
        const m = await marcheTotal;
        setKpis({ ...Object.fromEntries(r), ...(m ? { marche: m } : {}) });
        setErreur(null);
      })
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)))
      .finally(() => !ctl.signal.aborted && setKpisBusy(false));
    return () => ctl.abort();
  }, [attente, champs, cleChiffres, listeKpis, rafraichir, baseMarche, heritees]);

  // ---------------------------------------------------------------- écriture
  const ecritureRefusee = useCallback(() => {
    setPeutEcrire(false);
    notifier("Écriture refusée : votre rôle sur cet espace est en lecture seule.", true);
  }, [notifier]);

  const changerFiltre = async (f: Filtre) => {
    setApercu(null);
    const avant = travail;
    setTravail(f);
    if (!selection || !peutEcrire) return;
    try {
      const r = await appeler<{ version: number }>("modifier_segment", { segment_id: selection, filtre: f });
      notifier(`v${r.version} enregistrée`);
      setRechargeDetail((n) => n + 1);
      setRafraichir((n) => n + 1);
      await rechargerArbre();
    } catch (e) {
      setTravail(avant);
      notifier(texteErreur(e), true);
      if (e instanceof ErreurAtlas && e.status === 404) ecritureRefusee();
    }
  };

  const changerColonnes = async (c: string[]) => {
    if (!selection || !detail) return setColonnesLibres(c);
    setDetail({ ...detail, colonnes: c });
    if (!peutEcrire) return;
    try {
      await appeler("modifier_segment", { segment_id: selection, colonnes: c });
    } catch (e) {
      notifier(texteErreur(e), true);
      if (e instanceof ErreurAtlas && e.status === 404) ecritureRefusee();
    }
  };

  const epingler = useCallback(
    async (siren: string, nom: string) => {
      try {
        await appeler("epingler", { siren, nom });
        const l = await chargerEpingles();
        if (l) referenceEpingles.current = new Set(l.map((e) => e.siren));
        flasher(dossierRef.current);
        notifier("Ajoutée au dossier de travail");
      } catch (e) {
        notifier(texteErreur(e), true);
        if (e instanceof ErreurAtlas && e.status === 404) ecritureRefusee();
      }
    },
    [chargerEpingles, ecritureRefusee, notifier],
  );
  const retirer = useCallback(
    async (siren: string) => {
      try {
        await appeler("retirer_epingle", { siren });
        const l = await chargerEpingles();
        if (l) referenceEpingles.current = new Set(l.map((e) => e.siren));
      } catch (e) {
        notifier(texteErreur(e), true);
        if (e instanceof ErreurAtlas && e.status === 404) ecritureRefusee();
      }
    },
    [chargerEpingles, ecritureRefusee, notifier],
  );

  // ---------------------------------------------------------------- présence de l'IA (sonde 15 s)
  const signalerIA = useCallback((ia: string, texte: string) => {
    setActivite({ ia, texte });
    setIas((l) => [{ nom: ia, heure: heure(), etat: "active" as const }, ...l.filter((x) => x.nom !== ia)]);
  }, []);
  useEffect(() => {
    if (!activite) return;
    const t = setTimeout(() => setActivite(null), 6000);
    return () => clearTimeout(t);
  }, [activite]);

  useEffect(() => {
    if (!champs) return;
    let vivant = true;
    const sonder = async () => {
      if (document.hidden) return;
      try {
        const a = await appeler<Arbre>("lister_segments_atlas");
        if (!vivant) return;
        const changes = segmentsChanges(reference.current, a.segments);
        reference.current = a.segments;
        if (changes.length) {
          setArbre(a);
          setPeutEcrire(a.peut_ecrire === true);
        }
        for (const c of changes.slice(0, 3)) {
          const h = await appeler<Historique>("historique_segment", { segment_id: c.id });
          const derniere = c.scoring ? h.scoring[0] : h.filtre[0];
          if (!vivant || !derniere || !estAuteurIA(derniere.auteur)) continue;
          signalerIA(nomAuteur(derniere.auteur), phraseActivite(nomAuteur(derniere.auteur), c));
          setClignote(c.id);
          if (c.id === selectionRef.current) {
            setRechargeDetail((n) => n + 1);
            setRafraichir((n) => n + 1);
            flasher(zoneRef.current);
            flasher(kpisRef.current);
          }
        }
        const l = await appeler<{ epingles: Epingle[] }>("lister_epingles");
        if (!vivant) return;
        const connus = referenceEpingles.current;
        const nouvelles = connus ? l.epingles.filter((e) => !connus.has(e.siren)) : [];
        referenceEpingles.current = new Set(l.epingles.map((e) => e.siren));
        setEpingles(l.epingles);
        const parIA = nouvelles.filter((e) => estAuteurIA(e.auteur));
        if (parIA.length) {
          const ia = nomAuteur(parIA[0].auteur);
          signalerIA(ia, parIA.length > 1 ? `${ia} a ajouté ${parIA.length} entreprises au dossier` : `${ia} a ajouté « ${parIA[0].nom} » au dossier`);
          flasher(dossierRef.current);
        }
      } catch {
        // Sonde silencieuse : la prochaine passe réessaie ; les écrans affichent leurs propres erreurs.
      }
    };
    const t = setInterval(() => void sonder(), SONDE_MS);
    return () => {
      vivant = false;
      clearInterval(t);
    };
  }, [champs, signalerIA]);

  useEffect(() => {
    if (!clignote) return;
    const t = setTimeout(() => setClignote(null), 1500);
    return () => clearTimeout(t);
  }, [clignote]);

  // ---------------------------------------------------------------- menu mobile : clic dehors
  useEffect(() => {
    if (!railOuvert) return;
    const dehors = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest("#atlas-rail") && !t.closest("[data-atlas-menu]")) setRailOuvert(false);
    };
    document.addEventListener("mousedown", dehors);
    return () => document.removeEventListener("mousedown", dehors);
  }, [railOuvert]);

  const fermerPop = useCallback(() => setPop(false), []);
  const fermerVolet = useCallback(() => {
    setVolet(null);
  }, []);
  const fermerCreation = useCallback(() => setCreation(null), []);
  const fermerDialogueIA = useCallback(() => setDialogueIA(false), []);

  // Premier passage : un espace sans marché propose de commencer avec l'IA (recommandé) ou à la main,
  // une fois par navigateur.
  const nbSegments = arbre ? arbre.segments.length : null;
  useEffect(() => {
    let vu = false;
    try {
      vu = localStorage.getItem("atlas.accueil.vu") === "1";
    } catch {
      /* stockage indisponible : on montre l'accueil, sans conséquence */
    }
    if (montrerAccueil(nbSegments, vu)) setAccueil(true);
  }, [nbSegments]);
  const fermerAccueil = useCallback(() => {
    setAccueil(false);
    try {
      localStorage.setItem("atlas.accueil.vu", "1");
    } catch {
      /* idem */
    }
  }, []);
  const ouvrirFiche = useCallback((siren: string, nom: string) => setVolet({ type: "fiche", siren, nom }), []);

  // ---------------------------------------------------------------- rendu
  if (erreurInit) {
    return (
      <div className="atlas">
        <div className="boot" role="alert">
          <div>
            <Icone nom="alerte" />
            <p>{erreurInit.message}</p>
            {erreurInit.status === 401 ? (
              <a className="btn pri" href="/login">
                Se reconnecter
              </a>
            ) : (
              <button type="button" className="btn" onClick={() => setEssaiInit((n) => n + 1)}>
                Réessayer
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (!champs || !arbre) {
    return (
      <div className="atlas">
        <div className="boot">
          <div>
            <div className="logo">
              <i />
              <span>Atlas</span>
            </div>
            <Chargement texte="Ouverture d'Atlas…" />
          </div>
        </div>
      </div>
    );
  }

  const chemin = segment ? cheminDossier(arbre, segment.dossier_id) : [];
  const zone = titreZone(departementsFiltre(filtreVue), DEPARTMENT_NAMES);
  const nbFiltres = propres.conditions.length + (propres.inclure_bloques ? 1 : 0);
  const etape = etapeCourante(arbre, selection, vue === "priorite");
  const vuesPermises = VUES.filter((v) => v.id !== "priorite" || estCible);
  const nbCibles = marche ? ciblesDe(arbre, marche.id).length : 0;
  const versionAffichee = apercu?.version ?? detail?.version ?? segment?.version ?? null;
  const epingle = (siren: string) => !!epingles?.some((e) => e.siren === siren);
  const presenceLive = !!activite;
  const toutesIAs = fusionnerIAs(ias, connexions);
  const derniere = toutesIAs[0];

  const etapes: { id: string; libelle: string; etat: "on" | "done" | ""; action?: () => void; aide?: string }[] = [
    {
      id: "marche",
      libelle: marche ? `Marché · ${marche.nom}` : "Marché",
      etat: etape === "marche" ? "on" : "done",
      action: marche && selection !== marche.id ? () => choisir(marche.id) : undefined,
    },
    {
      id: "cible",
      libelle: estCible && segment ? `Cible · ${segment.nom}` : nbCibles ? `Cibles (${nbCibles})` : "Cible",
      etat: etape === "cible" ? "on" : etape === "priorite" ? "done" : "",
      action:
        etape === "priorite"
          ? () => setVue("carte")
          : marche && !estCible
            ? nbCibles
              ? () => choisir(ciblesDe(arbre, marche.id)[0].segment.id)
              : peutEcrire
                ? () => setCreation({ type: "cible", marche, colonnes })
                : undefined
            : undefined,
      aide: marche && !estCible && !nbCibles ? "Créer une première cible" : undefined,
    },
    { id: "priorite", libelle: detail?.scoring ? `Priorité v${detail.scoring.version}` : "Priorité", etat: etape === "priorite" ? "on" : "", action: estCible ? () => setVue("priorite") : undefined },
    { id: "envoi", libelle: "Envoi · bientôt", etat: "" },
  ];

  return (
    <div className="atlas">
      <Rail
        arbre={arbre}
        erreur={null}
        selection={selection}
        ouvert={railOuvert}
        peutEcrire={peutEcrire}
        ias={toutesIAs}
        onBrancherIA={() => setDialogueIA(true)}
        clignote={clignote}
        onSelection={choisir}
        onCreer={(type, m) => {
          setRailOuvert(false);
          if (type === "dossier") setCreation({ type: "dossier" });
          else if (type === "cible" && m) setCreation({ type: "cible", marche: m, colonnes });
          else setCreation({ type: "marche", filtre: selection ? null : travail, colonnes });
        }}
      />

      <div className="main">
        <header className="top">
          <button type="button" className="x menu" aria-label="Menu des marchés" aria-expanded={railOuvert} aria-controls="atlas-rail" data-atlas-menu onClick={() => setRailOuvert((o) => !o)}>
            <Icone nom="menu" />
          </button>
          <div className="vname">
            {segment ? (
              <>
                <span className="k">{estCible ? "Cible" : "Marché"}</span>
                {estCible && marche ? (
                  <>
                    <span className="hide-s">{marche.nom}</span>
                    <span className="hide-s">/</span>
                  </>
                ) : (
                  chemin.length > 0 && (
                    <>
                      <span className="hide-s">{chemin.join(" › ")}</span>
                      <span className="hide-s">/</span>
                    </>
                  )
                )}
                <b>{segment.nom}</b>
              </>
            ) : (
              <>
                <span>Atlas</span>
                <span>/</span>
                <b>Tout le marché</b>
              </>
            )}
          </div>
          {segment && versionAffichee !== null && (
            <button type="button" className={apercu ? "pill preview" : "pill"} title="Historique des versions" aria-label={`Version ${versionAffichee}${apercu ? ", aperçu" : ""} : ouvrir l'historique`} onClick={() => setVolet({ type: "historique" })}>
              {apercu ? `v${apercu.version} · aperçu` : `v${versionAffichee}`}
            </button>
          )}
          <span className="sp" />
          {presenceLive || derniere ? (
            <div className={presenceLive ? "presence live" : "presence"} role="status" aria-live="polite">
              <span className="av" aria-hidden>
                {initialeAuteur(activite?.ia ?? derniere?.nom ?? "IA")}
              </span>
              <span>
                {activite ? activite.texte : derniere.etat === "active" ? `${derniere.nom} · actif à ${derniere.heure}` : `${derniere.nom} · branchée, dernier échange ${derniere.heure}`}
              </span>
            </div>
          ) : (
            <button type="button" className="presence idle" title="Brancher Claude, ChatGPT ou Cursor" onClick={() => setDialogueIA(true)}>
              <span className="av" aria-hidden>
                +
              </span>
              <span>Brancher une IA</span>
            </button>
          )}
          {segment && <MenuExport segmentId={segment.id} notifier={notifier} />}
          {segment && peutEcrire && (
            <button
              type="button"
              className="btn ghost hide-s"
              title={`Supprimer « ${segment.nom} »`}
              onClick={() => {
                const cibles = arbre ? arbre.segments.filter((s) => s.parent_id === segment.id).length : 0;
                const texte = cibles
                  ? `Supprimer « ${segment.nom} » et ses ${cibles} cible${cibles > 1 ? "s" : ""} ?`
                  : `Supprimer « ${segment.nom} » ?`;
                if (!window.confirm(texte)) return;
                appeler<{ cibles_supprimees: number }>("supprimer_segment", { segment_id: segment.id, avec_cibles: cibles > 0 })
                  .then(async () => {
                    choisir(null);
                    await rechargerArbre();
                    notifier("Supprimé");
                  })
                  .catch((e) => {
                    notifier(texteErreur(e), true);
                    if (e instanceof ErreurAtlas && e.status === 404) ecritureRefusee();
                  });
              }}
            >
              Supprimer
            </button>
          )}
          {segment && !estCible && peutEcrire && marche && (
            <button type="button" className="btn ghost hide-s" onClick={() => setCreation({ type: "cible", marche, colonnes })}>
              <Icone nom="cible" />
              Nouvelle cible
            </button>
          )}
          {!segment && peutEcrire && nbFiltres > 0 && (
            <button type="button" className="btn ghost hide-s" onClick={() => setCreation({ type: "marche", filtre: travail, colonnes })}>
              <Icone nom="plus" />
              Enregistrer comme marché
            </button>
          )}
          <button type="button" className="btn pri" aria-disabled="true" title="Bientôt : la cible classée part vers une liste Notifuse, dans l'ordre de priorité" onClick={(e) => e.preventDefault()}>
            <Icone nom="envoi" />
            <span className="hide-s">Envoyer vers Notifuse</span>
            <span className="sr-only"> (bientôt)</span>
          </button>
        </header>

        <main className="page">
          {simulee && <p className="banner">Données simulées : ces chiffres sont inventés, la base ODH n&apos;est pas branchée sur cet environnement.</p>}
          {selection && !peutEcrire && <p className="banner">Lecture seule : vos changements de filtres ne s&apos;enregistrent pas sur cet espace.</p>}

          <ol className="flux" aria-label="Étapes : marché, cible, priorité, envoi">
            {etapes.map((e, i) => (
              <li key={e.id}>
                {i > 0 && (
                  <span className="chev" aria-hidden>
                    <Icone nom="chev" />
                  </span>
                )}
                {e.action ? (
                  <button type="button" className={e.etat} onClick={e.action} aria-current={e.etat === "on" ? "step" : undefined} title={e.aide}>
                    <span className="b">{i + 1}</span>
                    {e.libelle}
                  </button>
                ) : (
                  <span className={`st ${e.etat}`} aria-current={e.etat === "on" ? "step" : undefined} title={e.id === "envoi" ? "Bientôt" : undefined}>
                    <span className="b">{i + 1}</span>
                    {e.libelle}
                  </span>
                )}
              </li>
            ))}
          </ol>

          <div className="head">
            <div style={{ position: "relative", minWidth: 0 }} ref={zoneRef}>
              <h1 className="geo">
                {descente ? (
                  <>
                    <button type="button" onClick={() => setDescente(null)} aria-label={`Remonter à ${zone}`}>
                      <Icone nom="retour" />
                      {zone}
                    </button>
                    <span className="sep">/</span>
                    <span>{DEPARTMENT_NAMES[descente] ?? descente}</span>
                  </>
                ) : (
                  <span>{zone}</span>
                )}
              </h1>
              <div className="summary">
                <button type="button" className="fbtn" aria-expanded={pop} aria-haspopup="dialog" data-atlas-filtres onClick={() => setPop((o) => !o)} disabled={!!apercu}>
                  <Icone nom="filtre" />
                  Filtres <i>{nbFiltres}</i>
                </button>
                <span>{attente ? "…" : phraseFiltre(propres, index)}</span>
                {heritees.length > 0 && <span className="inh">· hérité de « {marche?.nom ?? "parent"} » : {phraseFiltre({ conditions: heritees }, index)}</span>}
                {apercu && (
                  <button type="button" className="lnk" onClick={() => setApercu(null)}>
                    revenir à la version courante
                  </button>
                )}
                {pop && (
                  <PopoverFiltres
                    champs={champsVisibles}
                    index={index}
                    propres={travail.conditions}
                    heritees={heritees}
                    inclureBloques={!!travail.inclure_bloques}
                    lectureSeule={false}
                    onChange={(f) => void changerFiltre(f)}
                    onFermer={fermerPop}
                  />
                )}
              </div>
            </div>
            <div className="switch" role="tablist" aria-label="Affichage">
              {vuesPermises.map((v) => (
                <button key={v.id} type="button" role="tab" aria-selected={vue === v.id} className={vue === v.id ? "on" : undefined} title={v.libelle} aria-label={v.libelle} onClick={() => setVue(v.id)}>
                  <Icone nom={v.icone} />
                </button>
              ))}
            </div>
          </div>

          <div className={kpisBusy ? "kpis busy" : "kpis"} hidden={vue === "marche"} ref={kpisRef} aria-busy={kpisBusy} aria-live="polite">
            {listeKpis.map((k) => (
              <div className="kpi" key={k.id}>
                <b className="num">{kpis && kpis[k.id] !== undefined ? formaterNombre(kpis[k.id]) : "–"}</b>
                <span>
                  {k.libelle}
                  {k.part && kpis && kpis[k.id] !== undefined ? ` · ${part(kpis[k.id], kpis.entreprises ?? 0)}` : ""}
                </span>
              </div>
            ))}
            {!baseMarche && kpis && kpis.marche !== undefined && kpis.total !== undefined && (
              <div className="kpi">
                <b className="num">{part(kpis.total, kpis.marche)}</b>
                <span>des {formaterNombre(kpis.marche)} entreprises du marché</span>
              </div>
            )}
            {kpis && (kpis.envoyable ?? kpis.email_envoyable ?? kpis.email) !== undefined && (
              <div className="kpi">
                <b className="num">{formaterNombre(joursEnvoi(kpis.envoyable ?? kpis.email_envoyable ?? kpis.email))} j</b>
                <span>d&apos;envoi à 400 par jour</span>
              </div>
            )}
          </div>
          {baseMarche && ignoreesMarche.length > 0 && (
            <p className="hint" hidden={vue === "marche"}>
              Le marché se compte sur toutes les entreprises, par activité, lieu, forme, effectif et création. Non pris en compte ici, à poser sur une
              cible : {ignoreesMarche.map((c) => phraseCondition(c, index)).join(" ; ")}.
            </p>
          )}

          {erreur && (
            <p className="err" role="alert">
              <Icone nom="alerte" />
              <span>{erreur}</span>
              <button type="button" onClick={() => (selection ? setRechargeDetail((n) => n + 1) : setRafraichir((n) => n + 1))}>
                Réessayer
              </button>
            </p>
          )}

          <div className="stage" key={`${vue}-${selection ?? "tout"}`}>
            {attente ? (
              <Chargement />
            ) : vue === "carte" ? (
              <Carte base={baseMarche ? "marche" : "prospection"} filtre={filtreVue} index={index} descente={descente} onDescente={setDescente} onFiche={ouvrirFiche} />
            ) : vue === "marche" ? (
              <VueMarche filtre={filtreChiffres} index={index} />
            ) : vue === "barres" ? (
              <VueBarres filtre={filtreChiffres} champs={champs} index={index} />
            ) : vue === "entonnoir" ? (
              <VueEntonnoir etapes={etapesEntonnoir(propres.conditions, descente ? [...heritees, { champ: "departement", op: "dans", valeur: [descente] }] : heritees, !!propres.inclure_bloques, index)} />
            ) : vue === "tableau" ? (
              <VueTableau filtre={filtreChiffres} colonnes={colonnes} champs={champs} index={index} onColonnes={(c) => void changerColonnes(c)} onFiche={ouvrirFiche} />
            ) : vue === "priorite" && detail && estCible ? (
              <VuePriorite
                segmentId={detail.id}
                scoring={detail.scoring}
                champs={champs}
                index={index}
                peutEcrire={ecritureSegment}
                versionComparee={versionComparee}
                rafraichir={rafraichir}
                onEnregistre={(v) => {
                  notifier(`Priorité v${v} enregistrée`);
                  setVersionComparee(null);
                  setRechargeDetail((n) => n + 1);
                  void rechargerArbre();
                }}
                onEcritureRefusee={ecritureRefusee}
                onFiche={ouvrirFiche}
              />
            ) : (
              <Chargement />
            )}
          </div>
        </main>
      </div>

      <button type="button" className="dossier" ref={dossierRef} onClick={() => setVolet({ type: "dossier" })} aria-label={`Dossier de travail, ${epingles?.length ?? 0} entreprises`}>
        <Icone nom="dossier" />
        Dossier de travail <b>{epingles?.length ?? 0}</b>
      </button>

      {volet?.type === "fiche" && (
        <VoletFiche siren={volet.siren} nom={volet.nom} epingle={epingle(volet.siren)} peutEcrire={peutEcrire} onEpingler={epingler} onRetirer={retirer} onFermer={fermerVolet} />
      )}
      {volet?.type === "dossier" && <VoletDossier epingles={epingles} erreur={erreurEpingles} peutEcrire={peutEcrire} onOuvrir={ouvrirFiche} onRetirer={retirer} onFermer={fermerVolet} />}
      {volet?.type === "historique" && detail && (
        <VoletHistorique
          segmentId={detail.id}
          nom={detail.nom}
          index={index}
          apercu={apercu}
          peutEcrire={peutEcrire}
          versionComparee={versionComparee}
          rafraichir={rafraichir}
          onApercu={setApercu}
          onComparer={(v) => {
            setVersionComparee(v);
            if (estCible) setVue("priorite");
          }}
          onRestaurer={(ancienne, nouvelle) => {
            setApercu(null);
            notifier(`v${ancienne} restaurée en v${nouvelle}`);
            setRechargeDetail((n) => n + 1);
            setRafraichir((n) => n + 1);
            void rechargerArbre();
          }}
          onEcritureRefusee={ecritureRefusee}
          onFermer={fermerVolet}
        />
      )}
      {dialogueIA && <DialogueIA liens={liensIA} pageHub={HUB_IA} onFermer={fermerDialogueIA} />}
      {accueil && !dialogueIA && !creation && (
        <Accueil
          onFermer={fermerAccueil}
          onIA={() => {
            fermerAccueil();
            setDialogueIA(true);
          }}
          onManuel={() => {
            fermerAccueil();
            if (peutEcrire) setCreation({ type: "marche", filtre: null, colonnes: colonnesLibres });
          }}
        />
      )}
      {creation && (
        <DialogueCreation
          creation={creation}
          arbre={arbre}
          onFermer={fermerCreation}
          onEcritureRefusee={ecritureRefusee}
          onCree={(type, id) => {
            setCreation(null);
            void rechargerArbre().then(() => {
              if (type !== "dossier") choisir(id);
            });
            notifier(type === "dossier" ? "Dossier créé" : type === "marche" ? "Marché créé" : "Cible créée");
          }}
        />
      )}

      {activite && (
        <div className="act" role="status">
          <span className="av" aria-hidden>
            {initialeAuteur(activite.ia)}
          </span>
          <span>{activite.texte}</span>
        </div>
      )}
      {toast && (
        <div className={toast.ko ? "toast ko" : "toast"} role={toast.ko ? "alert" : "status"}>
          {toast.texte}
        </div>
      )}
    </div>
  );
}
