"use client";

/**
 * Range slider effectifs entreprise pour la page refill ICP.
 *
 * State : controlled `value = { min, max }`. Convertit le range numérique en
 * codes SIRENE effectifs côté API (cf `resolveEmployeeRangeToCodes` dans
 * `lib/refill-icp/filters.ts`).
 *
 * Bornes : 0 → 1000+. La valeur "1000" affiche "1000+" car au-delà la
 * SIRENE plafonne par tranches (1000-1999, 2000-4999, …).
 */
import { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

type EmployeeRangeSliderProps = {
  value?: { min?: number; max?: number };
  onChange: (next: { min?: number; max?: number } | undefined) => void;
  disabled?: boolean;
};

const HARD_MAX = 1000; // "1000+"
const HARD_MIN = 0;

function format(n: number): string {
  if (n >= HARD_MAX) return `${HARD_MAX}+`;
  return String(n);
}

export function EmployeeRangeSlider({
  value,
  onChange,
  disabled,
}: EmployeeRangeSliderProps) {
  // Local state pour un drag fluide — on remonte via onChange seulement
  // sur onValueCommit (relâche). Mais Radix Slider n'expose pas commit
  // natif → on remonte sur chaque change, le caller debounce côté preview.
  const [local, setLocal] = useState<[number, number]>([
    value?.min ?? HARD_MIN,
    value?.max ?? HARD_MAX,
  ]);

  useEffect(() => {
    setLocal([value?.min ?? HARD_MIN, value?.max ?? HARD_MAX]);
  }, [value?.min, value?.max]);

  function handleChange(next: number[]) {
    const [min, max] = next as [number, number];
    setLocal([min, max]);
    // Si l'user remet aux bornes → on enlève le filtre (équivalent "tout").
    if (min === HARD_MIN && max === HARD_MAX) {
      onChange(undefined);
    } else {
      onChange({
        ...(min > HARD_MIN ? { min } : {}),
        ...(max < HARD_MAX ? { max } : {}),
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Effectifs</Label>
        <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400">
          {format(local[0])} – {format(local[1])} salariés
        </span>
      </div>
      <Slider
        min={HARD_MIN}
        max={HARD_MAX}
        step={1}
        value={local}
        onValueChange={handleChange}
        disabled={disabled}
        aria-label="Tranche d'effectifs"
      />
      <p className="text-xs text-neutral-500">
        Range glissé sur les tranches SIRENE (1-2, 3-5, 6-9, 10-19, …).
      </p>
    </div>
  );
}
