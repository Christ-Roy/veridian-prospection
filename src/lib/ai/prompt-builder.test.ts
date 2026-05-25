/**
 * Unit tests — prompt-builder.
 *
 * Couvre :
 *   - Le system prompt est STABLE entre 2 appels (pour le cache Anthropic).
 *   - Le user prompt embarque les variables contexte (denomination, secteur,
 *     score, contacts, timeline).
 *   - parseGeneratedMail : JSON pur, ```json fences, prose autour.
 */
import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  parseGeneratedMail,
  type ProspectContext,
  type ContactContext,
  type TimelineEventCtx,
} from "./prompt-builder";

const prospect: ProspectContext = {
  siren: "123456789",
  denomination: "ACME PLOMBERIE",
  formeJuridique: "SARL",
  codeNaf: "4322A",
  nafLibelle: "Travaux d'installation d'eau et de gaz",
  secteurFinal: "Plomberie / Chauffage",
  domaineFinal: "BTP",
  trancheEffectifs: "10 à 19 salariés",
  prospectScore: 87,
  prospectTier: "A",
  webObsolescenceScore: 72,
  webTechScore: 18,
  webCms: "WordPress 4.x",
  webHasHttps: false,
  webHasResponsive: false,
  webCopyrightYear: 2014,
  adresse: "12 rue de la Paix",
  commune: "Lyon",
  departement: "Rhône",
  nbMarchesPublics: 3,
};

const contacts: ContactContext[] = [
  { name: "Jean Dupont", role: "Gérant", email: "jean@acme.fr" },
];

const timeline: TimelineEventCtx[] = [
  {
    type: "pipeline_transition",
    occurredAt: "2026-05-20T10:00:00Z",
    summary: "transition: a_contacter → contacte",
  },
  {
    type: "appointment",
    occurredAt: "2026-05-18T14:00:00Z",
    summary: "RDV demo (planifié)",
  },
];

