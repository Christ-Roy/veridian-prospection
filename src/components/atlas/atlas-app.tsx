"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Filter, History, Loader2, Menu, Save, SlidersHorizontal, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { appeler, ErreurAtlas, estAnnulation, texteErreur } from "./api";
import { DialogueDossier, DialogueSegment } from "./dialogues";
import { ContenuRail } from "./rail";
import { SelecteurColonnes } from "./selecteur-colonnes";
import { VoletFiltres, VoletHistorique, VoletScoring } from "./volets";
import { VueCarte, VueRepartition, VueTableau } from "./vues";
import { CHAMP_DEPARTEMENT, cheminDossier, combiner, conditionsHeritees, definirDepartements, departementsDuFiltre, filtresEgaux, formaterNombre, indexerChamps, phraseFiltre, sansConditionsDans } from "./logique";
import type { ApercuMarche, Arbre, ChampInfo, Filtre, RepartitionMarche, SegmentDetail, Vue } from "./types";

const PAR_PAGE = 20;
const COLONNES_LIBRES = ["nom", "commune", "departement", "naf", "taille", "site"];
const FILTRE_VIDE: Filtre = { conditions: [] };

export function AtlasApp() {
  const [champs, setChamps] = useState<ChampInfo[] | null>(null);
  const [arbre, setArbre] = useState<Arbre | null>(null);
  const [erreurInit, setErreurInit] = useState<{ message: string; status: number } | null>(null);
  const [ecriture, setEcriture] = useState(false);
  const [initCompteur, setInitCompteur] = useState(0);

  const [selection, setSelection] = useState<string | null>(null);
  const [detail, setDetail] = useState<SegmentDetail | null>(null);
  const [rechargeDetail, setRechargeDetail] = useState(0);
  const [travail, setTravail] = useState<Filtre>(FILTRE_VIDE);
  const [colonnes, setColonnes] = useState<string[]>(COLONNES_LIBRES);
  const [vue, setVue] = useState<Vue>("tableau");
  const [page, setPage] = useState(1);
  const [champRep, setChampRep] = useState("naf_division");
  const [scoringVersion, setScoringVersion] = useState<number | null>(null);

  const [apercu, setApercu] = useState<ApercuMarche | null>(null);
  const [rep, setRep] = useState<RepartitionMarche | null>(null);
  const [chargement, setChargement] = useState(false);
  const [chargementRep, setChargementRep] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [simulee, setSimulee] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);

  const [filtresOuvert, setFiltresOuvert] = useState(false);
  const [scoringOuvert, setScoringOuvert] = useState(false);
  const [histoOuvert, setHistoOuvert] = useState(false);
  const [dossierOuvert, setDossierOuvert] = useState(false);
  const [segmentOuvert, setSegmentOuvert] = useState(false);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [versionsCompteur, setVersionsCompteur] = useState(0);

  const index = useMemo(() => indexerChamps(champs ?? []), [champs]);
  const champsRepartition = useMemo(() => (champs ?? []).filter((c) => c.repartition), [champs]);

  // ---- chargement initial : catalogue, arbre, droit d'écriture
  useEffect(() => {
    const ctl = new AbortController();
    Promise.all([
      appeler<{ champs: ChampInfo[] }>("lister_champs", {}, ctl.signal),
      appeler<Arbre>("lister_segments_atlas", {}, ctl.signal),
    ])
      .then(([c, a]) => {
        setChamps(c.champs);
        setArbre(a);
        setEcriture(a.peut_ecrire === true);
        setErreurInit(null);
      })
      .catch((e) => !estAnnulation(e) && setErreurInit({ message: texteErreur(e), status: e instanceof ErreurAtlas ? e.status : 0 }));
    return () => ctl.abort();
  }, [initCompteur]);

  const rechargerArbre = useCallback(async () => {
    try {
      setArbre(await appeler<Arbre>("lister_segments_atlas"));
    } catch (e) {
      setErreur(texteErreur(e));
    }
  }, []);

  // ---- segment sélectionné
  useEffect(() => {
    if (!selection) return;
    const ctl = new AbortController();
    appeler<SegmentDetail>("lire_segment", { segment_id: selection }, ctl.signal)
      .then((d) => {
        setDetail(d);
        setTravail(d.filtre);
        setColonnes(d.colonnes.length ? d.colonnes : COLONNES_LIBRES);
        if (d.donnees_simulees) setSimulee(true);
      })
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [selection, rechargeDetail]);

  const choisir = (id: string | null) => {
    setSelection(id);
    setDetail(null);
    setApercu(null);
    setErreur(null);
    setPage(1);
    setScoringVersion(null);
    setTravail(FILTRE_VIDE);
    setColonnes(COLONNES_LIBRES);
    setMenuOuvert(false);
  };

  const heritees = useMemo(() => (detail ? conditionsHeritees(detail.filtre_effectif, detail.filtre) : []), [detail]);
  const filtreComplet = useMemo(() => combiner(travail, heritees), [travail, heritees]);
  const cleFiltre = JSON.stringify(filtreComplet);
  const modifie = !!detail && !filtresEgaux(travail, detail.filtre);
  const classer = !!detail && !modifie;
  const attente = !!selection && !detail;

  const changerFiltre = (f: Filtre) => {
    setTravail(f);
    setPage(1);
  };

  // ---- tableau (et total)
  const versionDetail = detail?.version;
  const versionScoring = detail?.scoring?.version;
  useEffect(() => {
    if (attente) return;
    const ctl = new AbortController();
    const filtre = JSON.parse(cleFiltre) as Filtre;
    setChargement(true);
    setErreur(null);
    const req = classer
      ? appeler<ApercuMarche>("classer_segment", { segment_id: selection, page, par_page: PAR_PAGE, ...(scoringVersion ? { scoring_version: scoringVersion } : {}) }, ctl.signal)
      : appeler<ApercuMarche>("explorer_marche", { filtre, colonnes, page, par_page: PAR_PAGE }, ctl.signal);
    req
      .then((r) => {
        setApercu(r);
        if (r.donnees_simulees) setSimulee(true);
      })
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)))
      .finally(() => !ctl.signal.aborted && setChargement(false));
    return () => ctl.abort();
  }, [attente, classer, selection, cleFiltre, colonnes, page, scoringVersion, versionDetail, versionScoring]);

  // ---- carte et répartition
  const champVue = vue === "carte" ? CHAMP_DEPARTEMENT : champRep;
  useEffect(() => {
    if (attente || vue === "tableau") return;
    const ctl = new AbortController();
    const brut = JSON.parse(cleFiltre) as Filtre;
    const filtre = vue === "carte" ? sansConditionsDans(brut, CHAMP_DEPARTEMENT) : brut;
    setChargementRep(true);
    appeler<RepartitionMarche>("repartir_marche", { filtre, champ: champVue, limite: vue === "carte" ? 120 : 30 }, ctl.signal)
      .then((r) => {
        setRep(r);
        if (r.donnees_simulees) setSimulee(true);
      })
      .catch((e) => !estAnnulation(e) && setErreur(texteErreur(e)))
      .finally(() => !ctl.signal.aborted && setChargementRep(false));
    return () => ctl.abort();
  }, [attente, vue, champVue, cleFiltre]);

  // ---- actions d'écriture
  const ecritureRefusee = () => setEcriture(false);

  const changerColonnes = async (c: string[]) => {
    if (c.length === 0) return;
    if (selection && ecriture) {
      try {
        await appeler("modifier_segment", { segment_id: selection, colonnes: c });
        setColonnes(c);
        setDetail((d) => (d ? { ...d, colonnes: c } : d));
      } catch (e) {
        setErreur(texteErreur(e));
        if (e instanceof ErreurAtlas && e.status === 404) ecritureRefusee();
      }
    } else setColonnes(c);
  };

  const enregistrerVersion = async () => {
    if (!selection) return;
    setEnregistrement(true);
    try {
      await appeler("modifier_segment", { segment_id: selection, filtre: travail });
      setRechargeDetail((n) => n + 1);
      setVersionsCompteur((n) => n + 1);
      await rechargerArbre();
    } catch (e) {
      setErreur(texteErreur(e));
      if (e instanceof ErreurAtlas && e.status === 404) ecritureRefusee();
    } finally {
      setEnregistrement(false);
    }
  };

  const apresCreation = async (id: string | null) => {
    await rechargerArbre();
    if (id) choisir(id);
  };

  // ---- rendu
  if (erreurInit) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center" role="alert">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="text-sm">{erreurInit.message}</p>
        {erreurInit.status === 401 ? (
          <Button asChild>
            <a href="/login">Se reconnecter</a>
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setInitCompteur((n) => n + 1)}>
            Réessayer
          </Button>
        )}
      </div>
    );
  }

  const propsRail = {
    arbre,
    chargement: !arbre,
    erreur: null,
    selection,
    onSelection: choisir,
    peutEcrire: ecriture,
    onNouveauDossier: () => setDossierOuvert(true),
    onNouveauSegment: () => setSegmentOuvert(true),
  };

  const segmentArbre = arbre?.segments.find((s) => s.id === selection);
  const chemin = arbre && segmentArbre ? cheminDossier(arbre, segmentArbre.dossier_id) : [];
  const nbConditions = travail.conditions.length + (travail.inclure_bloques ? 1 : 0);
  const total = apercu?.total;

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] bg-white">
      {/* Rail : replié en icônes, s'ouvre au survol ; sous 720 px, un menu */}
      <div className="relative hidden w-14 shrink-0 min-[720px]:block">
        <nav aria-label="Dossiers et segments" className="group absolute inset-y-0 left-0 z-20 w-14 overflow-hidden border-r bg-neutral-50 transition-[width,box-shadow] duration-200 focus-within:w-64 focus-within:shadow-xl hover:w-64 hover:shadow-xl">
          <div className="w-64 h-full">
            <ContenuRail {...propsRail} replie />
          </div>
        </nav>
      </div>
      <Sheet open={menuOuvert} onOpenChange={setMenuOuvert}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Dossiers et segments</SheetTitle>
          <SheetDescription className="sr-only">Choisir un segment ou explorer le marché</SheetDescription>
          <ContenuRail {...propsRail} replie={false} />
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-5 min-[720px]:px-7" aria-label="Atlas">
        {simulee && (
          <p role="status" className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
            Données simulées : ces chiffres sont inventés, la vraie base n&apos;est pas branchée.
          </p>
        )}

        <header className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Button variant="outline" size="icon-sm" className="min-[720px]:hidden" aria-label="Ouvrir les dossiers et segments" onClick={() => setMenuOuvert(true)}>
              <Menu />
            </Button>
            <div className="min-w-0 flex-1">
              {chemin.length > 0 && <p className="truncate text-xs text-muted-foreground">{chemin.join(" › ")}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{selection ? (detail?.nom ?? segmentArbre?.nom ?? "Segment") : "Explorer le marché"}</h1>
                {detail && (
                  <button
                    type="button"
                    onClick={() => setHistoOuvert(true)}
                    className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-xs hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    aria-label={`Version ${detail.version}, ouvrir l'historique`}
                  >
                    <History className="size-3" />v{detail.version}
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="text-xl font-semibold tabular-nums text-foreground">{total === undefined ? "…" : formaterNombre(total)}</span> entreprises
                {classer && detail?.scoring ? ` · scoring v${scoringVersion ?? detail.scoring.version}` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setFiltresOuvert(true)}>
              <Filter /> Filtres
              {nbConditions > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px]">{nbConditions}</span>}
            </Button>
            <p className="min-w-0 flex-1 text-sm text-muted-foreground" title={phraseFiltre(filtreComplet, index)}>
              {phraseFiltre(travail, index)}
              {heritees.length > 0 && <span> · hérité du segment parent : {phraseFiltre({ conditions: heritees }, index)}</span>}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={vue} onValueChange={(v) => setVue(v as Vue)}>
              <TabsList>
                <TabsTrigger value="tableau">Tableau</TabsTrigger>
                <TabsTrigger value="carte">Carte</TabsTrigger>
                <TabsTrigger value="repartition">Répartition</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {vue === "tableau" && champs && <SelecteurColonnes champs={champs} colonnes={colonnes} onChange={changerColonnes} />}
              {selection && ecriture && detail && (
                <Button variant="outline" size="sm" onClick={() => setScoringOuvert(true)}>
                  <SlidersHorizontal /> Scoring
                </Button>
              )}
              {modifie && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => detail && changerFiltre(detail.filtre)}>
                    <Undo2 /> Annuler
                  </Button>
                  {ecriture && (
                    <Button size="sm" onClick={enregistrerVersion} disabled={enregistrement}>
                      {enregistrement ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer une version
                    </Button>
                  )}
                </>
              )}
              {!selection && ecriture && nbConditions > 0 && (
                <Button size="sm" onClick={() => setSegmentOuvert(true)}>
                  <Save /> Enregistrer comme segment
                </Button>
              )}
            </div>
          </div>
        </header>

        {erreur && (
          <p role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" /> {erreur}
          </p>
        )}

        <div className="min-h-80">
          {(attente || (!apercu && chargement)) && !erreur && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Chargement…
            </p>
          )}
          {vue === "tableau" && apercu && !attente && (
            <VueTableau apercu={apercu} index={index} page={page} parPage={PAR_PAGE} paginable onPage={setPage} chargement={chargement} />
          )}
          {vue === "carte" && !attente && (
            <div aria-busy={chargementRep}>
              <VueCarte valeurs={rep?.champ === CHAMP_DEPARTEMENT ? rep.valeurs : []} selection={departementsDuFiltre(travail)} onSelect={(codes) => changerFiltre(definirDepartements(travail, codes))} />
            </div>
          )}
          {vue === "repartition" && !attente && champsRepartition.length > 0 && (
            <VueRepartition champs={champsRepartition} champ={champRep} onChamp={setChampRep} valeurs={rep?.champ === champRep ? rep.valeurs : []} chargement={chargementRep} />
          )}
        </div>
      </section>

      {champs && (
        <>
          <VoletFiltres champs={champs} index={index} ouvert={filtresOuvert} onFermer={() => setFiltresOuvert(false)} filtre={travail} onAppliquer={changerFiltre} />
          {detail && (
            <>
              <VoletScoring
                champs={champs}
                index={index}
                ouvert={scoringOuvert}
                onFermer={() => setScoringOuvert(false)}
                segmentId={detail.id}
                criteres={detail.scoring?.criteres ?? []}
                onEnregistre={() => {
                  setRechargeDetail((n) => n + 1);
                  setVersionsCompteur((n) => n + 1);
                  void rechargerArbre();
                }}
                onEcriture404={ecritureRefusee}
              />
              <VoletHistorique
                index={index}
                ouvert={histoOuvert}
                onFermer={() => setHistoOuvert(false)}
                segmentId={detail.id}
                versionCourante={detail.version}
                peutEcrire={ecriture}
                version_scoring={scoringVersion}
                onVersionScoring={(v) => {
                  setScoringVersion(v);
                  setPage(1);
                }}
                onRestaure={() => {
                  setRechargeDetail((n) => n + 1);
                  setVersionsCompteur((n) => n + 1);
                  void rechargerArbre();
                }}
                rafraichir={versionsCompteur}
              />
            </>
          )}
        </>
      )}
      {arbre && (
        <>
          <DialogueDossier ouvert={dossierOuvert} onFermer={() => setDossierOuvert(false)} arbre={arbre} onCree={apresCreation} onEcriture404={ecritureRefusee} />
          <DialogueSegment
            ouvert={segmentOuvert}
            onFermer={() => setSegmentOuvert(false)}
            arbre={arbre}
            onCree={apresCreation}
            onEcriture404={ecritureRefusee}
            filtreCourant={selection ? FILTRE_VIDE : travail}
            colonnes={colonnes}
            dossierInitial={segmentArbre?.dossier_id ?? null}
          />
        </>
      )}
    </div>
  );
}
