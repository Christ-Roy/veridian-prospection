"use client";

/**
 * Badge perma-visible dans la nav qui affiche le solde de leads du workspace
 * actif. Polling léger (60s) — pas besoin d'être temps réel, c'est un compteur
 * informatif. Le solde est aussi refresh imperativement après un retour
 * Stripe (via le polling de /settings/leads).
 *
 * Décision Robert 2026-05-22 ([[project_refill_leads_solde_visible]]) :
 *  - Solde POSITIF visible et rassurant — ce qui leur reste, pas une limite.
 *  - Couleur progressive : neutre par défaut, orange < 50, rouge < 10 (signal
 *    business utile, pas anxiogène).
 *  - Cliquable → /settings/leads où ils peuvent en acheter.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Gem } from "lucide-react";
import { cn } from "@/lib/utils";

type Balance = {
  balance: number;
  credited: number;
  consumed: number;
};

const POLL_INTERVAL_MS = 60_000;

export function LeadsBalanceBadge({ className }: { className?: string }) {
  const [balance, setBalance] = useState<Balance | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBalance() {
      try {
        const res = await fetch("/api/me/leads-balance");
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled || !data) return;
        if (
          typeof data.balance === "number" &&
          typeof data.credited === "number" &&
          typeof data.consumed === "number"
        ) {
          setBalance({
            balance: data.balance,
            credited: data.credited,
            consumed: data.consumed,
          });
        }
      } catch {
        // best-effort — la nav doit toujours s'afficher même si l'endpoint plante
      }
    }

    fetchBalance();
    const interval = setInterval(fetchBalance, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (balance === null) return null;

  const isLow = balance.balance > 0 && balance.balance < 50;
  const isCritical = balance.balance > 0 && balance.balance < 10;
  const isEmpty = balance.balance <= 0;

  return (
    <Link
      href="/settings/leads"
      title={`${balance.balance} leads disponibles — cliquez pour en acheter`}
      data-testid="leads-balance-badge"
      className={cn(
        "inline-flex items-center gap-1 px-1.5 md:px-2 py-1 rounded-full text-[11px] md:text-xs font-medium transition-colors min-h-[28px]",
        isEmpty
          ? "bg-red-100 text-red-700 hover:bg-red-200"
          : isCritical
            ? "bg-red-50 text-red-700 hover:bg-red-100"
            : isLow
              ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
        className,
      )}
    >
      <Gem className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />
      <span className="tabular-nums">
        {balance.balance.toLocaleString("fr-FR")}
      </span>
    </Link>
  );
}
