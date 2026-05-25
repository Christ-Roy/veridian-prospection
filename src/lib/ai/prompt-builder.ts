/**
 * Prompt builder — assemble un prompt LLM riche à partir du contexte
 * prospect (entreprise + contacts + timeline 360°) + paramètres user
 * (objectif, ton, locale).
 *
 * Philosophie : on shippe TOUT ce qu'on sait au LLM. Plus le contexte
 * est riche, plus le mail sera personnalisé. Le différenciateur Veridian
 * c'est justement d'avoir ces données (SIREN + scoring + timeline).
 *
 * Format de sortie attendu du LLM : JSON strict
 *   { "subject": "...", "body": "..." }
 *
 * On force ce shape via le system prompt (pas de tool use parce que
 * tous les providers ne le supportent pas uniformément, et c'est plus
 * simple à mocker dans les tests).
 */

export type MailObjective = "intro" | "relance" | "demo" | "follow_rdv";
export type MailTone = "formel" | "friendly" | "expert";
export type MailLocale = "fr" | "en";

export interface ProspectContext {
  siren: string;
  denomination: string | null;
  formeJuridique: string | null;
  codeNaf: string | null;
  nafLibelle: string | null;
  secteurFinal: string | null;
  domaineFinal: string | null;
  trancheEffectifs: string | null;
  prospectScore: number | null;
  prospectTier: string | null;
  /** Score 0-100 — plus haut = plus de dette tech (signal "site à refaire"). */
  webObsolescenceScore: number | null;
  webTechScore: number | null;
  webCms: string | null;
  webHasHttps: boolean | null;
  webHasResponsive: boolean | null;
  webCopyrightYear: number | null;
  adresse: string | null;
  commune: string | null;
  departement: string | null;
  /** Signaux business (marchés publics, etc.). */
  nbMarchesPublics: number | null;
}

export interface ContactContext {
  name: string | null;
  role: string | null;
  email: string | null;
}

export interface TimelineEventCtx {
  type: "pipeline_transition" | "followup" | "appointment" | "email_outgoing";
  occurredAt: string;
  /** Description courte ("transition: a_qualifier → qualifie", "mail: Relance v2", …). */
  summary: string;
}

