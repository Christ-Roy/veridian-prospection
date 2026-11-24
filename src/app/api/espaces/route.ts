/** Organisations de l'utilisateur connecté : `GET` les liste, `POST {id}` choisit celle où travailler (VER-252). */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { COOKIE_ESPACE, espacesDe } from "@/lib/auth/espaces";
import { getUserContext } from "@/lib/auth/user-context";

export const dynamic = "force-dynamic";

const rendre = (corps: unknown, status = 200) => NextResponse.json(corps, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return rendre({ error: "Unauthorized" }, 401);
  return rendre({ courant: ctx.tenantId, espaces: await espacesDe(ctx.userId) });
}

export async function POST(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if ((site && site !== "same-origin") || !request.headers.get("content-type")?.startsWith("application/json")) return rendre({ error: "origine refusée" }, 403);
  const ctx = await getUserContext();
  if (!ctx) return rendre({ error: "Unauthorized" }, 401);
  const e = z.object({ id: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!e.success) return rendre({ error: "demande invalide" }, 400);
  const espace = (await espacesDe(ctx.userId)).find((x) => x.id === e.data.id);
  // Même réponse pour un espace inconnu et pour celui d'un autre.
  if (!espace) return rendre({ error: "organisation inconnue" }, 404);
  const r = rendre({ courant: espace.id });
  r.cookies.set({ name: COOKIE_ESPACE, value: espace.id, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return r;
}
