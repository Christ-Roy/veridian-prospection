"use client";

/**
 * useMediaQuery — observe une media query CSS et renvoie son état courant.
 *
 * Usage:
 *   const isDesktop = useMediaQuery("(min-width: 768px)");
 *
 * SSR-safe : renvoie `undefined` tant que le viewport n'est pas connu
 * (rendu serveur + tout premier rendu client avant l'effet). Une fois
 * monté côté client, renvoie le vrai booléen et se met à jour aux
 * changements de viewport.
 *
 * Le `undefined` initial laisse au consommateur le choix d'afficher un
 * état neutre plutôt que de parier sur une valeur — utile pour éviter un
 * flash de mauvaise mise en page (ex : vue calendrier desktop vs mobile).
 */

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean | undefined {
  const [matches, setMatches] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
