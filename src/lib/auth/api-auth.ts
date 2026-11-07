/**
 * requireAuth() — garde-fou session pour les routes API (Auth.js v5).
 * Retourne `{ user: { id, email } }`, ou `{ error: NextResponse }` : 401 sans session,
 * 403 sans tenant.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth-config";
import { getTenantId } from "@/lib/auth/tenant";

export async function requireAuth(): Promise<
  | { user: { id: string; email: string }; error?: never }
  | { user?: never; error: NextResponse }
> {
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // Sans tenant, les requêtes retomberaient sur le tenant factice 00000000, partagé
  // par tous ces comptes : un membre retiré y lirait encore des données. On refuse.
  if (!(await getTenantId(session.user.id))) {
    return {
      error: NextResponse.json({ error: "no_workspace" }, { status: 403 }),
    };
  }

  return { user: { id: session.user.id, email: session.user.email } };
}
