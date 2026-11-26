import type { CommuneGeo, EpciGeo, Filtre } from "./types";

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
  if (status === 403 && texte === "no_workspace") return String((corps as { message?: unknown }).message ?? "Aucun espace Prospection ouvert pour ce compte.");
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

/** Contours des communes et intercommunalités d'un département (route GET, en cache navigateur 24 h). */
export async function contoursCommunes(dep: string, signal?: AbortSignal): Promise<{ communes: CommuneGeo[]; epcis: EpciGeo[] }> {
  let res: Response;
  try {
    res = await fetch(`/api/atlas/communes/${encodeURIComponent(dep)}`, { credentials: "same-origin", signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ErreurAtlas("Réseau indisponible.", 0);
  }
  const json = (await res.json().catch(() => null)) as { communes?: CommuneGeo[]; epcis?: EpciGeo[] } | null;
  if (!res.ok) throw new ErreurAtlas(messageErreur(res.status, json), res.status);
  return { communes: json?.communes ?? [], epcis: json?.epcis ?? [] };
}

export const estAnnulation = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
export const texteErreur = (e: unknown) => (e instanceof Error ? e.message : "Erreur inconnue");

export type CorpsFiltre = { filtre: Filtre };

/** Message lisible d'un refus d'export (402 : plan gratuit, 429 : trop d'exports). */
export function messageExport(status: number, corps: { message?: string; error?: string } | null): string {
  if (status === 402) return corps?.message ?? "L'export est réservé aux plans payants Veridian.";
  if (status === 429) return corps?.error ?? "Trop d'exports cette heure.";
  return corps?.message ?? corps?.error ?? `Export impossible (${status}).`;
}
