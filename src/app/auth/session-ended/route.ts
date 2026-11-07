/**
 * GET /auth/session-ended?next=<chemin> — fin d'une session refusée en base.
 *
 * Le middleware edge ne lit que le JWT : un compte supprimé ou des sessions coupées
 * lui paraissent encore valides. `SessionGuard` passe donc ici, qui retire le cookie
 * pour que la page suivante reparte par le rebond Hub. Une session encore valable
 * n'est pas touchée : un lien tiers ne peut pas déconnecter quelqu'un.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth-config";
import { safeReturnPath } from "@/lib/auth/auto-bounce";

const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  const path = safeReturnPath(request.nextUrl.searchParams.get("next"), origin) ?? "/";
  const response = NextResponse.redirect(new URL(path, origin));

  const session = await auth();
  if (session?.user?.id) return response;

  for (const name of SESSION_COOKIES) response.cookies.delete(name);
  return response;
}
