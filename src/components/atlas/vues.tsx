"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { FranceMap } from "@/components/dashboard/france-map";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { colonnesAffichees, formaterCellule, formaterNombre, largeurBarre, libelleColonne } from "./logique";
import type { ApercuMarche, ChampInfo } from "./types";

export function VueTableau({
  apercu,
  index,
  page,
  parPage,
  paginable,
  onPage,
  chargement,
}: {
  apercu: ApercuMarche;
  index: ReadonlyMap<string, ChampInfo>;
  page: number;
  parPage: number;
  paginable: boolean;
  onPage: (p: number) => void;
  chargement: boolean;
}) {
  const cols = colonnesAffichees(apercu.colonnes, apercu.lignes);
  const pages = Math.max(1, Math.ceil(apercu.total / parPage));
  const debut = apercu.lignes.length ? (page - 1) * parPage + 1 : 0;
  return (
    <div className={chargement ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={chargement}>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c} className={c === "score" ? "text-right" : undefined}>
                  {libelleColonne(c, index)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {apercu.lignes.length === 0 && (
              <TableRow>
                <TableCell colSpan={cols.length} className="h-24 text-center text-muted-foreground">
                  Aucune entreprise ne répond à ces filtres.
                </TableCell>
              </TableRow>
            )}
            {apercu.lignes.map((l, i) => (
              <TableRow key={`${String(l.siren ?? i)}-${i}`}>
                {cols.map((c) => (
                  <TableCell key={c} className={c === "score" || typeof l[c] === "number" ? "text-right tabular-nums" : "max-w-64 truncate"}>
                    {formaterCellule(l[c], index.get(c))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
        {paginable ? (
          <>
            <span className="tabular-nums">
              {formaterNombre(debut)} à {formaterNombre(debut + apercu.lignes.length - (apercu.lignes.length ? 1 : 0))} sur {formaterNombre(apercu.total)}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Page précédente" disabled={page <= 1 || chargement} onClick={() => onPage(page - 1)}>
                <ChevronLeft />
              </Button>
              <span className="px-2 tabular-nums">
                {page} / {formaterNombre(pages)}
              </span>
              <Button variant="outline" size="icon-sm" aria-label="Page suivante" disabled={page >= pages || chargement} onClick={() => onPage(page + 1)}>
                <ChevronRight />
              </Button>
            </div>
          </>
        ) : (
          <span>Aperçu des {apercu.lignes.length} premières lignes sur {formaterNombre(apercu.total)}. Enregistrez un segment pour parcourir toutes les pages.</span>
        )}
      </div>
    </div>
  );
}

export function VueCarte({ valeurs, selection, onSelect }: { valeurs: { cle: string; nombre: number }[]; selection: string[]; onSelect: (codes: string[]) => void }) {
  const counts = useMemo(() => Object.fromEntries(valeurs.map((v) => [v.cle, v.nombre])), [valeurs]);
  const top = valeurs.slice(0, 8);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
      <FranceMap selected={selection} onSelect={onSelect} counts={counts} />
      <aside className="flex flex-col gap-2 text-sm" aria-label="Départements les plus fournis">
        <h3 className="text-xs font-medium text-muted-foreground">Les plus fournis</h3>
        {top.length === 0 && <p className="text-muted-foreground">Aucune donnée.</p>}
        {top.map((v) => (
          <button
            key={v.cle}
            type="button"
            onClick={() => onSelect(selection.includes(v.cle) ? selection.filter((c) => c !== v.cle) : [...selection, v.cle])}
            className="flex justify-between gap-2 border-b py-1 text-left last:border-0 hover:underline focus-visible:outline-2"
          >
            <span>{v.cle}</span>
            <span className="tabular-nums text-muted-foreground">{formaterNombre(v.nombre)}</span>
          </button>
        ))}
        <p className="text-xs text-muted-foreground">Cliquez un département pour l&apos;ajouter aux filtres.</p>
      </aside>
    </div>
  );
}

export function VueRepartition({
  champs,
  champ,
  onChamp,
  valeurs,
  chargement,
}: {
  champs: ChampInfo[];
  champ: string;
  onChamp: (id: string) => void;
  valeurs: { cle: string; nombre: number }[];
  chargement: boolean;
}) {
  const max = Math.max(0, ...valeurs.map((v) => v.nombre));
  return (
    <div className="flex flex-col gap-4" aria-busy={chargement}>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Répartition par</span>
        <Select value={champ} onValueChange={onChamp}>
          <SelectTrigger size="sm" aria-label="Champ de répartition">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {champs.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.libelle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ul className={`flex max-w-3xl flex-col gap-2 ${chargement ? "opacity-60" : ""}`}>
        {valeurs.length === 0 && !chargement && <li className="text-sm text-muted-foreground">Aucune valeur.</li>}
        {valeurs.map((v) => (
          <li key={v.cle} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5rem]">
            <span className="truncate" title={v.cle}>
              {v.cle}
            </span>
            <span className="h-5 overflow-hidden rounded bg-muted" role="img" aria-label={`${v.cle} : ${formaterNombre(v.nombre)}`}>
              <span className="block h-full bg-primary/80" style={{ width: `${largeurBarre(v.nombre, max)}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted-foreground">{formaterNombre(v.nombre)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
