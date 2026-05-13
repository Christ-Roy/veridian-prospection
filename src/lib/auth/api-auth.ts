/**
 * Auth.js v5 — équivalent de src/lib/supabase/api-auth.ts
 * Vérifie la session pour les routes API. Retourne user ou 401.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

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

  return { user: { id: session.user.id, email: session.user.email } };
}
