"use client";

/**
 * Page client /settings/leads — solde + historique + CTA achat.
 *
 * Comportement post-redirect Stripe :
 *  - ?refill=success → toast succès + polling court (3s × 3) sur
 *    /api/me/leads-balance pour attraper le webhook Hub→Prospection qui a
 *    entre-temps incrémenté `leadsCredited`. Toast de confirmation dès que
 *    le delta est visible. Si timeout sans incrément : message info
 *    "Paiement reçu, votre solde sera mis à jour dans quelques minutes".
 *  - ?refill=cancel → toast neutre "Paiement annulé".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Gem, ShoppingCart, Loader2, History } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefillModal } from "./refill-modal";
import type { PlanId } from "@/lib/billing/plans";

type Balance = {
  balance: number;
  credited: number;
  consumed: number;
  plan: string;
  refillTier: PlanId;
};

type LeadEvent = {
  id: string;
  quantity: number;
  source: "purchase" | "welcome" | string;
  welcomePlan: string | null;
  stripePaymentId: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 3;

const PLAN_LABELS: Record<string, string> = {
  freemium: "Freemium",
  pro: "Pro",
  business: "Business",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function LeadsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Garde anti double-handle ?refill=success entre re-renders (React Strict
  // Mode déclenche deux fois en dev).
  const refillHandledRef = useRef(false);

  const fetchBalance = useCallback(async (): Promise<Balance | null> => {
    try {
      const res = await fetch("/api/me/leads-balance");
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data || typeof data.balance !== "number") return null;
      return data as Balance;
    } catch {
      return null;
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/me/leads-events?limit=50");
      if (!res.ok) {
        setEvents([]);
        return;
      }
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.events)) {
        setEvents(data.events as LeadEvent[]);
      } else {
        setEvents([]);
      }
    } catch {
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // Charge initial du solde + historique.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const b = await fetchBalance();
      if (cancelled) return;
      setBalance(b);
      setLoadingBalance(false);
    })();
    fetchEvents();
    return () => {
      cancelled = true;
    };
  }, [fetchBalance, fetchEvents]);

  // Polling post-redirect Stripe.
  useEffect(() => {
    const refillStatus = searchParams?.get("refill");
    if (!refillStatus) return;
    if (refillHandledRef.current) return;
    refillHandledRef.current = true;

    if (refillStatus === "cancel") {
      toast("Paiement annulé.", { duration: 4000 });
      // Nettoie l'URL pour éviter de re-déclencher au refresh.
      router.replace("/settings/leads");
      return;
    }

    if (refillStatus !== "success") {
      router.replace("/settings/leads");
      return;
    }

    toast.success("Paiement reçu — mise à jour du solde en cours...", {
      duration: 3000,
    });

    let cancelled = false;
    let attempts = 0;
    let initialCredited: number | null = null;

    (async () => {
      // Snapshot du solde avant le polling pour détecter le delta.
      const before = await fetchBalance();
      if (before) initialCredited = before.credited;

      const poll = async () => {
        if (cancelled) return;
        attempts += 1;
        const fresh = await fetchBalance();
        if (cancelled) return;

        if (fresh) {
          setBalance(fresh);
          if (
            initialCredited !== null &&
            fresh.credited > initialCredited
          ) {
            toast.success(
              `Solde mis à jour : +${(fresh.credited - initialCredited).toLocaleString("fr-FR")} leads.`,
              { duration: 5000 },
            );
            fetchEvents();
            router.replace("/settings/leads");
            return;
          }
        }

        if (attempts < POLL_MAX_ATTEMPTS) {
          setTimeout(poll, POLL_INTERVAL_MS);
        } else {
          toast(
            "Paiement reçu, votre solde sera mis à jour dans quelques minutes.",
            { duration: 6000 },
          );
          fetchEvents();
          router.replace("/settings/leads");
        }
      };

      setTimeout(poll, POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, fetchBalance, fetchEvents, router]);

  const planLabel = useMemo(() => {
    if (!balance) return undefined;
    return PLAN_LABELS[balance.plan] ?? balance.plan;
  }, [balance]);

  return (
    <div className="container max-w-4xl py-6 px-4 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Mes leads</h1>
          <p className="text-sm text-muted-foreground">
            Solde de leads disponibles, historique de vos crédits et achat de
            lots supplémentaires.
          </p>
        </div>
      </header>

      {/* Solde — gros, lisible, rassurant */}
      <Card
        className="p-5 sm:p-6"
        data-testid="leads-balance-card"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-indigo-50 p-2.5 text-indigo-600">
              <Gem className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Leads disponibles
              </p>
              {loadingBalance ? (
                <div className="h-9 w-32 mt-1 animate-pulse rounded bg-muted" />
              ) : (
                <p
                  className="text-3xl sm:text-4xl font-semibold tabular-nums"
                  data-testid="leads-balance-value"
                >
                  {balance
                    ? balance.balance.toLocaleString("fr-FR")
                    : "—"}
                </p>
              )}
              {balance && (
                <p className="text-xs text-muted-foreground mt-1">
                  {balance.credited.toLocaleString("fr-FR")} crédités —{" "}
                  {balance.consumed.toLocaleString("fr-FR")} consommés
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0">
            {balance ? (
              <RefillModal
                refillTier={balance.refillTier}
                planLabel={planLabel}
              />
            ) : (
              <Button disabled>
                <ShoppingCart className="h-4 w-4" />
                Acheter des leads
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Historique des crédits */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-medium">Historique des crédits</h2>
        </div>
        <div className="overflow-x-auto">
          {loadingEvents ? (
            <div className="p-6 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Chargement de l&apos;historique...
            </div>
          ) : events && events.length > 0 ? (
            <table
              className="w-full text-sm"
              data-testid="leads-events-table"
            >
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-right px-4 py-2 font-medium">
                    Quantité
                  </th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">
                    Référence
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className="border-t hover:bg-muted/20"
                    data-testid={`leads-event-row-${event.id}`}
                  >
                    <td className="px-4 py-2 text-xs whitespace-nowrap">
                      {formatDate(event.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      {event.source === "welcome" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs">
                          Bienvenue
                          {event.welcomePlan ? (
                            <span className="opacity-70">
                              ({event.welcomePlan})
                            </span>
                          ) : null}
                        </span>
                      ) : event.source === "purchase" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-xs">
                          Achat
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-xs">
                          {event.source}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      +{event.quantity.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground hidden sm:table-cell font-mono">
                      {event.stripePaymentId
                        ? event.stripePaymentId.slice(0, 18) +
                          (event.stripePaymentId.length > 18 ? "…" : "")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-sm text-muted-foreground text-center">
              Aucun crédit pour l&apos;instant. Achetez votre premier lot pour
              commencer à consulter des fiches entreprises.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
