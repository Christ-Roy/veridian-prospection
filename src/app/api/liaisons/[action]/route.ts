/**
 * Liaisons depuis l'écran (VER-246) : `GET /api/liaisons/etat`, puis un geste humain par `POST`. Session de navigateur
 * seulement : ni clé API, ni MCP, car la délégation appartient à la personne connectée. L'espace vient de la session.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getUserContext } from "@/lib/auth/user-context";
import { RefusLiaison } from "@/lib/liaisons/erreurs";
import { sessionId } from "@/lib/liaisons/session";
import { isRateLimited } from "@/lib/rate-limit";
import { avecClients } from "@/atlas/clients";
import { RefusExtraction } from "@/atlas/extraction";
import { FiltreInvalide } from "@/atlas/filtres";
import * as li from "@/atlas/liaisons";
import { Introuvable } from "@/atlas/segments";

export const dynamic = "force-dynamic";

const ID = z.string().uuid();
const SIREN = z.string().regex(/^\d{9}$/);
const LISTE = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const CURSEUR = z.string().max(200).nullish();

const ACTIONS: Record<string, { schema: z.ZodType; run: (a: li.Appel, e: never) => Promise<unknown> }> = {
  "crm-fiche": { schema: z.object({ geste: ID, siren: SIREN }).strict(), run: li.ficheVersCrm },
  "crm-segment": { schema: z.object({ geste: ID, segmentId: ID, curseur: CURSEUR }).strict(), run: li.segmentVersCrm },
  "mail-listes": { schema: z.object({}).strict(), run: li.listesMail },
  "mail-creer-liste": { schema: z.object({ geste: ID, nom: z.string().trim().min(1).max(100) }).strict(), run: li.creerListeMail },
  "mail-fiche": { schema: z.object({ geste: ID, siren: SIREN, listeId: LISTE, simulation: z.boolean() }).strict(), run: li.ficheVersMail },
  "mail-segment": { schema: z.object({ geste: ID, segmentId: ID, listeId: LISTE, curseur: CURSEUR, simulation: z.boolean() }).strict(), run: li.segmentVersMail },
};

const rendre = (corps: unknown, status = 200, entetes: Record<string, string> = {}) => NextResponse.json(corps, { status, headers: { "Cache-Control": "no-store", ...entetes } });

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if ((await params).action !== "etat") return rendre({ error: "inconnu" }, 404);
  const ctx = await getUserContext();
  if (!ctx) return rendre({ error: "Unauthorized" }, 401);
  return rendre(await li.etatLiaisons(await li.appelDe(ctx, await sessionId(request))));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const nom = (await params).action;
  const action = Object.hasOwn(ACTIONS, nom) ? ACTIONS[nom] : null;
  if (!action) return rendre({ error: "inconnu" }, 404);
  // Un autre site ne déclenche pas d'envoi au nom de l'utilisateur (en plus du cookie SameSite).
  const site = request.headers.get("sec-fetch-site");
  if ((site && site !== "same-origin") || !request.headers.get("content-type")?.startsWith("application/json")) return rendre({ error: "origine refusée" }, 403);
  const ctx = await getUserContext();
  if (!ctx) return rendre({ error: "Unauthorized", code: "session" }, 401);
  if (ctx.lectureSeule) return rendre({ error: "Espace en lecture seule : aucun envoi.", code: ctx.lectureSeule }, 402);
  if (isRateLimited(`liaisons:${ctx.userId}`, 60, 60_000)) return rendre({ error: "Trop d'envois, patientez une minute.", code: "plafond", attendre: 60 }, 429, { "Retry-After": "60" });

  const e = action.schema.safeParse(await request.json().catch(() => null));
  if (!e.success) return rendre({ error: "Demande invalide.", code: "invalide" }, 400);
  const t0 = Date.now();
  const journal = (issue: string) => console.log(`[liaisons] action=${nom} tenant=${ctx.tenantId} user=${ctx.userId} issue=${issue} ms=${Date.now() - t0}`);
  try {
    const appel = await li.appelDe(ctx, await sessionId(request));
    const r = await avecClients(ctx.tenantId, () => action.run(appel, e.data as never));
    journal("ok");
    return rendre(r);
  } catch (err) {
    if (err instanceof RefusLiaison) {
      journal(err.code);
      return rendre({ error: err.message, code: err.code, ...(err.attendre ? { attendre: err.attendre } : {}) }, err.statut, err.attendre ? { "Retry-After": String(err.attendre) } : {});
    }
    if (err instanceof Introuvable) return rendre({ error: "Segment introuvable.", code: "introuvable" }, 404);
    if (err instanceof RefusExtraction || err instanceof FiltreInvalide) {
      journal("refus");
      return rendre({ error: err.message, code: "refus" }, 409);
    }
    journal("erreur");
    console.error("[liaisons]", err instanceof Error ? err.message.slice(0, 300) : "erreur");
    return rendre({ error: "Erreur interne : rien n'indique que l'envoi ait abouti. Réessayez, rien ne sera créé deux fois.", code: "erreur" }, 500);
  }
}
