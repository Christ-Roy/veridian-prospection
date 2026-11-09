"use client";

import { Compass, Folder, FolderPlus, Layers, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { construireArbre, type NoeudArbre } from "./logique";
import type { Arbre } from "./types";

type Props = {
  arbre: Arbre | null;
  chargement: boolean;
  erreur: string | null;
  selection: string | null;
  onSelection: (id: string | null) => void;
  peutEcrire: boolean;
  onNouveauDossier: () => void;
  onNouveauSegment: () => void;
  /** Rail replié par défaut (desktop) : les libellés apparaissent au survol ou au focus. */
  replie: boolean;
};

const LIBELLE_REPLIE = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

function Ligne({ actif, icone, profondeur, children, onClick, replie, compte }: { actif?: boolean; icone: React.ReactNode; profondeur: number; children: React.ReactNode; onClick?: () => void; replie: boolean; compte?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={actif ? "true" : undefined}
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-foreground/80 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50",
        actif && "bg-muted font-medium text-foreground",
        !onClick && "cursor-default hover:bg-transparent",
      )}
    >
      <span className="shrink-0">{icone}</span>
      <span className={cn("flex min-w-0 flex-1 items-center gap-2", replie && LIBELLE_REPLIE)} style={{ paddingLeft: profondeur * 12 }}>
        <span className="truncate">{children}</span>
        {compte && <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{compte}</span>}
      </span>
    </button>
  );
}

function Noeud({ n, profondeur, selection, onSelection, replie }: { n: NoeudArbre; profondeur: number; selection: string | null; onSelection: (id: string) => void; replie: boolean }) {
  if (n.type === "dossier") {
    return (
      <>
        <Ligne icone={<Folder className="size-4" />} profondeur={profondeur} replie={replie}>
          {n.dossier.nom}
        </Ligne>
        {n.enfants.map((e) => (
          <Noeud key={cle(e)} n={e} profondeur={profondeur + 1} selection={selection} onSelection={onSelection} replie={replie} />
        ))}
      </>
    );
  }
  return (
    <>
      <Ligne actif={selection === n.segment.id} icone={<Layers className="size-4" />} profondeur={profondeur} replie={replie} onClick={() => onSelection(n.segment.id)} compte={`v${n.segment.version}`}>
        {n.segment.nom}
      </Ligne>
      {n.enfants.map((e) => (
        <Noeud key={cle(e)} n={e} profondeur={profondeur + 1} selection={selection} onSelection={onSelection} replie={replie} />
      ))}
    </>
  );
}

const cle = (n: NoeudArbre) => (n.type === "dossier" ? `d${n.dossier.id}` : `s${n.segment.id}`);

export function ContenuRail({ arbre, chargement, erreur, selection, onSelection, peutEcrire, onNouveauDossier, onNouveauSegment, replie }: Props) {
  const noeuds = arbre ? construireArbre(arbre) : [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-2">
      <div className="flex h-9 items-center gap-2.5 px-2 font-semibold">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <Compass className="size-3.5" />
        </span>
        <span className={cn(replie && LIBELLE_REPLIE)}>Atlas</span>
      </div>
      <Ligne actif={selection === null} icone={<Compass className="size-4" />} profondeur={0} replie={replie} onClick={() => onSelection(null)}>
        Explorer le marché
      </Ligne>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
        <p className={cn("h-5 px-2.5 text-[11.5px] text-muted-foreground", replie && LIBELLE_REPLIE)}>Dossiers et segments</p>
        {chargement && (
          <span className="flex items-center gap-2 px-2.5 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className={cn(replie && LIBELLE_REPLIE)}>Chargement…</span>
          </span>
        )}
        {erreur && !chargement && (
          <p role="alert" className={cn("px-2.5 text-xs text-destructive", replie && LIBELLE_REPLIE)}>
            {erreur}
          </p>
        )}
        {arbre && noeuds.length === 0 && <p className={cn("px-2.5 text-xs text-muted-foreground", replie && LIBELLE_REPLIE)}>Aucun segment pour l&apos;instant.</p>}
        {noeuds.map((n) => (
          <Noeud key={cle(n)} n={n} profondeur={0} selection={selection} onSelection={onSelection} replie={replie} />
        ))}
      </div>
      {peutEcrire && (
        <div className="flex flex-col gap-0.5 border-t pt-2">
          <Ligne icone={<Plus className="size-4" />} profondeur={0} replie={replie} onClick={onNouveauSegment}>
            Nouveau segment
          </Ligne>
          <Ligne icone={<FolderPlus className="size-4" />} profondeur={0} replie={replie} onClick={onNouveauDossier}>
            Nouveau dossier
          </Ligne>
        </div>
      )}
    </div>
  );
}
