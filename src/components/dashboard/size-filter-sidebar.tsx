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
import { Label } from "@/components/ui/label";
import { Building2, RotateCcw } from "lucide-react";

// Effectifs mapping (INSEE code -> readable label + range)
const EFFECTIFS_OPTIONS: { code: string; label: string; min: number; max: number }[] = [
  { code: "00", label: "0 salarie", min: 0, max: 0 },
  { code: "01", label: "1-2 salaries", min: 1, max: 2 },
  { code: "02", label: "3-5 salaries", min: 3, max: 5 },
  { code: "03", label: "6-9 salaries", min: 6, max: 9 },
  { code: "11", label: "10-19 salaries", min: 10, max: 19 },
  { code: "12", label: "20-49 salaries", min: 20, max: 49 },
  { code: "21", label: "50-99 salaries", min: 50, max: 99 },
  { code: "22", label: "100-199 salaries", min: 100, max: 199 },
  { code: "31", label: "200-249 salaries", min: 200, max: 249 },
  { code: "32", label: "250-499 salaries", min: 250, max: 499 },
  { code: "41", label: "500-999 salaries", min: 500, max: 999 },
  { code: "NN", label: "Non renseigne", min: -1, max: -1 },
];

// Preset size categories
const SIZE_PRESETS = [
  { id: "all", label: "Tous", codes: null },
  { id: "individuel", label: "Individuel (0-2 sal.)", codes: ["00", "01", "NN"] },
  { id: "pme", label: "PME (3-249 sal.)", codes: ["02", "03", "11", "12", "21", "22", "31"] },
  { id: "grande", label: "Grande (250+ sal.)", codes: ["32", "41"] },
] as const;

export interface CaRange { min: number | null; max: number | null; label: string }

const CA_TRANCHES: CaRange[] = [
  { label: "< 100K €", min: null, max: 100000 },
  { label: "100K - 500K €", min: 100000, max: 500000 },
  { label: "500K - 2M €", min: 500000, max: 2000000 },
  { label: "2M - 5M €", min: 2000000, max: 5000000 },
  { label: "5M - 10M €", min: 5000000, max: 10000000 },
  { label: "> 10M €", min: 10000000, max: null },
];

export interface SizeFilterState {
  effectifsCodes: string[];
  mobileOnly: boolean;
  caMin: number | null;
  caMax: number | null;
  caRanges: number[]; // indices into CA_TRANCHES
  operator: "and" | "or";
}

export const DEFAULT_SIZE_FILTER: SizeFilterState = {
  effectifsCodes: [],
  mobileOnly: false,
  caMin: null,
  caMax: null,
  caRanges: [],
  operator: "or",
};

interface SizeFilterSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: SizeFilterState;
  onApply: (filter: SizeFilterState) => void;
}

export function SizeFilterSidebar({ open, onOpenChange, current, onApply }: SizeFilterSidebarProps) {
  const [filter, setFilter] = useState<SizeFilterState>(current);

  useEffect(() => {
    if (open) setFilter(current);
  }, [open, current]);

  function toggleEffCode(code: string) {
    setFilter(prev => {
      const codes = new Set(prev.effectifsCodes);
      if (codes.has(code)) codes.delete(code);
      else codes.add(code);
      return { ...prev, effectifsCodes: Array.from(codes) };
    });
  }

  function applyPreset(preset: typeof SIZE_PRESETS[number]) {
    if (!preset.codes) {
      setFilter(prev => ({ ...prev, effectifsCodes: [] }));
    } else {
      setFilter(prev => ({ ...prev, effectifsCodes: [...preset.codes] }));
    }
  }

  function reset() {
    setFilter(DEFAULT_SIZE_FILTER);
  }

  function handleApply() {
    onApply(filter);
    onOpenChange(false);
  }

  // Determine which preset is active
  const activePreset = SIZE_PRESETS.find(p => {
    if (!p.codes) return filter.effectifsCodes.length === 0;
    return p.codes.length === filter.effectifsCodes.length &&
      p.codes.every(c => filter.effectifsCodes.includes(c));
  });

  const hasFilter = filter.effectifsCodes.length > 0 || filter.mobileOnly || filter.caMin !== null || filter.caMax !== null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:max-w-[400px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Filtre Taille
          </SheetTitle>
          <SheetDescription>
            {!hasFilter
              ? "Aucun filtre actif"
              : `${filter.effectifsCodes.length > 0 ? filter.effectifsCodes.length + " tranche(s) effectifs" : ""}${filter.mobileOnly ? " + mobile uniquement" : ""}${filter.caMin ? ` + CA min ${(filter.caMin / 1000).toFixed(0)}K` : ""}${filter.caMax ? ` + CA max ${(filter.caMax / 1000).toFixed(0)}K` : ""}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-5">
          {/* Quick presets */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Taille predefinies</Label>
            <div className="grid grid-cols-2 gap-2">
              {SIZE_PRESETS.map(preset => (
                <Button
                  key={preset.id}
                  size="sm"
                  variant={activePreset?.id === preset.id ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Mobile only toggle */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Contact</Label>
            <label className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded p-2">
              <Checkbox
                checked={filter.mobileOnly}
                onCheckedChange={(c) => setFilter(prev => ({ ...prev, mobileOnly: c === true }))}
              />
              <span className="text-sm">Mobile uniquement (06/07)</span>
            </label>
          </div>

          {/* Effectifs detail */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Tranches effectifs</Label>
            <div className="space-y-1">
              {EFFECTIFS_OPTIONS.map(opt => (
                <label
                  key={opt.code}
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded px-2 py-1"
                >
                  <Checkbox
                    checked={filter.effectifsCodes.includes(opt.code)}
                    onCheckedChange={() => toggleEffCode(opt.code)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-sm">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto font-mono">{opt.code}</span>
                </label>
              ))}
            </div>
          </div>

          {/* CA tranches (multi-select) */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Chiffre d&apos;affaires</Label>
            <div className="space-y-1">
              {CA_TRANCHES.map((tranche, idx) => (
                <label
                  key={tranche.label}
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded px-2 py-1"
                >
                  <Checkbox
                    checked={filter.caRanges.includes(idx)}
                    onCheckedChange={() => {
                      setFilter(prev => {
                        const ranges = new Set(prev.caRanges);
                        if (ranges.has(idx)) ranges.delete(idx); else ranges.add(idx);
                        // Compute merged min/max from selected ranges
                        const selected = Array.from(ranges).map(i => CA_TRANCHES[i]);
                        const caMin = selected.length > 0 ? Math.min(...selected.map(s => s.min ?? 0)) : null;
                        const caMax = selected.length > 0 ? (selected.some(s => s.max === null) ? null : Math.max(...selected.map(s => s.max!))) : null;
                        return { ...prev, caRanges: Array.from(ranges), caMin: caMin === 0 && selected.some(s => s.min === null) ? null : caMin, caMax };
                      });
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-sm">{tranche.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Operator */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Combinaison effectifs / CA</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={filter.operator === "and" ? "default" : "outline"}
                className="h-7 text-xs flex-1"
                onClick={() => setFilter(prev => ({ ...prev, operator: "and" }))}
              >
                Effectifs ET CA
              </Button>
              <Button
                size="sm"
                variant={filter.operator === "or" ? "default" : "outline"}
                className="h-7 text-xs flex-1"
                onClick={() => setFilter(prev => ({ ...prev, operator: "or" }))}
              >
                Effectifs OU CA
              </Button>
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
