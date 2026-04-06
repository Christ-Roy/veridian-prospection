"use client";

/**
 * useLocalStoragePersist — sync React state with localStorage.
 *
 * Use case principal: persister les filtres de /prospects (searchTerm,
 * selectedSecteurs, geoDepts, etc.) sous une clé versionnée pour que
 * l'utilisateur retrouve ses filtres au reload.
 *
 * Shape identique à useState mais avec 1er argument = clé localStorage:
 *
 *   const [filters, setFilters] = useLocalStoragePersist("prospect-filters-v1", {
 *     searchTerm: "",
 *     geoDepts: [] as string[],
 *     preset: "tous",
 *   });
 *
 * Règles:
 *  - SSR-safe: si window est undefined (server render), renvoie l'initial.
 *    Le state est rehydraté après mount via un useEffect.
 *  - Versioning: inclure la version dans la clé ("prospect-filters-v1")
 *    pour invalider le storage quand le schéma change.
 *  - Serialisation JSON via JSON.stringify/parse. Les valeurs doivent être
 *    sérialisables (pas de Date, Map, Set, fonctions).
 *  - Fallback silencieux si localStorage est inaccessible (private mode,
 *    quota, etc.).
 *  - Un seul écrivain par clé par composant monté — éviter de mounter
 *    useLocalStoragePersist avec la même clé dans 2 composants, sinon
 *    les écritures se marchent dessus.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Setter<T> = (value: T | ((prev: T) => T)) => void;

function readFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeToStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full, private mode, etc. — silently ignore
  }
}

export function useLocalStoragePersist<T>(
  key: string,
  initialValue: T,
): [T, Setter<T>] {
  // SSR: always start with the initial value to avoid hydration mismatch
  const [value, setValue] = useState<T>(initialValue);
  // Track whether we've done the initial read — used to skip the first
  // write-back (which would just overwrite storage with initialValue)
  const hydratedRef = useRef(false);

  // On mount, read from storage and update the state if a value exists
  useEffect(() => {
    const stored = readFromStorage<T | undefined>(key, undefined as unknown as T);
    if (stored !== undefined) {
      setValue(stored);
    }
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist on every change (after hydration)
  useEffect(() => {
    if (!hydratedRef.current) return;
    writeToStorage(key, value);
  }, [key, value]);

  const setter = useCallback<Setter<T>>((v) => {
    setValue(v);
  }, []);

  return [value, setter];
}

/**
 * Low-level helpers exposed for tests and non-React consumers.
 */
export const __localStorageInternals = {
  read: readFromStorage,
  write: writeToStorage,
};
