"use client";

/**
 * Error boundary racine App Router — capture toutes les erreurs client-side
 * non gérées par un boundary plus proche.
 *
 * Cas principal géré ici : ChunkLoadError. Pendant un déploiement, le
 * container peut servir 502 sur les chunks JS demandés par React lors de
 * l'hydratation client. Next.js bascule alors sur `error.tsx` avec une
 * erreur de type ChunkLoadError. Plutôt qu'afficher un overlay vide
 * "Application error", on force un reload : le HTML SSR sera re-fetch
 * avec le hash de chunk à jour.
 *
 * Pourquoi pas seulement reload ? On debounce pour éviter une boucle de
 * reload si le déploiement met du temps à se stabiliser (rare mais
 * possible). Compteur en sessionStorage : max 2 reloads consécutifs en
 * 30s, ensuite on affiche un message d'erreur réel avec bouton manuel.
 */
import { useEffect } from "react";
import { isChunkLoadError, attemptReloadOnce } from "@/lib/error-boundary-utils";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    if (isChunkLoadError(error)) {
      attemptReloadOnce();
    }
  }, [error]);

  if (isChunkLoadError(error)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Mise à jour en cours, rechargement…
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          Recharger maintenant
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Une erreur est survenue
      </h2>
      <p className="max-w-md text-sm text-neutral-600 dark:text-neutral-400">
        {error.message || "Erreur inattendue."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-50 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Réessayer
      </button>
    </div>
  );
}
