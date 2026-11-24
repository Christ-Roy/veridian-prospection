/**
 * Drapeau des liaisons : `ATLAS_LIAISONS`, par exemple `crm=*;notifuse=<tenant Hub>,<tenant Hub>`. Absent, vide ou
 * illisible = tout est éteint : aucun bouton affiché, toute route refuse.
 */
import type { Cible } from "./erreurs";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function liaisonOuverte(cible: Cible, hubTenantId: string | null, brut: string | undefined = process.env.ATLAS_LIAISONS): boolean {
  if (!hubTenantId) return false;
  for (const regle of (brut ?? "").split(";")) {
    const [nom, valeur, ...reste] = regle.split("=").map((x) => x.trim().toLowerCase());
    if (nom !== cible || !valeur || reste.length) continue;
    if (valeur === "*") return true;
    if (valeur.split(",").some((t) => UUID.test(t.trim()) && t.trim() === hubTenantId.toLowerCase())) return true;
  }
  return false;
}
