"use client";

/**
 * Session refusée en base (compte supprimé, sessions coupées) alors que le JWT reste
 * lisible par le middleware : on repart proprement par `/auth/session-ended`.
 * Une tentative par minute, pour qu'une panne réseau ne devienne pas une boucle.
 */
import { useEffect } from "react";
import { useSession } from "next-auth/react";

const PUBLIC_PATHS = /^\/(login|signup|auth|invite)(\/|$)/;
const LAST_TRY_KEY = "veridian-session-ended-at";

export function SessionGuard() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    const { pathname, search } = window.location;
    if (PUBLIC_PATHS.test(pathname)) return;
    try {
      const last = Number(sessionStorage.getItem(LAST_TRY_KEY) ?? 0);
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(LAST_TRY_KEY, String(Date.now()));
    } catch {
      // stockage indisponible : on tente quand même
    }
    window.location.assign(`/auth/session-ended?next=${encodeURIComponent(pathname + search)}`);
  }, [status]);

  return null;
}
