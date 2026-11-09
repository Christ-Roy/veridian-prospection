"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { appeler, ErreurAtlas, texteErreur } from "./api";
import type { Arbre, Filtre } from "./types";

const AUCUN = "__aucun";

function Choix({ id, label, valeur, onChange, options }: { id: string; label: string; valeur: string; onChange: (v: string) => void; options: { id: string; nom: string }[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label} (facultatif)</Label>
      <Select value={valeur} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUCUN}>Aucun</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.nom}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type Commun = { ouvert: boolean; onFermer: () => void; arbre: Arbre; onCree: (id: string | null) => void; onEcriture404: () => void };

function useEnvoi(onEcriture404: () => void) {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const lancer = async (f: () => Promise<void>) => {
    setEnvoi(true);
    setErreur(null);
    try {
      await f();
    } catch (e) {
      setErreur(texteErreur(e));
      if (e instanceof ErreurAtlas && e.status === 404) onEcriture404();
    } finally {
      setEnvoi(false);
    }
  };
  return { envoi, erreur, lancer, setErreur };
}

export function DialogueDossier({ ouvert, onFermer, arbre, onCree, onEcriture404 }: Commun) {
  const [nom, setNom] = useState("");
  const [parent, setParent] = useState(AUCUN);
  const { envoi, erreur, lancer, setErreur } = useEnvoi(onEcriture404);
  useEffect(() => {
    if (ouvert) {
      setNom("");
      setParent(AUCUN);
      setErreur(null);
    }
  }, [ouvert, setErreur]);

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void lancer(async () => {
              await appeler("creer_dossier", { nom: nom.trim(), ...(parent !== AUCUN ? { parent_id: parent } : {}) });
              onCree(null);
              onFermer();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Nouveau dossier</DialogTitle>
            <DialogDescription>Pour ranger des segments (ex. « Analyse marché »).</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="atlas-dossier-nom">Nom</Label>
            <Input id="atlas-dossier-nom" value={nom} maxLength={120} onChange={(e) => setNom(e.target.value)} autoFocus required />
          </div>
          <Choix id="atlas-dossier-parent" label="Dossier parent" valeur={parent} onChange={setParent} options={arbre.dossiers} />
          {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
          <DialogFooter>
            <Button type="submit" disabled={envoi || !nom.trim()}>
              {envoi && <Loader2 className="animate-spin" />} Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DialogueSegment({
  ouvert,
  onFermer,
  arbre,
  onCree,
  onEcriture404,
  filtreCourant,
  colonnes,
  dossierInitial,
}: Commun & { filtreCourant: Filtre; colonnes: string[]; dossierInitial: string | null }) {
  const [nom, setNom] = useState("");
  const [dossier, setDossier] = useState(AUCUN);
  const [parent, setParent] = useState(AUCUN);
  const [garder, setGarder] = useState(true);
  const { envoi, erreur, lancer, setErreur } = useEnvoi(onEcriture404);
  const aFiltre = filtreCourant.conditions.length > 0;
  useEffect(() => {
    if (ouvert) {
      setNom("");
      setDossier(dossierInitial ?? AUCUN);
      setParent(AUCUN);
      setGarder(true);
      setErreur(null);
    }
  }, [ouvert, dossierInitial, setErreur]);

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void lancer(async () => {
              const r = await appeler<{ id: string }>("creer_segment", {
                nom: nom.trim(),
                filtre: garder && aFiltre ? filtreCourant : { conditions: [] },
                colonnes,
                ...(dossier !== AUCUN ? { dossier_id: dossier } : {}),
                ...(parent !== AUCUN ? { parent_id: parent } : {}),
              });
              onCree(r.id);
              onFermer();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Nouveau segment</DialogTitle>
            <DialogDescription>Un segment est un filtre versionné. Un segment enfant ajoute ses conditions à celles de son parent.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="atlas-segment-nom">Nom</Label>
            <Input id="atlas-segment-nom" value={nom} maxLength={120} onChange={(e) => setNom(e.target.value)} autoFocus required />
          </div>
          <Choix id="atlas-segment-dossier" label="Dossier" valeur={dossier} onChange={setDossier} options={arbre.dossiers} />
          <Choix id="atlas-segment-parent" label="Segment parent" valeur={parent} onChange={setParent} options={arbre.segments} />
          {aFiltre && (
            <div className="flex items-center gap-2">
              <Checkbox id="atlas-segment-garder" checked={garder} onCheckedChange={(v) => setGarder(v === true)} />
              <Label htmlFor="atlas-segment-garder" className="font-normal">
                Partir des filtres en cours ({filtreCourant.conditions.length})
              </Label>
            </div>
          )}
          {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
          <DialogFooter>
            <Button type="submit" disabled={envoi || !nom.trim()}>
              {envoi && <Loader2 className="animate-spin" />} Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
