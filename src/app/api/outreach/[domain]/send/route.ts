import { NextRequest, NextResponse } from "next/server";
import { updateOutreach, addClaudeActivity, addFollowup, addOutreachEmail } from "@/lib/queries";
import { prisma } from "@/lib/prisma";
import { invalidate } from "@/lib/cache";
import { execSync } from "child_process";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { insertId } = await getWorkspaceScope();
  // URL param named `domain` for back-compat but now carries a SIREN
  const { domain: siren } = await params;
  const body = await request.json();

  const { to, subject, body: emailBody, from_name } = body;

  if (!to || !subject || !emailBody) {
    return NextResponse.json(
      { error: "to, subject, and body are required" },
      { status: 400 }
    );
  }

  const fromName = from_name || "Robert Brunon";
  const fromEmail = "robert.brunon@veridian.site";
  const emailTemplate = `From: ${fromName} <${fromEmail}>
To: ${to}
Subject: ${subject}

${emailBody}`;

  try {
    // IMAP warm-up pre-envoi (simule activite humaine)
    try {
      execSync(`himalaya list -a lark -f INBOX -s 1-5`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 15000,
      });
    } catch {
      // warm-up best effort
    }

    // Execute himalaya template send
    execSync(`himalaya template send -a lark`, {
      input: emailTemplate,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Store email in outreach_emails
    const messageId = `sent-${Date.now()}`;
    await addOutreachEmail({
      siren,
      to_email: to,
      subject,
      body_text: emailBody,
      message_id: messageId,
    }, tenantId);

    // Update outreach status (preserve existing qualification and notes)
    const now = new Date().toISOString().replace("T", " ").split(".")[0];
    const existing = await prisma.outreach.findFirst({
      where: { siren, tenantId: tenantId ?? undefined },
      select: { qualification: true, notes: true },
    });
    await updateOutreach(siren, {
      status: "contacte",
      notes: existing?.notes ?? "",
      contact_method: "email",
      contacted_date: now,
      qualification: existing?.qualification ?? null,
    }, tenantId, insertId, auth.user.id);

    // Add claude_activity
    await addClaudeActivity({
      siren,
      activity_type: "action",
      title: "Email envoye",
      content: `Email envoye a ${to}\nSujet: ${subject}`,
      metadata: JSON.stringify({ to, subject }),
    }, tenantId, insertId, auth.user.id);

    // Auto-create follow-up at J+4
    const followupDate = new Date();
    followupDate.setDate(followupDate.getDate() + 4);
    const followupAt = followupDate.toISOString().replace("T", " ").split(".")[0];
    await addFollowup({
      siren,
      scheduled_at: followupAt,
      note: `Relance auto J+4 -- Email initial: "${subject}" envoye a ${to}`,
    }, tenantId, insertId);

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

    invalidate("stats");

    return NextResponse.json({ ok: true, messageId }, { status: 200 });
  } catch (error) {
    console.error("Erreur envoi email:", error);
    return NextResponse.json(
      { error: `Erreur lors de l'envoi: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
