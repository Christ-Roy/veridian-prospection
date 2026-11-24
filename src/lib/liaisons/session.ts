/** Identifiant de la session du navigateur (`sid`, posé à l'ouverture), lu dans le cookie chiffré d'Auth.js. */
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function sessionId(request: NextRequest): Promise<string | null> {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  const cookieName = process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token";
  const t = await getToken({ req: request, secret, cookieName, salt: cookieName }).catch(() => null);
  return typeof t?.sid === "string" ? t.sid : null;
}
