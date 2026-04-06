import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

/**
 * POST /api/phone/summarize-call
 * Generates an AI summary of a completed call using ZAI (OpenAI-compatible).
 *
 * Body: { call_id, domain, duration?, recording_url? }
 *
 * For now (no transcription service), the summary is based on call metadata.
 * When transcription becomes available, it will be fed to the LLM.
 */

const ZAI_API_KEY = process.env.ZAI_API_KEY ?? "";
const ZAI_BASE_URL = process.env.ZAI_BASE_URL ?? "";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { insertId: workspaceId } = await getWorkspaceScope();

  try {
    const body = (await req.json()) as {
      call_id?: number;
      domain?: string;
      siren?: string;
      duration?: number;
      recording_url?: string;
    };
    const { call_id, duration, recording_url } = body;
    // SIREN carried in `siren` or legacy `domain`
    const siren = body.siren ?? body.domain;

    if (!siren) {
      return NextResponse.json({ error: "Missing siren" }, { status: 400 });
    }

    // Fetch call info from DB if call_id provided
    interface CallRow {
      to_number: string | null;
      duration_seconds: number | null;
      status: string;
      started_at: string;
      recording_path: string | null;
    }
    let callInfo: CallRow | undefined;

    if (call_id) {
      const row = await prisma.callLog.findUnique({
        where: { id: call_id },
        select: {
          toNumber: true,
          durationSeconds: true,
          status: true,
          startedAt: true,
          recordingPath: true,
        },
      });
      if (row) {
        callInfo = {
          to_number: row.toNumber,
          duration_seconds: row.durationSeconds,
          status: row.status,
          started_at: String(row.startedAt),
          recording_path: row.recordingPath,
        };
      }
    }

    const callDuration = callInfo?.duration_seconds ?? duration ?? 0;
    const callNumber = callInfo?.to_number ?? "inconnu";
    const callDate = callInfo?.started_at ?? new Date().toISOString();
    const recUrl = callInfo?.recording_path ?? recording_url;

    // Fetch lead context from entreprises for better summary
    const leadRows = await prisma.$queryRawUnsafe<{
      nom: string;
      dirigeant: string;
      ville: string;
      cms: string | null;
      has_responsive: number | null;
      has_https: number | null;
      copyright_year: number | null;
    }[]>(
      `SELECT
        COALESCE(e.denomination, '') as nom,
        TRIM(COALESCE(e.dirigeant_prenom,'') || ' ' || COALESCE(e.dirigeant_nom,'')) as dirigeant,
        COALESCE(e.commune, '') as ville,
        e.web_cms as cms,
        CASE WHEN e.web_has_responsive = true THEN 1 WHEN e.web_has_responsive = false THEN 0 ELSE NULL END as has_responsive,
        CASE WHEN e.web_has_https = true THEN 1 WHEN e.web_has_https = false THEN 0 ELSE NULL END as has_https,
        e.web_copyright_year as copyright_year
      FROM entreprises e WHERE e.siren = $1`,
      siren
    );
    const lead = leadRows[0] ?? null;

    // If no ZAI configured, write a basic metadata summary
    if (!ZAI_API_KEY || !ZAI_BASE_URL) {
      const content = buildFallbackSummary(
        callDate,
        callNumber,
        callDuration,
        lead,
        recUrl
      );
      await prisma.claudeActivity.create({
        data: {
          siren,
          activityType: "call_summary",
          title: `Appel du ${callDate.split("T")[0].split(" ")[0]}`,
          content,
          metadata: JSON.stringify({ call_id, duration: callDuration, recording_url: recUrl }),
          tenantId,
          workspaceId,
        },
      });
      return NextResponse.json({ ok: true, source: "fallback" });
    }

    // Build prompt for ZAI
    const prompt = buildPrompt(callDate, callNumber, callDuration, lead, recUrl);

    const aiRes = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ZAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "glm-4.7-flash",
        messages: [
          {
            role: "system",
            content:
              "Tu es un assistant commercial pour Veridian, agence web. Tu rediges des comptes-rendus d'appels de prospection, concis et actionnables. Reponds en francais.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    let summary: string;
    if (aiRes.ok) {
      const aiData = await aiRes.json();
      summary =
        aiData.choices?.[0]?.message?.content ??
        buildFallbackSummary(callDate, callNumber, callDuration, lead, recUrl);
    } else {
      console.error("[summarize-call] ZAI error:", aiRes.status);
      summary = buildFallbackSummary(
        callDate,
        callNumber,
        callDuration,
        lead,
        recUrl
      );
    }

    // Save to claude_activity
    await prisma.claudeActivity.create({
      data: {
        siren,
        activityType: "call_summary",
        title: `Appel du ${callDate.split("T")[0].split(" ")[0]}`,
        content: summary,
        metadata: JSON.stringify({ call_id, duration: callDuration, recording_url: recUrl }),
        tenantId,
        workspaceId,
      },
    });

    return NextResponse.json({ ok: true, source: "ai" });
  } catch (err) {
    console.error("[summarize-call] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

interface LeadCtx { nom: string; dirigeant: string; ville: string; cms: string | null; has_responsive: number | null; has_https: number | null; copyright_year: number | null }

function buildPrompt(callDate: string, number: string, duration: number, lead: LeadCtx | null, recordingUrl?: string | null): string {
  const d = callDate.split("T")[0].split(" ")[0];
  const p = [`Appel de prospection le ${d}`, `Numero : ${number}`, `Duree : ${duration}s`];
  if (lead) {
    if (lead.nom) p.push(`Entreprise : ${lead.nom}`);
    if (lead.dirigeant.trim()) p.push(`Dirigeant : ${lead.dirigeant}`);
    if (lead.ville) p.push(`Ville : ${lead.ville}`);
    if (lead.cms) p.push(`CMS : ${lead.cms}`);
    if (lead.has_responsive === 0) p.push("Site non responsive");
    if (lead.has_https === 0) p.push("Pas de HTTPS");
    if (lead.copyright_year && lead.copyright_year < 2022) p.push(`Copyright : ${lead.copyright_year}`);
  }
  p.push(recordingUrl ? `Enregistrement : ${recordingUrl}` : "Pas d'enregistrement.");
  p.push("", "Redige un bref compte-rendu (3-5 lignes) et propose 2-3 prochaines actions concretes.");
  p.push("Sans transcription, base-toi sur les metadonnees pour deduire le contexte probable.");
  return p.join("\n");
}

function buildFallbackSummary(callDate: string, number: string, duration: number, lead: { nom: string } | null, recordingUrl?: string | null): string {
  const d = callDate.split("T")[0].split(" ")[0];
  const name = lead?.nom || "prospect";
  const qualifier = duration >= 60 ? "Conversation significative." : duration >= 30 ? "Appel court, decroche." : "Appel tres court.";
  const lines = [`Appel vers ${name} (${number}) le ${d} -- ${duration}s. ${qualifier}`];
  if (recordingUrl) lines.push(`Enregistrement : ${recordingUrl}`);
  lines.push("", "Actions : ecouter l'enregistrement, mettre a jour la fiche, planifier un suivi.");
  return lines.join("\n");
}
