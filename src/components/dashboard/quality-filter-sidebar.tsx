"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, RotateCcw } from "lucide-react";

export interface QualityFilterState {
  hideDuplicateSiren: boolean;
  unseenOnly: boolean;
  minTechScore: number;
  requirePhone: boolean;
  requireEmail: boolean;
  requireDirigeant: boolean;
  requireEnriched: boolean;
  excludeAssociations: boolean;
  excludePhoneShared: boolean;
  excludeHttpDead: boolean;
  requireRge: boolean;
  requireQualiopi: boolean;
  requireBio: boolean;
}

export const DEFAULT_QUALITY_FILTER: QualityFilterState = {
  hideDuplicateSiren: false,
  unseenOnly: false,
  minTechScore: 0,
  requirePhone: false,
  requireEmail: false,
  requireDirigeant: false,
  requireEnriched: false,
  excludeAssociations: false,
  excludePhoneShared: false,
  excludeHttpDead: false,
  requireRge: false,
  requireQualiopi: false,
  requireBio: false,
};

interface QualityFilterSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: QualityFilterState;
  onApply: (filter: QualityFilterState) => void;
}

export function QualityFilterSidebar({ open, onOpenChange, current, onApply }: QualityFilterSidebarProps) {
  const [filter, setFilter] = useState<QualityFilterState>(current);

  useEffect(() => {
    if (open) setFilter(current);
  }, [open, current]);

  function reset() {
    setFilter(DEFAULT_QUALITY_FILTER);
  }

  function handleApply() {
    onApply(filter);
    onOpenChange(false);
  }

  const hasFilter = filter.hideDuplicateSiren || filter.unseenOnly || filter.minTechScore > 0 ||
    filter.requirePhone || filter.requireEmail || filter.requireDirigeant ||
    filter.requireEnriched || filter.excludeAssociations || filter.excludePhoneShared || filter.excludeHttpDead ||
    filter.requireRge || filter.requireQualiopi || filter.requireBio;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Filtre Qualite
          </SheetTitle>
          <SheetDescription>
            {!hasFilter
              ? "Aucun filtre actif"
              : [
                  filter.hideDuplicateSiren ? "Doublons SIREN masques" : null,
                  filter.unseenOnly ? "Non consultes uniquement" : null,
                  filter.minTechScore > 0 ? `Score tech min: ${filter.minTechScore}` : null,
                ].filter(Boolean).join(" + ")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-5">
          {/* Hide duplicate SIREN */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Doublons</Label>
            <label className="flex items-start gap-3 cursor-pointer hover:bg-muted/30 rounded p-2">
              <Checkbox
                checked={filter.hideDuplicateSiren}
                onCheckedChange={(c) => setFilter(prev => ({ ...prev, hideDuplicateSiren: c === true }))}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Masquer doublons SIREN</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ne garder que le meilleur domaine par SIREN (tri par tech_score DESC).
                  Les entreprises avec plusieurs sites ne seront affichees qu&apos;une fois.
                </p>
              </div>
            </label>
          </div>

          {/* Unseen only */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Consultation</Label>
            <label className="flex items-start gap-3 cursor-pointer hover:bg-muted/30 rounded p-2">
              <Checkbox
                checked={filter.unseenOnly}
                onCheckedChange={(c) => setFilter(prev => ({ ...prev, unseenOnly: c === true }))}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Non consultes uniquement</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Afficher uniquement les prospects jamais ouverts (sans date de derniere visite).
                </p>
              </div>
            </label>
          </div>

          {/* Data requirements */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Exigences donnees</Label>
            {[
              { key: "requirePhone" as const, label: "Telephone obligatoire", desc: "Uniquement les prospects avec un numero de telephone" },
              { key: "requireEmail" as const, label: "Email obligatoire", desc: "Uniquement les prospects avec un email" },
              { key: "requireDirigeant" as const, label: "Dirigeant connu", desc: "Nom du dirigeant identifie (API ou extraction)" },
              { key: "requireEnriched" as const, label: "Enrichi API gouv", desc: "Donnees confirmees par l'API Recherche Entreprises" },
            ].map(({ key, label, desc }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer hover:bg-muted/30 rounded p-2">
                <Checkbox
                  checked={filter[key]}
                  onCheckedChange={(c) => setFilter(prev => ({ ...prev, [key]: c === true }))}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium">{label}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Exclusions */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Exclusions</Label>
            {[
              { key: "excludeAssociations" as const, label: "Exclure associations", desc: "Masquer les associations (loi 1901)" },
              { key: "excludePhoneShared" as const, label: "Exclure tel. partages", desc: "Masquer les numeros utilises par plusieurs entreprises" },
              { key: "excludeHttpDead" as const, label: "Exclure sites morts", desc: "Masquer les sites avec erreur HTTP (non-200)" },
            ].map(({ key, label, desc }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer hover:bg-muted/30 rounded p-2">
                <Checkbox
                  checked={filter[key]}
                  onCheckedChange={(c) => setFilter(prev => ({ ...prev, [key]: c === true }))}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium">{label}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Min tech score */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Score technique</Label>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Score minimum (0 = pas de filtre)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={filter.minTechScore}
                onChange={(e) => setFilter(prev => ({
                  ...prev,
                  minTechScore: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)),
                }))}
                className="h-8 text-sm w-32"
              />
              <p className="text-xs text-muted-foreground">
                Score eleve = site obsolete = meilleur prospect pour une refonte.
              </p>
            </div>
          </div>

          {/* Certifications */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Certifications</Label>
            <div className="space-y-1">
              {[
                { key: "requireRge" as const, label: "RGE", desc: "Reconnu Garant de l'Environnement" },
                { key: "requireQualiopi" as const, label: "Qualiopi", desc: "Certification formation" },
                { key: "requireBio" as const, label: "Bio", desc: "Certification agriculture biologique" },
              ].map(({ key, label, desc }) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer hover:bg-muted/30 rounded p-2">
                  <Checkbox
                    checked={filter[key]}
                    onCheckedChange={(c) => setFilter(prev => ({ ...prev, [key]: c === true }))}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium">{label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Reset */}
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 w-full" onClick={reset}>
            <RotateCcw className="h-3 w-3" /> Reinitialiser
          </Button>
        </div>

        <SheetFooter className="border-t pt-4">
          <Button onClick={handleApply} className="w-full">
            Appliquer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