describe("buildPrompt", () => {
  it("system prompt est IDENTIQUE entre 2 appels (cache Anthropic)", () => {
    const a = buildPrompt({
      prospect,
      contacts,
      recentTimeline: timeline,
      objective: "intro",
      tone: "formel",
      locale: "fr",
    });
    const b = buildPrompt({
      prospect: { ...prospect, denomination: "AUTRE BOITE" },
      contacts: [],
      recentTimeline: [],
      objective: "demo",
      tone: "expert",
      locale: "en",
    });
    expect(a.system).toBe(b.system);
  });

  it("user prompt embarque la dénomination + secteur + score", () => {
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: timeline,
      objective: "intro",
      tone: "formel",
      locale: "fr",
    });
    expect(user).toContain("ACME PLOMBERIE");
    expect(user).toContain("Plomberie / Chauffage");
    expect(user).toContain("87");
    expect(user).toContain("Lyon");
  });

  it("user prompt embarque les signaux tech (obsolescence, CMS, year)", () => {
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: timeline,
      objective: "demo",
      tone: "expert",
      locale: "fr",
    });
    expect(user).toContain("72"); // webObsolescenceScore
    expect(user).toContain("WordPress");
    expect(user).toContain("2014");
  });

  it("user prompt liste les contacts identifiés", () => {
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: timeline,
      objective: "intro",
      tone: "formel",
      locale: "fr",
    });
    expect(user).toContain("Jean Dupont");
    expect(user).toContain("Gérant");
    expect(user).toContain("jean@acme.fr");
  });

  it("user prompt liste la timeline avec dates", () => {
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: timeline,
      objective: "relance",
      tone: "friendly",
      locale: "fr",
    });
    expect(user).toContain("2026-05-20");
    expect(user).toContain("pipeline_transition");
    expect(user).toContain("RDV demo");
  });

  it("contacts vides → '(aucun contact identifié)'", () => {
    const { user } = buildPrompt({
      prospect,
      contacts: [],
      recentTimeline: [],
      objective: "intro",
      tone: "formel",
      locale: "fr",
    });
    expect(user).toContain("aucun contact identifié");
  });

  it("timeline vide → mention premier contact", () => {
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: [],
      objective: "intro",
      tone: "formel",
      locale: "fr",
    });
    expect(user).toContain("premier contact");
  });

  it("passe l'objectif et le ton en clair au user prompt", () => {
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: [],
      objective: "follow_rdv",
      tone: "expert",
      locale: "en",
    });
    expect(user).toContain("RDV"); // objectif suite RDV
    expect(user).toContain("Expert"); // tone label
    expect(user).toContain("English"); // locale
  });

  it("locale=en → libellé English dans le user prompt", () => {
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: [],
      objective: "intro",
      tone: "formel",
      locale: "en",
    });
    expect(user).toContain("English");
  });

  // ── Phase 2/3 timeline 360° ───────────────────────────────────────────
  // L'extension de TimelineEventCtx ajoute 'email_outgoing' (mail v1/v2)
  // et 'call' (Telnyx). On verrouille ici que :
  //  1. Le builder accepte ces 2 nouveaux types sans planter
  //  2. Les summaries sont injectés tels quels (l'IA voit l'historique mail/call)
  //  3. Le tag `[type]` est rendu dans le prompt — pas de leak du type interne
  //     (ex: `[mail_out]` qui serait incohérent avec le contrat IA)

  it("timeline avec email_outgoing → summary mail injecté + tag email_outgoing visible", () => {
    const tl: TimelineEventCtx[] = [
      {
        type: "email_outgoing",
        occurredAt: "2026-05-22T09:30:00Z",
        summary: "mail envoyé: Bonjour Robert — démo Veridian (sent)",
      },
    ];
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: tl,
      objective: "relance",
      tone: "friendly",
      locale: "fr",
    });
    expect(user).toContain("2026-05-22");
    expect(user).toContain("[email_outgoing]");
    expect(user).toContain("Bonjour Robert");
    expect(user).toContain("démo Veridian");
  });

  it("timeline avec call → summary appel injecté + tag call visible", () => {
    const tl: TimelineEventCtx[] = [
      {
        type: "call",
        occurredAt: "2026-05-24T14:15:00Z",
        summary: "appel outbound (completed) 195s",
      },
    ];
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: tl,
      objective: "follow_rdv",
      tone: "expert",
      locale: "fr",
    });
    expect(user).toContain("2026-05-24");
    expect(user).toContain("[call]");
    expect(user).toContain("appel outbound");
    expect(user).toContain("195s");
  });

  it("timeline mixte (transition + email_outgoing + call) → tous rendus", () => {
    const tl: TimelineEventCtx[] = [
      {
        type: "pipeline_transition",
        occurredAt: "2026-05-20T10:00:00Z",
        summary: "transition: a_contacter → contacte",
      },
      {
        type: "email_outgoing",
        occurredAt: "2026-05-22T09:30:00Z",
        summary: "mail envoyé: Suite à notre échange (sent)",
      },
      {
        type: "call",
        occurredAt: "2026-05-24T14:15:00Z",
        summary: "appel outbound (completed) 60s",
      },
    ];
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: tl,
      objective: "follow_rdv",
      tone: "formel",
      locale: "fr",
    });
    // Tous les types rendus
    expect(user).toContain("[pipeline_transition]");
    expect(user).toContain("[email_outgoing]");
    expect(user).toContain("[call]");
    // Tous les summaries présents
    expect(user).toContain("a_contacter");
    expect(user).toContain("Suite à notre échange");
    expect(user).toContain("appel outbound");
  });

  it("timeline > 5 events → seulement les 5 premiers rendus (cap dur builder)", () => {
    const tl: TimelineEventCtx[] = Array.from({ length: 8 }, (_, i) => ({
      type: "email_outgoing" as const,
      occurredAt: `2026-05-${(20 + i).toString().padStart(2, "0")}T10:00:00Z`,
      summary: `mail ${i}`,
    }));
    const { user } = buildPrompt({
      prospect,
      contacts,
      recentTimeline: tl,
      objective: "relance",
      tone: "formel",
      locale: "fr",
    });
    // 5 premiers présents, 6e absent (cap = .slice(0, 5))
    expect(user).toContain("mail 0");
    expect(user).toContain("mail 4");
    expect(user).not.toContain("mail 5");
    expect(user).not.toContain("mail 7");
  });
});

describe("parseGeneratedMail", () => {
  it("parse un JSON pur", () => {
    const r = parseGeneratedMail('{"subject":"Hello","body":"World"}');
    expect(r).toEqual({ subject: "Hello", body: "World" });
  });

  it("strip les fences ```json", () => {
    const r = parseGeneratedMail('```json\n{"subject":"S","body":"B"}\n```');
    expect(r).toEqual({ subject: "S", body: "B" });
  });

  it("strip les fences ``` (sans json)", () => {
    const r = parseGeneratedMail('```\n{"subject":"S","body":"B"}\n```');
    expect(r).toEqual({ subject: "S", body: "B" });
  });

  it("extrait le JSON depuis de la prose autour", () => {
    const r = parseGeneratedMail('Voici le mail :\n{"subject":"S","body":"B"}\nVoilà.');
    expect(r).toEqual({ subject: "S", body: "B" });
  });

  it("throw si pas de JSON valide", () => {
    expect(() => parseGeneratedMail("juste du texte sans json")).toThrow();
  });

  it("throw si le JSON manque subject ou body", () => {
    expect(() => parseGeneratedMail('{"subject":"only"}')).toThrow();
    expect(() => parseGeneratedMail('{"body":"only"}')).toThrow();
  });

  it("throw si subject/body ne sont pas des string", () => {
    expect(() => parseGeneratedMail('{"subject":42,"body":"x"}')).toThrow();
  });
});
