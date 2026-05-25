"use client";

/**
 * Carte récapitulative de la commande refill ICP — quantity, prix, CTA Acheter.
 *
 * Bouton "Acheter" :
 *  - Désactivé si quantity < 1 ou > max_orderable
 *  - Loading state pendant le POST /api/refill/start
 *  - En succès → window.location.href = url Stripe Checkout (redirect hors app)
 *  - En erreur → toast + state idle (l'user peut retry)
 */
import { useMemo, useState } from "react";
import { Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  calculateRefillCostCents,
  type PlanId,
} from "@/lib/billing/plans";
import type { RefillIcpFilters } from "@/lib/refill-icp/filters";

type OrderSummaryCardProps = {
  filters: RefillIcpFilters;
  maxOrderable: number;
  tier: PlanId;
  /** Affiche l'icône d'un plan supérieur si appliqué (informatif). */
  planLabel?: string;
};

const QUANTITY_PRESETS = [100, 500, 1_000, 5_000, 10_000];

function formatEur(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function OrderSummaryCard({
  filters,
  maxOrderable,
  tier,
  planLabel,
}: OrderSummaryCardProps) {
  const [quantity, setQuantity] = useState<number>(500);
  const [loading, setLoading] = useState(false);

  const effectiveMax = Math.max(0, maxOrderable);

  const { costCents, isValidQty, errorMsg } = useMemo(() => {
    if (!Number.isFinite(quantity) || quantity < 1) {
      return {
        costCents: 0,
        isValidQty: false,
        errorMsg: "Indiquez une quantité ≥ 1.",
      };
    }
    if (quantity > effectiveMax) {
      return {
        costCents: 0,
        isValidQty: false,
        errorMsg: `Maximum ${effectiveMax.toLocaleString("fr-FR")} leads avec ces filtres.`,
      };
    }
    try {
      const cents = calculateRefillCostCents(tier, quantity);
      return { costCents: cents, isValidQty: true, errorMsg: null };
    } catch (err) {
      return {
        costCents: 0,
        isValidQty: false,
        errorMsg: (err as Error).message,
      };
    }
  }, [quantity, tier, effectiveMax]);

  async function handleBuy() {
    if (!isValidQty) return;
    setLoading(true);
    try {
      const successUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/leads?refill=success`
          : undefined;
      const cancelUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/leads/buy?refill=cancel`
          : undefined;

      const res = await fetch("/api/refill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity,
          filters,
          successUrl,
          cancelUrl,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
        message?: string;
        reason?: string;
      } | null;

      if (!res.ok || !data?.url) {
        toast.error(data?.message ?? `Erreur ${res.status}`);
        setLoading(false);
        return;
      }
      // Redirect hors-app — pas besoin de cleanup state.
      window.location.href = data.url;
    } catch (err) {
      toast.error("Erreur réseau. Réessayez dans un instant.");
      console.error("[refill/start] fetch failed:", err);
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <h3 className="text-lg font-semibold">Votre commande</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Plan {planLabel ?? tier} — grille de prix dégressive
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {QUANTITY_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setQuantity(p)}
            disabled={loading || p > effectiveMax}
            className={
              "rounded-md border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors " +
              (p === quantity
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-50 dark:bg-neutral-50 dark:text-neutral-900"
                : p > effectiveMax
                  ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
                  : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300")
            }
          >
            {p.toLocaleString("fr-FR")}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Label htmlFor="qty-input" className="text-sm font-medium">
          Quantité
        </Label>
        <Input
          id="qty-input"
          type="number"
          min={1}
          max={effectiveMax}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value) || 0)}
          disabled={loading}
          className="mt-1 max-w-[180px] tabular-nums"
        />
        {!isValidQty && errorMsg && (
          <p className="mt-1 text-xs text-red-600">{errorMsg}</p>
        )}
      </div>

      <div className="mt-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-neutral-500">Total TTC</span>
          <span className="text-2xl font-bold tabular-nums">
            {isValidQty ? formatEur(costCents) : "—"}
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          Paiement sécurisé Stripe. Aucun engagement.
        </p>
      </div>

      <Button
        type="button"
        size="lg"
        onClick={handleBuy}
        disabled={!isValidQty || loading}
        className="mt-4 w-full"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Redirection…
          </>
        ) : (
          <>
            <ShoppingCart className="mr-2 h-4 w-4" />
            Acheter {quantity.toLocaleString("fr-FR")} leads
          </>
        )}
      </Button>
    </div>
  );
}
