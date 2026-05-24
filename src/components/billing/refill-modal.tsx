"use client";

/**
 * Modale "Acheter des leads" — ouverte depuis /settings/leads.
 *
 * Flow :
 *  1. User saisit une quantité (input number ; on autorise les presets 100,
 *     500, 1k, 5k, 10k pour réduire la friction).
 *  2. On affiche en LIVE le prix calculé via la grille dégressive
 *     `calculateRefillCostCents(plan, qty)` — informatif, le Hub recalcule
 *     en source de vérité au moment de créer la session Stripe.
 *  3. Click "Payer" → POST /api/billing/refill-checkout → reçoit `url` →
 *     window.location.href = url (page Stripe Checkout chez le Hub).
 *
 * Mode dégradé : si l'endpoint Hub n'est pas disponible (502/500 retournés
 * par /api/billing/refill-checkout), le bouton se désactive avec un message
 * "Bientôt disponible" — pas d'écran d'erreur agressif (refill = nice-to-have,
 * pas un flow critique).
 */
import { useMemo, useState } from "react";
import { Loader2, ShoppingCart } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  calculateRefillCostCents,
  MAX_LEADS_PER_REFILL_ORDER,
  type PlanId,
} from "@/lib/billing/plans";

const QUANTITY_PRESETS = [100, 500, 1_000, 5_000, 10_000];

type RefillModalProps = {
  /** Plan refill du tenant ("freemium"|"pro"|"business") — passé par la page. */
  refillTier: PlanId;
  /** Nom human-readable du plan pour le titre ("Pro", "Business"). Optionnel. */
  planLabel?: string;
  /** Trigger custom (défaut : bouton CTA). */
  children?: React.ReactNode;
};

function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function RefillModal({
  refillTier,
  planLabel,
  children,
}: RefillModalProps) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState<number>(500);
  const [loading, setLoading] = useState(false);

  // Calcul prix LIVE — informatif. La grille canonique vit dans le submodule
  // shared, projetée via `@/lib/billing/plans`. Toute modif de pricing là =
  // ce composant reflète automatiquement.
  const { costCents, unitCents, isValidQty, errorMsg } = useMemo(() => {
    if (!Number.isFinite(quantity) || quantity < 1) {
      return {
        costCents: 0,
        unitCents: 0,
        isValidQty: false,
        errorMsg: "Indiquez une quantité ≥ 1.",
      };
    }
    if (quantity > MAX_LEADS_PER_REFILL_ORDER) {
      return {
        costCents: 0,
        unitCents: 0,
        isValidQty: false,
        errorMsg: `Maximum ${MAX_LEADS_PER_REFILL_ORDER.toLocaleString("fr-FR")} leads par commande. Pour plus, contactez-nous.`,
      };
    }
    try {
      const cost = calculateRefillCostCents(refillTier, quantity);
      const unit = cost / quantity;
      return { costCents: cost, unitCents: unit, isValidQty: true, errorMsg: "" };
    } catch (err) {
      return {
        costCents: 0,
        unitCents: 0,
        isValidQty: false,
        errorMsg: (err as Error).message,
      };
    }
  }, [refillTier, quantity]);

  async function handleCheckout() {
    if (!isValidQty || loading) return;
    setLoading(true);

    try {
      const successUrl = `${window.location.origin}/settings/leads?refill=success`;
      const cancelUrl = `${window.location.origin}/settings/leads?refill=cancel`;

      const res = await fetch("/api/billing/refill-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, successUrl, cancelUrl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 502 || res.status === 500) {
          toast.error(
            data.message ??
              "Le service de paiement est temporairement indisponible.",
          );
        } else if (res.status === 401) {
          toast.error("Session expirée — reconnectez-vous.");
        } else {
          toast.error(data.message ?? "Impossible de lancer le paiement.");
        }
        return;
      }

      const data = await res.json().catch(() => null);
      if (!data?.url || typeof data.url !== "string") {
        toast.error("Réponse invalide du service de paiement.");
        return;
      }

      // Redirige vers Stripe Checkout (chez le Hub). On NE remet PAS loading
      // à false — la page va naviguer.
      window.location.href = data.url;
    } catch (err) {
      console.error("[refill-modal] checkout error", err);
      toast.error("Erreur réseau — réessayez dans un instant.");
    } finally {
      // Au cas où la nav n'aurait pas eu lieu (erreur en amont).
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button data-testid="refill-modal-trigger">
            <ShoppingCart className="h-4 w-4" />
            Acheter des leads
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-md"
        data-testid="refill-modal-content"
      >
        <DialogHeader>
          <DialogTitle>Acheter des leads</DialogTitle>
          <DialogDescription>
            {planLabel ? (
              <>
                Tarif {planLabel} dégressif selon le volume. Les leads achetés
                restent disponibles à vie dans votre workspace.
              </>
            ) : (
              <>
                Tarif dégressif selon le volume. Les leads achetés restent
                disponibles à vie dans votre workspace.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="refill-quantity">Quantité</Label>
            <Input
              id="refill-quantity"
              data-testid="refill-quantity-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_LEADS_PER_REFILL_ORDER}
              step={1}
              value={quantity}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                setQuantity(Number.isFinite(v) ? v : 0);
              }}
              className="mt-1"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUANTITY_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={quantity === preset ? "default" : "outline"}
                  size="xs"
                  onClick={() => setQuantity(preset)}
                  data-testid={`refill-preset-${preset}`}
                >
                  {preset.toLocaleString("fr-FR")}
                </Button>
              ))}
            </div>
          </div>

          <div
            className="rounded-md border bg-muted/30 p-3 text-sm space-y-1"
            data-testid="refill-price-summary"
          >
            {isValidQty ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Prix unitaire</span>
                  <span className="tabular-nums">
                    {formatEuros(unitCents)} / lead
                  </span>
                </div>
                <div className="flex items-center justify-between font-medium">
                  <span>Total</span>
                  <span className="tabular-nums text-base">
                    {formatEuros(costCents)}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-destructive" data-testid="refill-error">
                {errorMsg}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleCheckout}
            disabled={!isValidQty || loading}
            data-testid="refill-pay-button"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Redirection...
              </>
            ) : (
              <>Payer {isValidQty ? formatEuros(costCents) : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
