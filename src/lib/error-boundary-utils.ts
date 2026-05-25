/**
 * Utils partagés par les error boundaries (root, segment). Extraits ici pour
 * être testables hors React.
 *
 * Le cas central : pendant un déploiement, les chunks JS peuvent renvoyer 502
 * (container en restart, build en cours). React lève alors un ChunkLoadError
 * que Next.js propage au boundary. On reload une fois pour récupérer les
 * nouveaux chunks, avec un compteur sessionStorage pour casser une boucle
 * infinie si le déploiement met du temps à se stabiliser.
 */

const RELOAD_COUNTER_KEY = "veridian:error-boundary:reload-count";
const RELOAD_WINDOW_KEY = "veridian:error-boundary:reload-window-start";
const RELOAD_WINDOW_MS = 30_000;
const MAX_RELOADS = 2;

const CHUNK_ERROR_SIGNATURES = [
  "ChunkLoadError",
  "Loading chunk",
  "Loading CSS chunk",
  "Failed to fetch dynamically imported module",
];

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message : "";
  return CHUNK_ERROR_SIGNATURES.some(
    (sig) => name.includes(sig) || message.includes(sig),
  );
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ReloadDeps = {
  storage?: StorageLike | null;
  now?: () => number;
  reload?: () => void;
};

export function attemptReloadOnce(deps: ReloadDeps = {}): boolean {
  const storage = deps.storage ?? safeSessionStorage();
  const now = deps.now ?? (() => Date.now());
  const reload =
    deps.reload ??
    (() => {
      if (typeof window !== "undefined") window.location.reload();
    });

  if (!storage) {
    reload();
    return true;
  }

  const ts = now();
  const windowStart = Number(storage.getItem(RELOAD_WINDOW_KEY) ?? 0);
  const count = Number(storage.getItem(RELOAD_COUNTER_KEY) ?? 0);

  if (!windowStart || ts - windowStart > RELOAD_WINDOW_MS) {
    storage.setItem(RELOAD_WINDOW_KEY, String(ts));
    storage.setItem(RELOAD_COUNTER_KEY, "1");
    reload();
    return true;
  }

  if (count >= MAX_RELOADS) {
    return false;
  }

  storage.setItem(RELOAD_COUNTER_KEY, String(count + 1));
  reload();
  return true;
}

function safeSessionStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
