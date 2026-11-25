/** Refus d'une liaison, avec un message que l'utilisateur peut lire et un code que l'écran peut traiter. */
export class RefusLiaison extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statut = 409,
    /** Secondes à attendre avant de réessayer. */
    readonly attendre?: number,
  ) {
    super(message);
  }
}

export type Cible = "crm" | "notifuse";
export const NOM_CIBLE: Record<Cible, string> = { crm: "le CRM", notifuse: "Mail" };

/**
 * Refus du Hub (`/api/delegation/jeton`) traduits. Un code inconnu n'invente rien : message neutre, code gardé.
 * `grant_invalid` demande à l'écran de repasser par le Hub (rebond silencieux).
 */
export function refusDuHub(code: string, cible: Cible, attendre?: number): RefusLiaison {
  const c = NOM_CIBLE[cible];
  switch (code) {
    case "integration_off":
      return new RefusLiaison("paire_eteinte", `L'envoi vers ${c} est indisponible dans votre organisation : l'application n'y est pas ouverte, ou un administrateur a coupé la liaison dans Veridian.`, 403);
    case "pair_not_allowed":
    case "target_not_served":
    case "target_not_registered":
      return new RefusLiaison("paire_absente", `La liaison entre Atlas et ${c} n'est pas encore ouverte par Veridian.`, 403);
    case "grant_invalid":
      return new RefusLiaison("rebond", "Votre connexion Veridian doit être renouvelée avant cet envoi.", 401);
    case "not_member":
    case "user_invalid":
      return new RefusLiaison("membre_requis", "Vous n'êtes plus membre de cette organisation Veridian.", 403);
    case "tenant_suspended":
    case "tenant_not_found":
      return new RefusLiaison("tenant_suspendu", "Votre organisation Veridian est suspendue : aucun envoi possible.", 403);
    case "app_not_open":
      return new RefusLiaison("app_non_ouverte", `Vous n'avez pas encore accès à ${c} dans Veridian.`, 403);
    case "rate_limited":
      return new RefusLiaison("plafond", "Trop d'envois en peu de temps : patientez avant de reprendre.", 429, attendre ?? 60);
    default:
      return new RefusLiaison("hub_refus", "Veridian a refusé cet envoi. Réessayez, puis signalez-le si cela continue.", 502);
  }
}