export interface BuildPromptParams {
  prospect: ProspectContext;
  contacts: ContactContext[];
  /** 5 derniers events tous types confondus (timeline 360°). */
  recentTimeline: TimelineEventCtx[];
  objective: MailObjective;
  tone: MailTone;
  locale: MailLocale;
  /** Nom du commercial qui signe (optionnel — l'IA peut écrire "Cordialement" sans nom). */
  senderName?: string | null;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

/**
 * System prompt — STABLE entre les appels, pour bénéficier du prompt
 * caching côté Anthropic. Ne JAMAIS injecter de variable {{ prospect }}
 * ici, sinon le cache est invalidé à chaque appel.
 */
function buildSystemPrompt(): string {
  return `Tu es un commercial B2B francophone expert en mails de prospection ultra-ciblés.

Ta mission : écrire UN mail de prospection commercial pour CE prospect précis, en t'appuyant strictement sur le contexte fourni (secteur, taille, signaux tech, historique des échanges). Le mail doit être :

- COURT (3-6 phrases max corps + 1-2 mots accroche en sujet)
- PERSONNALISÉ (cite au moins 1 élément spécifique du contexte : secteur, ville, signal tech, étape précédente du pipeline)
- JAMAIS GÉNÉRIQUE ("Bonjour, nous proposons des solutions innovantes" = banni)
- HUMAIN (jamais "En tant qu'IA", jamais d'emojis excessifs, jamais de "n'hésitez pas à me contacter")
- ACTIONNABLE (1 seule demande claire : "vous êtes dispo 15 min mardi ?", pas "n'hésitez pas si vous voulez en savoir plus")

Tu reçois en entrée :
  1. Un objectif (intro / relance / demo / follow_rdv)
  2. Un ton (formel / friendly / expert)
  3. La locale (fr / en)
  4. Le contexte prospect (entreprise + contacts identifiés)
  5. La timeline 360° (5 derniers échanges)

Tu RÉPONDS EXCLUSIVEMENT par un JSON valide, SANS markdown, SANS texte avant ni après :
  { "subject": "<sujet 4-10 mots>", "body": "<corps du mail, saut de ligne = \\n>" }

Pas de \`\`\`json fences. Pas de commentaires. JSON brut.`;
}

/** Compacte un objet en lignes "clé : valeur" lisibles par le LLM, en sautant les nulls. */
function fmtKV(label: string, value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return `  - ${label} : ${value}`;
}

function fmtProspect(p: ProspectContext): string {
  const lines = [
    fmtKV("SIREN", p.siren),
    fmtKV("Dénomination", p.denomination),
    fmtKV("Forme juridique", p.formeJuridique),
    fmtKV("Secteur", p.secteurFinal ?? p.nafLibelle),
    fmtKV("Domaine", p.domaineFinal),
    fmtKV("Code NAF", p.codeNaf),
    fmtKV("Effectif", p.trancheEffectifs),
    fmtKV("Score prospect (0-100)", p.prospectScore),
    fmtKV("Tier prospect", p.prospectTier),
    fmtKV("Score obsolescence web (0-100, + haut = site daté)", p.webObsolescenceScore),
    fmtKV("Score tech web (0-100, + haut = stack moderne)", p.webTechScore),
    fmtKV("CMS détecté", p.webCms),
    fmtKV("HTTPS", p.webHasHttps),
    fmtKV("Responsive mobile", p.webHasResponsive),
    fmtKV("Année copyright affichée", p.webCopyrightYear),
    fmtKV("Adresse", p.adresse),
    fmtKV("Commune", p.commune),
    fmtKV("Département", p.departement),
    fmtKV("Nb marchés publics", p.nbMarchesPublics),
  ].filter((l): l is string => l !== null);
  return lines.length > 0 ? lines.join("\n") : "  (pas de données enrichies)";
}

function fmtContacts(contacts: ContactContext[]): string {
  if (contacts.length === 0) return "  (aucun contact identifié)";
  return contacts
    .slice(0, 5)
    .map((c, i) => {
      const parts = [c.name, c.role, c.email].filter(Boolean);
      return `  ${i + 1}. ${parts.join(" — ") || "(anonyme)"}`;
    })
    .join("\n");
}

function fmtTimeline(events: TimelineEventCtx[]): string {
  if (events.length === 0) return "  (premier contact — aucun échange précédent)";
  return events
    .slice(0, 5)
    .map((e) => `  - ${e.occurredAt.slice(0, 10)} [${e.type}] ${e.summary}`)
    .join("\n");
}

const OBJECTIVE_LABELS: Record<MailObjective, string> = {
  intro: "Première prise de contact (le prospect ne nous connaît pas)",
  relance: "Relance suite à un mail/contact sans réponse",
  demo: "Proposer une démo / réunion produit",
  follow_rdv: "Suite d'un RDV ou d'un échange récent (récap + next step)",
};

const TONE_LABELS: Record<MailTone, string> = {
  formel: "Formel et respectueux (vouvoiement, pas de familiarités)",
  friendly: "Friendly et direct (vouvoiement mais ton décontracté)",
  expert: "Expert et technique (jargon métier OK, on parle à un connaisseur)",
};

const LOCALE_LABELS: Record<MailLocale, string> = {
  fr: "Français",
  en: "English",
};

/**
 * Build le couple (system, user) prompt pour le LLM.
 *
 * Le system prompt est CONSTANT — il bénéficie du prompt caching côté
 * Anthropic. Le user prompt change à chaque appel (contexte prospect).
 */
export function buildPrompt(params: BuildPromptParams): BuiltPrompt {
  const { prospect, contacts, recentTimeline, objective, tone, locale, senderName } = params;

  const user = `# Paramètres du mail à générer

- Objectif : ${OBJECTIVE_LABELS[objective]}
- Ton : ${TONE_LABELS[tone]}
- Langue : ${LOCALE_LABELS[locale]}
- Signature : ${senderName ?? "(aucune signature spécifique — utilise une formule générique)"}

# Contexte entreprise prospect

${fmtProspect(prospect)}

# Contacts identifiés dans cette entreprise

${fmtContacts(contacts)}

# Timeline 360° — 5 derniers événements (du plus récent au plus ancien)

${fmtTimeline(recentTimeline)}

# Ta tâche

Génère le mail (subject + body) au format JSON strict décrit dans tes instructions système. Personnalise au moins UN élément spécifique du contexte ci-dessus.`;

  return {
    system: buildSystemPrompt(),
    user,
  };
}

/**
 * Parse la réponse brute du LLM en { subject, body }.
 *
 * Gère :
 *   - JSON pur (cas normal)
 *   - JSON entouré de \`\`\`json fences (cas dégradé certains models)
 *   - JSON entouré de prose ("Voici le mail :\n{...}")
 *
 * Throw si rien d'exploitable n'est trouvé.
 */
export function parseGeneratedMail(raw: string): { subject: string; body: string } {
  const trimmed = raw.trim();

  // Tentative 1 : JSON pur.
  const parsed = tryParseJson(trimmed);
  if (parsed) return parsed;

  // Tentative 2 : strip ```json fences.
  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  if (fenced !== trimmed) {
    const parsed2 = tryParseJson(fenced);
    if (parsed2) return parsed2;
  }

  // Tentative 3 : extraire le premier {...} balanced.
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    const parsed3 = tryParseJson(match[0]);
    if (parsed3) return parsed3;
  }

  throw new Error("LLM response is not valid JSON with {subject, body}");
}

function tryParseJson(s: string): { subject: string; body: string } | null {
  try {
    const obj = JSON.parse(s) as unknown;
    if (
      obj &&
      typeof obj === "object" &&
      "subject" in obj &&
      "body" in obj &&
      typeof (obj as Record<string, unknown>).subject === "string" &&
      typeof (obj as Record<string, unknown>).body === "string"
    ) {
      const cast = obj as { subject: string; body: string };
      return { subject: cast.subject, body: cast.body };
    }
    return null;
  } catch {
    return null;
  }
}
