/**
 * /settings/leads — page "Mes leads" (refill leads UI).
 *
 * Sépare le shell server (auth gate possible plus tard si besoin) du client
 * qui gère solde + polling Stripe + historique. Volontairement minimaliste
 * côté server : le `LeadsPageClient` fetch tout ce dont il a besoin via les
 * endpoints /api/me/* (déjà protégés par requireUser).
 */
import { LeadsPageClient } from "@/components/billing/leads-page-client";

export const dynamic = "force-dynamic";

export default function LeadsSettingsPage() {
  return <LeadsPageClient />;
}
