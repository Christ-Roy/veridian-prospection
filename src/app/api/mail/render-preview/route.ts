/**
 * POST /api/mail/render-preview — aperçu d'un mail avant envoi.
 *
 * Cf ticket follow-ups §I. Reçoit { templateSlug?, subject?, bodyText?, bodyHtml?,
 * vars{prospect,sender?}, includeSignature? } et retourne le rendu final
 * (subject + bodyHtml + bodyText) avec :
 *   - rendu liquid simple ({{ var }}) sur subject/body
 *   - append signature (si includeSignature true et configurée)
 *
 * Évite l'envoi avec `{{ var }}` non remplacée — l'UI affiche le rendu dans
 * une iframe sandboxée (sandbox="allow-same-origin") pour preview HTML.
 *
 * NB : retourne HTML brut. Le sandbox côté iframe + le statut user-only
 * (pas d'exposition publique) suffisent comme garde-fou — on n'inline pas
 * de scripts dans bodyHtml puisque le user a édité son propre contenu.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { resolveTemplate } from "@/lib/mail/tenant-templates";
import { renderTemplate, type TemplateVars } from "@/lib/mail/templates";
import { getMailConfigPublic } from "@/lib/mail/queries";

const previewSchema = z
  .object({
    templateSlug: z.string().max(64).nullable().optional(),
    subject: z.string().max(500).optional(),
    bodyText: z.string().max(50_000).optional(),
    bodyHtml: z.string().max(100_000).optional(),
    vars: z.object({
      prospect: z.object({
        name: z.string().max(200),
        entreprise: z.string().max(200),
      }),
      sender: z
        .object({
          name: z.string().max(200),
          email: z.string().email().max(320),
        })
        .optional(),
    }),
    /** Préviser avec la signature active ? Default false (preview pur). */
    includeSignature: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.templateSlug || !!(d.subject && (d.bodyText || d.bodyHtml)),
    {
      message:
        "Either templateSlug OR (subject+bodyText/bodyHtml) is required",
    },
  );

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Résout les vars sender depuis la config mail si pas fournies par le client.
  const cfg = await getMailConfigPublic(tenantId);
  const sender = input.vars.sender ?? {
    name: cfg?.fromName ?? auth.user.email,
    email: cfg?.fromEmail ?? auth.user.email,
  };
  const vars: TemplateVars = {
    prospect: input.vars.prospect,
    sender,
  };

  // Rendu : template OU compose libre.
  let subject: string;
  let bodyText: string;
  let bodyHtml: string;
  if (input.templateSlug) {
    const tpl = await resolveTemplate(tenantId, input.templateSlug);
    if (!tpl) {
      return NextResponse.json(
        { error: "Unknown template", templateSlug: input.templateSlug },
        { status: 400 },
      );
    }
    subject = renderTemplate(tpl.subject, vars);
    bodyText = renderTemplate(tpl.bodyText, vars);
    bodyHtml = renderTemplate(tpl.bodyHtml, vars);
  } else {
    subject = renderTemplate(input.subject ?? "", vars);
    bodyText = renderTemplate(input.bodyText ?? "", vars);
    bodyHtml = input.bodyHtml
      ? renderTemplate(input.bodyHtml, vars)
      : `<p>${bodyText.replace(/\n/g, "<br>")}</p>`;
  }

  // Append signature si demandée + configurée + activée.
  if (input.includeSignature && cfg?.mailSignatureEnabled && cfg.mailSignatureHtml) {
    const sig = cfg.mailSignatureHtml.trim();
    if (sig) {
      bodyHtml = `${bodyHtml}<br><br><div class="veridian-mail-signature">${sig}</div>`;
      bodyText = `${bodyText}\n\n--\n${stripHtml(sig)}`;
    }
  }

  // Détecte les variables non-substituées — l'UI affiche un warning.
  const unresolvedVars = detectUnresolvedVars(`${subject}\n${bodyText}\n${bodyHtml}`);

  return NextResponse.json({
    subject,
    bodyText,
    bodyHtml,
    unresolvedVars,
  });
}

function detectUnresolvedVars(text: string): string[] {
  const matches = text.match(/\{\{\s*([\w.]+)\s*\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.replace(/[{}\s]/g, ""))));
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
