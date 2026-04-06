import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

/**
 * POST /api/outreach/test-send
 * Envoie un email de test à robert.brunon@veridian.site
 * pour vérifier que le pipeline d'envoi fonctionne.
 *
 * Body: { subject?, body? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  // TODO: pass tenantId when query supports it
  await getTenantId(auth.user.id);

  const body = await request.json().catch(() => ({}));

  const to = "robert.brunon@veridian.site";
  const subject = body.subject || `[TEST] Envoi test pipeline - ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`;
  const emailBody =
    body.body ||
    `Ceci est un email de test envoyé via l'API dashboard.\n\nSi tu reçois ce message, le pipeline d'envoi fonctionne correctement.\n\nRobert Brunon\nConseil en stratégie digitale | Région Sud\nveridian.site`;

  const fromName = "Robert Brunon";
  const fromEmail = "robert.brunon@veridian.site";
  const emailTemplate = `From: ${fromName} <${fromEmail}>
To: ${to}
Subject: ${subject}

${emailBody}`;

  try {
    // IMAP warm-up pre-envoi
    try {
      execSync(`himalaya list -a lark -f INBOX -s 1-5`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15000,
      });
    } catch {
      // warm-up best effort
    }

    // Envoi
    execSync(`himalaya template send -a lark`, {
      input: emailTemplate,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // IMAP warm-up post-envoi
    try {
      execSync(`himalaya list -a lark -f Envoyés -s 1-3`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15000,
      });
    } catch {
      // warm-up best effort
    }

    return NextResponse.json(
      { ok: true, to, subject, message: "Email de test envoyé avec succès" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Erreur envoi test:", error);
    return NextResponse.json(
      {
        error: `Erreur lors de l'envoi test: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}
