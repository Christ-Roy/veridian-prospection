"use client";

/**
 * Affiche en LIVE le nombre de leads matchant les filtres ICP courants.
 *
 * UX :
 *  - Loading skeleton pendant le fetch
 *  - Count formaté (3 400 leads / "ICP très ciblé" / "ICP très large")
 *  - Indicateur taille pool (vert si > 1k, ambre si 100-1k, rouge si < 100)
 *
 * Tech :
 *  - Debounce 300ms : on relance estimate-count seulement quand l'user a
 *    posé son geste (anti-spam DB sur slider drag continu).
 *  - AbortController : annule la requête en vol si filtres changent à nouveau
 *    (sinon UI flicker entre 2 réponses out-of-order).
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { RefillIcpFilters } from "@/lib/refill-icp/filters";

type LiveCountPreviewProps = {
  filters: RefillIcpFilters;
  /** Callback up : remontent le résultat au parent qui pilote OrderSummaryCard. */
  onCountUpdate?: (result: PreviewResult | null) => void;
};

export type PreviewResult = {
  estimated_count: number;
  plan_cap: number;
  max_orderable: number;
  unit_price_cents: number;
  tier: string;
};

const DEBOUNCE_MS = 300;

function formatCount(n: number): string {
  return n.toLocaleString("fr-FR");
}

function classifyPool(n: number): {
  label: string;
  tone: "green" | "amber" | "red";
} {
  if (n >= 1000) return { label: "Pool confortable", tone: "green" };
  if (n >= 100) return { label: "Pool restreint", tone: "amber" };
  return { label: "Pool très limité", tone: "red" };
}

export function LiveCountPreview({
  filters,
  onCountUpdate,
}: LiveCountPreviewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Serialize les filtres en string pour comparaison stable dans useEffect.
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      setError(null);

      fetch("/api/leads/estimate-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: filtersKey,
        signal: abortRef.current.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as {
              message?: string;
            } | null;
            throw new Error(j?.message ?? `HTTP ${res.status}`);
          }
          return res.json() as Promise<PreviewResult>;
        })
        .then((data) => {
          setResult(data);
          setLoading(false);
          onCountUpdate?.(data);
        })
        .catch((err: Error) => {
          if (err.name === "AbortError") return;
          setError(err.message);
          setLoading(false);
          onCountUpdate?.(null);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
    // filtersKey change quand l'objet filters change shallow-deep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Comptage en cours…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">
        Erreur de comptage : {error}
      </p>
    );
  }

  if (!result) {
    return null;
  }

  const pool = classifyPool(result.estimated_count);
  const toneClass =
    pool.tone === "green"
      ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
      : pool.tone === "amber"
        ? "text-amber-600 bg-amber-50 dark:bg-amber-950/30"
        : "text-red-600 bg-red-50 dark:bg-red-950/30";

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <p className="text-xs uppercase tracking-wider text-neutral-500">
        Entreprises matchant ces filtres
      </p>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums">
          {formatCount(result.estimated_count)}
        </span>
        <span
          className={"rounded-full px-2 py-0.5 text-xs font-medium " + toneClass}
        >
          {pool.label}
        </span>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Vous pouvez en commander jusqu&apos;à{" "}
        <span className="font-medium tabular-nums">
          {formatCount(result.max_orderable)}
        </span>
        {" "}à la fois.
      </p>
    </div>
  );
}
