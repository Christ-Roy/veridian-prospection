"use client";

/**
 * Container client de la page /leads/buy — orchestre les 8 composants ICP,
 * tient le state `filters` partagé, et pilote le LiveCountPreview qui
 * remonte le `max_orderable` à OrderSummaryCard.
 *
 * Pattern : 1 source de vérité (filters state local) + setters par composant +
 * preview qui consume filters et publish result up.
 */
import { useState } from "react";
import { SectorMultiSelect } from "./SectorMultiSelect";
import { GeoMultiSelect } from "./GeoMultiSelect";
import { EmployeeRangeSlider } from "./EmployeeRangeSlider";
import { RevenueRangeSlider } from "./RevenueRangeSlider";
import { AgeRangeSelect } from "./AgeRangeSelect";
import { QualifierTagsSelect } from "./QualifierTagsSelect";
import { LiveCountPreview, type PreviewResult } from "./LiveCountPreview";
import { OrderSummaryCard } from "./OrderSummaryCard";
import {
  RefillIcpFiltersSchema,
  type RefillIcpFilters,
  type QualifierKey,
} from "@/lib/refill-icp/filters";
import type { PlanId } from "@/lib/billing/plans";

type RefillIcpClientProps = {
  initialTier: PlanId;
  planLabel?: string;
};

export function RefillIcpClient({
  initialTier,
  planLabel,
}: RefillIcpClientProps) {
  const [filters, setFilters] = useState<RefillIcpFilters>(() => {
    // Zod parse pour appliquer default country='FR'.
    const parsed = RefillIcpFiltersSchema.safeParse({});
    return parsed.success ? parsed.data : { country: "FR" };
  });
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const businessGated = initialTier !== "business";

  function patch<K extends keyof RefillIcpFilters>(
    key: K,
    val: RefillIcpFilters[K],
  ) {
    setFilters((prev) => {
      const next = { ...prev };
      if (val === undefined || (Array.isArray(val) && val.length === 0)) {
        delete next[key];
      } else {
        next[key] = val;
      }
      // Toujours garder country.
      next.country = next.country ?? "FR";
      return next;
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
            Secteurs d&apos;activité
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Sélectionnez les secteurs cibles. Vide = tous secteurs.
          </p>
          <div className="mt-4">
            <SectorMultiSelect
              value={filters.sectors ?? []}
              onChange={(v) => patch("sectors", v.length > 0 ? v : undefined)}
            />
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
            Géographie
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Zones régionales (presets) ou départements à la pièce.
          </p>
          <div className="mt-4">
            <GeoMultiSelect
              value={filters.regions ?? []}
              onChange={(v) => patch("regions", v.length > 0 ? v : undefined)}
            />
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
            Taille
          </h2>
          <div className="mt-4 space-y-6">
            <EmployeeRangeSlider
              value={filters.employee_range}
              onChange={(v) => patch("employee_range", v)}
            />
            <RevenueRangeSlider
              value={filters.revenue_range}
              onChange={(v) => patch("revenue_range", v)}
            />
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
            Maturité & qualifiers
          </h2>
          <div className="mt-4 space-y-6">
            <AgeRangeSelect
              value={filters.age_range}
              onChange={(v) => patch("age_range", v)}
            />
            <QualifierTagsSelect
              value={(filters.qualifiers ?? []) as QualifierKey[]}
              onChange={(v) =>
                patch("qualifiers", v.length > 0 ? v : undefined)
              }
              gated={businessGated}
            />
          </div>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <LiveCountPreview filters={filters} onCountUpdate={setPreview} />
        <OrderSummaryCard
          filters={filters}
          maxOrderable={preview?.max_orderable ?? 0}
          tier={initialTier}
          planLabel={planLabel}
        />
      </aside>
    </div>
  );
}
