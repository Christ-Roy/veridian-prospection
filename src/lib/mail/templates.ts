/**
 * Templates mail v1 — variables liquid simples ({{ var }}).
 *
 * Cadrage Robert 2026-05-23 : pas de moteur liquid full (Shopify/LiquidJS).
 * On reste sur un remplacement `{{ key }}` exact, pas de filtres, pas de
 * conditions. Si le besoin évolue (ex: capitalize, default), basculer sur
 * `liquidjs` quand v2 IMAP introduira le replay côté incoming.
 *
 * 2 templates Veridian de base livrés en v1 :
 *  - "relance-commerciale-v1" : suivi après 1er contact silencieux
 *  - "demo-prospection-v1"    : prise de rendez-vous démo
 *
 * Les templates sont en dur dans le code (pas en DB) parce qu'on veut
 * itérer dessus via git (review, A/B futur). v2 : table tenant_mail_templates
 * pour permettre customisation par tenant.
 */

export interface MailTemplate {
  slug: string;
  /** Libellé UI affiché dans le dropdown "Choisir un template". */
  label: string;
  subject: string;
  /** Corps texte brut — toujours produit pour le fallback plain text. */
  bodyText: string;
  /** Corps HTML simple — `<p>`, `<br>`, pas de CSS lourd. */
  bodyHtml: string;
}

export const MAIL_TEMPLATES: Record<string, MailTemplate> = {
  "relance-commerciale-v1": {
    slug: "relance-commerciale-v1",
    label: "Relance commerciale",
    subject: "Suite à notre échange — {{ prospect.entreprise }}",
    bodyText:
      "Bonjour {{ prospect.name }},\n\n" +
      "Je reviens vers vous suite à notre premier contact concernant " +
      "{{ prospect.entreprise }}. Avez-vous eu l'occasion de regarder " +
      "notre proposition ?\n\n" +
      "Je reste à votre disposition pour toute question.\n\n" +
      "Cordialement,\n" +
      "{{ sender.name }}",
    bodyHtml:
      "<p>Bonjour {{ prospect.name }},</p>" +
      "<p>Je reviens vers vous suite à notre premier contact concernant " +
      "<strong>{{ prospect.entreprise }}</strong>. Avez-vous eu l'occasion " +
      "de regarder notre proposition ?</p>" +
      "<p>Je reste à votre disposition pour toute question.</p>" +
      "<p>Cordialement,<br>{{ sender.name }}</p>",
  },
  "demo-prospection-v1": {
    slug: "demo-prospection-v1",
    label: "Proposition de démo",
    subject: "Démo Veridian Prospection — {{ prospect.entreprise }}",
    bodyText:
      "Bonjour {{ prospect.name }},\n\n" +
      "Suite à mon analyse de {{ prospect.entreprise }}, je pense que " +
      "notre solution Veridian pourrait vous faire gagner un temps " +
      "significatif sur votre prospection commerciale.\n\n" +
      "Auriez-vous 20 minutes cette semaine pour une démo ? Je peux " +
      "m'adapter à votre agenda.\n\n" +
      "Cordialement,\n" +
      "{{ sender.name }}",
    bodyHtml:
      "<p>Bonjour {{ prospect.name }},</p>" +
      "<p>Suite à mon analyse de <strong>{{ prospect.entreprise }}</strong>, " +
      "je pense que notre solution Veridian pourrait vous faire gagner un " +
      "temps significatif sur votre prospection commerciale.</p>" +
      "<p>Auriez-vous 20 minutes cette semaine pour une démo ? Je peux " +
      "m'adapter à votre agenda.</p>" +
      "<p>Cordialement,<br>{{ sender.name }}</p>",
  },
};

export interface TemplateVars {
  prospect: {
    name: string;
    entreprise: string;
  };
  sender: {
    name: string;
    email: string;
  };
}

/**
 * Remplace les `{{ key.subkey }}` par leur valeur. Whitespace toléré
 * autour de la clé ({{ x }}, {{x}}, {{  x  }}). Pas de filtres liquid.
 *
 * Si une variable n'est pas trouvée, on laisse le `{{ ... }}` brut —
 * l'envoyeur le verra dans la preview et corrigera. Pas de throw : un
 * template avec variable manquante ne doit pas bloquer un send.
 */
export function renderTemplate(
  source: string,
  vars: TemplateVars,
): string {
  return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path: string) => {
    const segments = path.split(".");
    let cur: unknown = vars;
    for (const seg of segments) {
      if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        return match;
      }
    }
    return typeof cur === "string" ? cur : match;
  });
}

/** Retourne la liste des templates pour l'UI (dropdown compose). */
export function listTemplates(): Array<Pick<MailTemplate, "slug" | "label">> {
  return Object.values(MAIL_TEMPLATES).map(({ slug, label }) => ({
    slug,
    label,
  }));
}

/** Retourne un template par slug, ou null si inconnu. */
export function getTemplate(slug: string): MailTemplate | null {
  return MAIL_TEMPLATES[slug] ?? null;
}
