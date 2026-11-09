import type { Filtre } from "./types";

/** Erreur d'appel à l'API Atlas ; `status` 0 = réseau. */
export class ErreurAtlas extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function messageErreur(status: number, corps: unknown): string {
  const texte = corps && typeof corps === "object" && "error" in corps ? String((corps as { error: unknown }).error) : "";
  if (status === 401) return "Session expirée : reconnectez-vous.";
  if (status === 404) return "Cette action n'est pas permise sur votre espace.";
  if (status === 429) return "Trop de requêtes, patientez quelques secondes.";
  if (status >= 500) return "Erreur du serveur, réessayez.";
  return texte || `Erreur ${status}`;
}

/** Appelle un outil Atlas (même API que l'IA). Lève ErreurAtlas avec un message lisible. */
export async function appeler<T>(outil: string, corps: object = {}, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/atlas/${outil}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ErreurAtlas("Réseau indisponible.", 0);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ErreurAtlas(messageErreur(res.status, json), res.status);
  return json as T;
}

export const estAnnulation = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
export const texteErreur = (e: unknown) => (e instanceof Error ? e.message : "Erreur inconnue");

export type CorpsFiltre = { filtre: Filtre };
