"use client";

/**
 * Sélecteur multi-secteurs pour la page refill ICP.
 *
 * UX :
 *  - Chips presets de niveau métier (Restauration, Tech, BTP, Services B2B…)
 *    qui résolvent vers une liste de codes NAF (catalogue centralisé dans
 *    `src/lib/refill-icp/filters.ts:SECTOR_PRESETS`).
 *  - Champ libre pour saisir un code NAF arbitraire ("56.10A") — utile pour
 *    les users avancés qui ciblent un sous-secteur précis.
 *
 * State : controlled via `value` (liste de slugs/codes) et `onChange`.
 * Au-dessus une UI plus riche (recherche NAF live) sera ajoutée v2 quand on
 * aura le retour d'usage — MVP figé sur presets + saisie manuelle.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SECTOR_PRESETS } from "@/lib/refill-icp/filters";

type SectorMultiSelectProps = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

const PRESET_LABELS: Record<string, string> = {
  restauration: "Restauration",
  hebergement: "Hébergement",
  btp: "BTP & construction",
  tech: "Tech / IT",
  retail: "Commerce / Retail",
  services_b2b: "Services B2B",
  industrie: "Industrie",
  sante: "Santé",
};

function isLikelyNafCode(s: string): boolean {
  return /^[0-9]{1,2}(\.[0-9]{1,2}[A-Z]?)?$/i.test(s.trim());
}

export function SectorMultiSelect({
  value,
  onChange,
  disabled,
}: SectorMultiSelectProps) {
  const [customInput, setCustomInput] = useState("");

  function toggle(slugOrCode: string) {
    if (disabled) return;
    if (value.includes(slugOrCode)) {
      onChange(value.filter((s) => s !== slugOrCode));
    } else {
      onChange([...value, slugOrCode]);
    }
  }

  function addCustom() {
    const v = customInput.trim().toUpperCase();
    if (!v) return;
    if (!isLikelyNafCode(v)) return;
    if (value.includes(v)) {
      setCustomInput("");
      return;
    }
    onChange([...value, v]);
    setCustomInput("");
  }

  function remove(slugOrCode: string) {
    onChange(value.filter((s) => s !== slugOrCode));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(PRESET_LABELS).map(([slug, label]) => {
          const active = value.includes(slug);
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggle(slug)}
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
          placeholder="Code NAF (ex: 56.10A)"
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
          aria-label="Ajouter un code NAF"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCustom}
          disabled={disabled || !isLikelyNafCode(customInput)}
        >
          Ajouter
        </Button>
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((s) => (
            <Badge key={s} variant="secondary" className="gap-1">
              {PRESET_LABELS[s] ?? s}
              <button
                type="button"
                onClick={() => remove(s)}
                aria-label={`Retirer ${s}`}
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
          Aucun secteur sélectionné = tous les secteurs.
        </p>
      )}
      <p className="text-[10px] text-neutral-400">
        {Object.keys(SECTOR_PRESETS).length} presets disponibles. Saisir un
        code NAF spécifique au format <code>56.10A</code>.
      </p>
    </div>
  );
}
