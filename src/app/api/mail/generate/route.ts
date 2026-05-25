/**
 * /api/mail/generate — POST.
 *
 * Génère un mail (subject + body) personnalisé pour UN prospect via le
 * LLM configuré par le tenant (BYO clé). Endpoint cœur du différenciateur
 * mail IA Veridian.
 *
 * Flow :
 *  1. requireUser + résolution tenant
 *  2. Charge TenantAiConfig → 412 si pas configuré (UI invite admin)
 *  3. Charge Entreprise(siren) → 404 si introuvable
 *  4. Charge timeline 360° (5 derniers events)
 *  5. Build prompt (system stable + user enrichi)
 *  6. Appelle adapter.generateText
 *  7. Parse JSON {subject, body} → 502 si LLM a hallucinét
 *  8. Update lastUsedAt + tokens (fire-and-forget)
 *  9. Retourne { subject, body_text, body_html, tokens_used, model_used }
 *
 * Rate limit : 30 / min / user (LLM call ≠ gratuit).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { isRateLimited } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getAiConfigInternal, recordAiUsage } from "@/lib/ai/queries";
import { getAdapter, AiAdapterError } from "@/lib/ai/adapter";
import {
  buildPrompt,
  parseGeneratedMail,
  type MailObjective,
  type MailTone,
  type MailLocale,
  type ContactContext,
  type ProspectContext,
  type TimelineEventCtx,
} from "@/lib/ai/prompt-builder";
import { getProspectTimeline } from "@/lib/queries/timeline";

const generateSchema = z.object({
  siren: z.string().regex(/^\d{9}$/),
  objective: z.enum(["intro", "relance", "demo", "follow_rdv"]),
  tone: z.enum(["formel", "friendly", "expert"]),
  /** Override de la locale par défaut configurée côté TenantAiConfig. */
  locale: z.enum(["fr", "en"]).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (isRateLimited(`mail-generate:${auth.user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const config = await getAiConfigInternal(tenantId);
  if (!config) {
    return NextResponse.json(
      {
        error: "AI not configured",
        reason: "not_configured",
        hint: "Ask your tenant admin to set up the AI provider in Settings › Mail › IA",
      },
      { status: 412 },
    );
  }

  const ent = await prisma.entreprise.findUnique({ where: { siren: input.siren } });
  if (!ent) {
    return NextResponse.json({ error: "SIREN not found" }, { status: 404 });
  }

  // ─── Contexte prospect ────────────────────────────────────────────────
  const prospectCtx: ProspectContext = {
    siren: ent.siren,
    denomination: ent.denomination,
    formeJuridique: ent.formeJuridique,
    codeNaf: ent.codeNaf,
    nafLibelle: ent.nafLibelle,
    secteurFinal: ent.secteurFinal,
    domaineFinal: ent.domaineFinal,
    trancheEffectifs: ent.trancheEffectifs,
    prospectScore: ent.prospectScore,
    prospectTier: ent.prospectTier,
    webObsolescenceScore: ent.webObsolescenceScore,
    webTechScore: ent.webTechScore,
    webCms: ent.webCms,
    webHasHttps: ent.webHasHttps,
    webHasResponsive: ent.webHasResponsive,
    webCopyrightYear: ent.webCopyrightYear,
    adresse: ent.adresse,
    commune: ent.commune,
    departement: ent.departement,
    nbMarchesPublics: ent.nbMarchesPublics,
  };

  // ─── Contacts ─────────────────────────────────────────────────────────
  // Pas de table contacts dédiée v1 — on construit depuis les champs
  // dirigeant* + bestEmail de la table entreprises. Quand v2 introduira
  // une vraie table prospect_contacts, on enrichira ici.
  const contacts: ContactContext[] = [];
  const dirigName = [ent.dirigeantPrenom, ent.dirigeantNom].filter(Boolean).join(" ");
  if (dirigName || ent.bestEmailNormalized) {
    contacts.push({
      name: dirigName || null,
      role: ent.dirigeantQualite,
      email: ent.bestEmailNormalized,
    });
  }

  // ─── Timeline 360° ────────────────────────────────────────────────────
  const timelineRaw = await getProspectTimeline({
    siren: input.siren,
    tenantId,
    workspaceFilter: null, // L'auth a déjà été vérifiée; on prend la vue tenant complète.
    limit: 5,
  });

  const recentTimeline: TimelineEventCtx[] = timelineRaw.map((ev): TimelineEventCtx => {
    switch (ev.type) {
      case "pipeline_transition":
        return {
          type: "pipeline_transition",
          occurredAt: ev.occurredAt,
          summary: `transition: ${ev.fromStage ?? "(start)"} → ${ev.toStage}`,
        };
      case "followup":
        return {
          type: "followup",
          occurredAt: ev.occurredAt,
          summary: `followup ${ev.status}${ev.note ? `: ${ev.note.slice(0, 80)}` : ""}`,
        };
      case "appointment":
        return {
          type: "appointment",
          occurredAt: ev.occurredAt,
          summary: `RDV ${ev.title} (${ev.status})${ev.notes ? `: ${ev.notes.slice(0, 80)}` : ""}`,
        };
      case "mail_out":
        return {
          type: "email_outgoing",
          occurredAt: ev.occurredAt,
          summary: `mail envoyé: ${ev.subject ?? "(sans objet)"} (${ev.status})`,
        };
      case "call":
        return {
          type: "call",
          occurredAt: ev.occurredAt,
          summary: `appel ${ev.direction} (${ev.status})${ev.durationSeconds ? ` ${ev.durationSeconds}s` : ""}`,
        };
    }
  });

  // ─── Build prompt ─────────────────────────────────────────────────────
  const { system, user } = buildPrompt({
    prospect: prospectCtx,
    contacts,
    recentTimeline,
    objective: input.objective as MailObjective,
    tone: input.tone as MailTone,
    locale: (input.locale ?? config.defaultLocale) as MailLocale,
    senderName: auth.user.email.split("@")[0] || null,
  });

  // ─── Appel LLM ────────────────────────────────────────────────────────
  let raw: string;
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const adapter = getAdapter({
      provider: config.provider,
      model: config.model,
      apiKeyEnc: config.apiKeyEnc,
    });
    const result = await adapter.generateText(user, {
      system,
      maxTokens: 2000,
      temperature: 0.7,
    });
    raw = result.text;
    tokensIn = result.tokensIn;
    tokensOut = result.tokensOut;
  } catch (err) {
    if (err instanceof AiAdapterError) {
      const status = err.kind === "auth" ? 401 : err.kind === "rate" ? 429 : err.kind === "server" ? 502 : 400;
      return NextResponse.json(
        { error: err.message, reason: err.kind, providerStatus: err.statusFromProvider },
        { status },
      );
    }
    console.error("[mail/generate] adapter unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error", reason: "unknown" },
      { status: 500 },
    );
  }

  // ─── Parse réponse JSON ───────────────────────────────────────────────
  let subject: string;
  let body_text: string;
  try {
    const parsedMail = parseGeneratedMail(raw);
    subject = parsedMail.subject;
    body_text = parsedMail.body;
  } catch (err) {
    console.error("[mail/generate] parse error:", err, "raw:", raw.slice(0, 500));
    return NextResponse.json(
      {
        error: "LLM returned unparsable response",
        reason: "parse_failed",
        rawPreview: raw.slice(0, 500),
      },
      { status: 502 },
    );
  }

  // body_html = passe simple text→html (l'utilisateur va éditer avant envoi
  // de toute façon, le HTML "riche" ne sert que pour le rendu mail final).
  const body_html = `<p>${body_text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>")}</p>`;

  // ─── Métriques fire-and-forget ────────────────────────────────────────
  void recordAiUsage(tenantId, tokensIn, tokensOut);
  void logAudit({
    tenantId,
    actorType: "user",
    actorId: auth.user.id,
    action: "mail.ai_generated",
    targetType: "prospect",
    targetId: input.siren,
    metadata: {
      provider: config.provider,
      model: config.model,
      objective: input.objective,
      tone: input.tone,
      tokensIn,
      tokensOut,
    },
  });

  return NextResponse.json({
    subject,
    body_text,
    body_html,
    tokens_used: { in: tokensIn, out: tokensOut },
    model_used: config.model,
    provider_used: config.provider,
  });
}
