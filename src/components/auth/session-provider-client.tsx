"use client";

/**
 * Client wrapper around next-auth's SessionProvider — nécessaire pour que
 * useSession() / signOut() fonctionnent dans les composants client comme
 * `app-nav.tsx` ou `/login`. Pas branché jusqu'au 2026-05-23, ce qui rendait
 * impossible toute UX de logout / changement de compte côté Prospection.
 */
import { SessionProvider } from "next-auth/react";

export function SessionProviderClient({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
