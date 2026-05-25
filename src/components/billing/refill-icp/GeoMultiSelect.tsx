"use client";

/**
 * Sélecteur multi-départements pour la page refill ICP.
 *
 * UX :
 *  - Boutons preset zones (Île-de-France, Auvergne-Rhône-Alpes, …) qui
 *    résolvent vers une liste de départements (catalogue dans
 *    `src/lib/refill-icp/filters.ts:REGION_PRESETS`).
 *  - Champ libre code département (75, 92, 2A, 971…).
 *
 * MVP volontairement simple — pas de carte interactive (lib lourde, perf,
 * complexité pour MVP). À ajouter v2 quand l'usage le justifie.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FR_DEPARTMENTS, REGION_PRESETS } from "@/lib/refill-icp/filters";

type GeoMultiSelectProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

const ZONE_LABELS: Record<string, string> = {
  idf: "Île-de-France",
  ara: "Auvergne-Rhône-Alpes",
  paca: "Provence-Alpes-Côte d'Azur",
  occitanie: "Occitanie",
  hauts_de_france: "Hauts-de-France",
  bretagne: "Bretagne",
  pays_de_la_loire: "Pays de la Loire",
};

function isValidDep(s: string): boolean {
  return FR_DEPARTMENTS.includes(s.toUpperCase());
}

export function GeoMultiSelect({
  value,
  onChange,
  disabled,
}: GeoMultiSelectProps) {
  const [customInput, setCustomInput] = useState("");

  function applyZone(slug: string) {
    if (disabled) return;
    const deps = REGION_PRESETS[slug];
    if (!deps) return;
    // Union — n'écrase pas un autre choix actif.
    const merged = Array.from(new Set([...value, ...deps]));
    onChange(merged);
  }

  function clearZone(slug: string) {
    if (disabled) return;
    const deps = REGION_PRESETS[slug];
    if (!deps) return;
    onChange(value.filter((d) => !deps.includes(d)));
  }

  function isZoneActive(slug: string): boolean {
    const deps = REGION_PRESETS[slug];
    if (!deps) return false;
    return deps.every((d) => value.includes(d));
  }

  function addCustom() {
    const v = customInput.trim().toUpperCase();
    if (!v || !isValidDep(v) || value.includes(v)) {
      setCustomInput("");
      return;
    }
    onChange([...value, v]);
    setCustomInput("");
  }

  function remove(dep: string) {
    onChange(value.filter((d) => d !== dep));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(ZONE_LABELS).map(([slug, label]) => {
          const active = isZoneActive(slug);
          return (
            <button
              key={slug}
              type="button"
              onClick={() => (active ? clearZone(slug) : applyZone(slug))}
              disabled={disabled}
              aria-pressed={active}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                  : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300")
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Département (ex: 75, 2A, 971)"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          disabled={disabled}
          className="max-w-[200px]"
          aria-label="Ajouter un département"
          maxLength={3}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCustom}
          disabled={disabled || !isValidDep(customInput)}
        >
          Ajouter
        </Button>
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((d) => (
            <Badge key={d} variant="secondary" className="gap-1">
              {d}
              <button
                type="button"
                onClick={() => remove(d)}
                aria-label={`Retirer ${d}`}
                className="ml-0.5 text-neutral-500 hover:text-neutral-900"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {value.length === 0 && (
        <p className="text-xs text-neutral-500">
          Aucun département sélectionné = toute la France.
        </p>
      )}
    </div>
  );
}
