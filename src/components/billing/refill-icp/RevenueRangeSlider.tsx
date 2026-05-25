"use client";

/**
 * Range slider chiffre d'affaires pour la page refill ICP.
 *
 * Granularité logarithmique implicite via presets (0, 100k, 500k, 1M, 5M, 10M+)
 * pour un UX plus naturel — un slider linéaire 0→100M serait inutilisable.
 *
 * State controlled `value = { min, max }`.
 */
import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

type RevenueRangeSliderProps = {
  value?: { min?: number; max?: number };
  onChange: (next: { min?: number; max?: number } | undefined) => void;
  disabled?: boolean;
};

// Pas log-uniforme — on définit des paliers humains (0, 50k, 100k, 250k, …).
const STEPS: number[] = [
  0,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
  2_500_000,
  5_000_000,
  10_000_000,
  25_000_000,
  50_000_000,
  100_000_000,
];

function formatEur(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M€`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k€`;
  return `${n}€`;
}

function indexFromValue(v: number | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < STEPS.length; i++) {
    const d = Math.abs(STEPS[i] - v);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function RevenueRangeSlider({
  value,
  onChange,
  disabled,
}: RevenueRangeSliderProps) {
  const minIdx = useMemo(() => indexFromValue(value?.min, 0), [value?.min]);
  const maxIdx = useMemo(
    () => indexFromValue(value?.max, STEPS.length - 1),
    [value?.max],
  );

  function handleChange(next: number[]) {
    const [lo, hi] = next as [number, number];
    const min = STEPS[lo];
    const max = STEPS[hi];
    if (lo === 0 && hi === STEPS.length - 1) {
      onChange(undefined);
    } else {
      onChange({
        ...(min > 0 ? { min } : {}),
        ...(hi < STEPS.length - 1 ? { max } : {}),
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Chiffre d&apos;affaires</Label>
        <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400">
          {formatEur(STEPS[minIdx])} – {formatEur(STEPS[maxIdx])}
        </span>
      </div>
      <Slider
        min={0}
        max={STEPS.length - 1}
        step={1}
        value={[minIdx, maxIdx]}
        onValueChange={handleChange}
        disabled={disabled}
        aria-label="Tranche de chiffre d'affaires"
      />
      <p className="text-xs text-neutral-500">
        Basé sur les bilans déposés (peut être partiel sur certaines TPE).
      </p>
    </div>
  );
}
