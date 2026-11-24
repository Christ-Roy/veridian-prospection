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
 * `poignee_*` demande à l'écran de repasser par le Hub (rebond silencieux).
 */
export function refusDuHub(code: string, cible: Cible, attendre?: number): RefusLiaison {
  const c = NOM_CIBLE[cible];
  switch (code) {
    case "paire_eteinte":
      return new RefusLiaison(code, `La liaison entre Atlas et ${c} est éteinte dans votre organisation. Un propriétaire ou un administrateur peut l'allumer dans Veridian.`, 403);
    case "paire_absente":
      return new RefusLiaison(code, `La liaison entre Atlas et ${c} n'existe pas encore.`, 403);
    case "poignee_invalide":
    case "poignee_expiree":
      return new RefusLiaison("rebond", "Votre connexion Veridian doit être renouvelée avant cet envoi.", 401);
    case "membre_requis":
      return new RefusLiaison(code, "Vous n'êtes plus membre de cette organisation Veridian.", 403);
    case "tenant_suspendu":
      return new RefusLiaison(code, "Votre organisation Veridian est suspendue : aucun envoi possible.", 403);
    case "app_non_ouverte":
      return new RefusLiaison(code, `Vous n'avez pas encore ouvert ${c} : ouvrez-le une fois depuis Veridian, puis réessayez.`, 403);
    case "plafond":
      return new RefusLiaison(code, "Trop d'envois en peu de temps : patientez avant de reprendre.", 429, attendre ?? 60);
    default:
      return new RefusLiaison("hub_refus", "Veridian a refusé cet envoi. Réessayez, puis signalez-le si cela continue.", 502);
  }
}
