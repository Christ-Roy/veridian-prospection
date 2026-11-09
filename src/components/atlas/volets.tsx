"use client";

import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { appeler, ErreurAtlas, texteErreur } from "./api";
import { EditeurConditions } from "./editeur-conditions";
import { lignesDepuis, validerConditions, validerCriteres, type LigneEditeur } from "./lignes";
import { phraseFiltre } from "./logique";
import type { ChampInfo, Critere, Filtre, Historique } from "./types";

type Base = { champs: ChampInfo[]; index: ReadonlyMap<string, ChampInfo>; ouvert: boolean; onFermer: () => void };

function Erreurs({ erreurs }: { erreurs: string[] }) {
  if (!erreurs.length) return null;
  return (
    <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
      {erreurs.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

export function VoletFiltres({ champs, index, ouvert, onFermer, filtre, onAppliquer }: Base & { filtre: Filtre; onAppliquer: (f: Filtre) => void }) {
  const [lignes, setLignes] = useState<LigneEditeur[]>([]);
  const [bloques, setBloques] = useState(false);
  const [erreurs, setErreurs] = useState<string[]>([]);
  useEffect(() => {
    if (ouvert) {
      setLignes(lignesDepuis(filtre.conditions));
      setBloques(!!filtre.inclure_bloques);
      setErreurs([]);
    }
  }, [ouvert, filtre]);

  const appliquer = () => {
    const r = validerConditions(lignes, index);
    if (!r.ok) return setErreurs(r.erreurs);
    onAppliquer({ conditions: r.valeur, inclure_bloques: bloques });
    onFermer();
  };

  return (
    <Sheet open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Filtres</SheetTitle>
          <SheetDescription>Toutes les conditions doivent être vraies. La donnée est affichée telle qu&apos;elle est.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <EditeurConditions champs={champs} index={index} lignes={lignes} onChange={setLignes} />
          <div className="flex items-center gap-2">
            <Checkbox id="atlas-bloques" checked={bloques} onCheckedChange={(v) => setBloques(v === true)} />
            <Label htmlFor="atlas-bloques" className="text-sm font-normal">
              Inclure les entreprises bloquées par ODH (cessées, sans contact…)
            </Label>
          </div>
          <Erreurs erreurs={erreurs} />
        </div>
        <SheetFooter className="flex-row justify-between">
          <Button variant="ghost" onClick={() => { setLignes([]); setBloques(false); }}>
            Tout effacer
          </Button>
          <Button onClick={appliquer}>Appliquer</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function VoletScoring({
  champs,
  index,
  ouvert,
  onFermer,
  segmentId,
  criteres,
  onEnregistre,
  onEcriture404,
}: Base & { segmentId: string; criteres: Critere[]; onEnregistre: () => void; onEcriture404: () => void }) {
  const [lignes, setLignes] = useState<LigneEditeur[]>([]);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    if (ouvert) {
      setLignes(lignesDepuis(criteres));
      setErreurs([]);
    }
  }, [ouvert, criteres]);

  const total = lignes.reduce((a, l) => a + (Number(l.poids.replace(",", ".")) || 0), 0);

  const enregistrer = async () => {
    const r = validerCriteres(lignes, index);
    if (!r.ok) return setErreurs(r.erreurs);
    setEnvoi(true);
    try {
      await appeler("definir_scoring", { segment_id: segmentId, scoring: { criteres: r.valeur } });
      onEnregistre();
      onFermer();
    } catch (e) {
      setErreurs([texteErreur(e)]);
      if (e instanceof ErreurAtlas && e.status === 404) onEcriture404();
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Sheet open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Scoring du segment</SheetTitle>
          <SheetDescription>Le score vaut la somme des poids des critères vrais, ramenée sur 100. Chaque enregistrement crée une version.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <EditeurConditions champs={champs} index={index} lignes={lignes} onChange={setLignes} avecPoids />
          {lignes.length > 0 && <p className="text-xs text-muted-foreground">Somme des poids : {Math.round(total * 10) / 10}</p>}
          <Erreurs erreurs={erreurs} />
        </div>
        <SheetFooter>
          <Button onClick={enregistrer} disabled={envoi}>
            {envoi && <Loader2 className="animate-spin" />}
            Enregistrer le scoring
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const dateFr = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const auteurLisible = (via: string) => (via === "mcp" ? "IA (MCP)" : "Interface");

export function VoletHistorique({
  index,
  ouvert,
  onFermer,
  segmentId,
  versionCourante,
  peutEcrire,
  version_scoring,
  onVersionScoring,
  onRestaure,
  rafraichir,
}: Omit<Base, "champs"> & {
  segmentId: string;
  versionCourante: number;
  peutEcrire: boolean;
  version_scoring: number | null;
  onVersionScoring: (v: number | null) => void;
  onRestaure: () => void;
  rafraichir: number;
}) {
  const [h, setH] = useState<Historique | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<number | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    const ctl = new AbortController();
    setH(null);
    setErreur(null);
    appeler<Historique>("historique_segment", { segment_id: segmentId }, ctl.signal)
      .then(setH)
      .catch((e) => !ctl.signal.aborted && setErreur(texteErreur(e)));
    return () => ctl.abort();
  }, [ouvert, segmentId, rafraichir]);

  const restaurer = async (v: number) => {
    setOccupe(v);
    try {
      await appeler("restaurer_version_segment", { segment_id: segmentId, version: v });
      onRestaure();
    } catch (e) {
      setErreur(texteErreur(e));
    } finally {
      setOccupe(null);
    }
  };

  return (
    <Sheet open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="size-4" /> Historique
          </SheetTitle>
          <SheetDescription>Rien n&apos;est jamais effacé : restaurer crée une nouvelle version identique.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
          {!h && !erreur && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Chargement…</p>}
          {h && (
            <>
              <section aria-label="Versions du filtre" className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Filtre</h3>
                {h.filtre.map((v) => (
                  <div key={v.version} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">
                        v{v.version}
                        {v.version === versionCourante && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px]">courante</span>}
                      </span>
                      {peutEcrire && v.version !== versionCourante && (
                        <Button size="xs" variant="outline" disabled={occupe !== null} onClick={() => restaurer(v.version)}>
                          {occupe === v.version ? <Loader2 className="animate-spin" /> : <RotateCcw />} Restaurer
                        </Button>
                      )}
                    </div>
                    <p className="mt-1">{phraseFiltre(v.filtre, index)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {auteurLisible(v.via)} · {dateFr(v.date)}
                      {v.note ? ` · ${v.note}` : ""}
                    </p>
                  </div>
                ))}
              </section>
              <section aria-label="Versions du scoring" className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Scoring</h3>
                {h.scoring.length === 0 && <p className="text-sm text-muted-foreground">Aucun scoring défini.</p>}
                {h.scoring.map((v) => (
                  <div key={v.version} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">v{v.version}</span>
                      <Button size="xs" variant={version_scoring === v.version ? "default" : "outline"} onClick={() => onVersionScoring(version_scoring === v.version ? null : v.version)}>
                        {version_scoring === v.version ? "Comparée" : "Voir le classement"}
                      </Button>
                    </div>
                    <p className="mt-1">{v.criteres.map((c) => `${index.get(c.champ)?.libelle ?? c.champ} (${c.poids})`).join(", ")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {auteurLisible(v.via)} · {dateFr(v.date)}
                      {v.note ? ` · ${v.note}` : ""}
                    </p>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
