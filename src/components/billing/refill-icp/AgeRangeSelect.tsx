"use client";

/**
 * Sélecteur âge de l'entreprise pour la page refill ICP.
 *
 * 4 buckets pré-définis (<2 ans, 2-5, 5-10, >10) — pas de range continu
 * parce que la précision année n'a pas de valeur ICP (un user pense par
 * tranche, pas en années précises).
 */
import { Label } from "@/components/ui/label";

type AgeRangeSelectProps = {
  value?: { min_years?: number; max_years?: number };
  onChange: (next: { min_years?: number; max_years?: number } | undefined) => void;
  disabled?: boolean;
};

const BUCKETS: Array<{
  slug: string;
  label: string;
  min?: number;
  max?: number;
}> = [
  { slug: "any", label: "Tous" },
  { slug: "young", label: "< 2 ans", max: 2 },
  { slug: "growing", label: "2 à 5 ans", min: 2, max: 5 },
  { slug: "established", label: "5 à 10 ans", min: 5, max: 10 },
  { slug: "mature", label: "> 10 ans", min: 10 },
];

function matchBucket(value: AgeRangeSelectProps["value"]): string {
  if (!value || (value.min_years === undefined && value.max_years === undefined)) {
    return "any";
  }
  for (const b of BUCKETS) {
    if (b.slug === "any") continue;
    if (b.min === value.min_years && b.max === value.max_years) return b.slug;
  }
  return "custom"; // hors presets — ne devrait pas arriver depuis l'UI
}

export function AgeRangeSelect({
  value,
  onChange,
  disabled,
}: AgeRangeSelectProps) {
  const current = matchBucket(value);

  function pick(slug: string) {
    if (disabled) return;
    const b = BUCKETS.find((x) => x.slug === slug);
    if (!b || b.slug === "any") {
      onChange(undefined);
      return;
    }
    onChange({
      ...(b.min !== undefined ? { min_years: b.min } : {}),
      ...(b.max !== undefined ? { max_years: b.max } : {}),
    });
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Âge de l&apos;entreprise</Label>
      <div className="flex flex-wrap gap-2">
        {BUCKETS.map((b) => {
          const active = current === b.slug;
          return (
            <button
              key={b.slug}
              type="button"
              onClick={() => pick(b.slug)}
              disabled={disabled}
              aria-pressed={active}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                  : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300")
              }
            >
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
