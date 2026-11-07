/**
 * Connexion automatique par le Hub (CONTRAT-HUB §6bis.8.0). Edge-safe : pas de Prisma.
 *
 * Deux cookies locaux, lisibles côté client pour que le formulaire et le bouton de
 * déconnexion puissent les poser ou les lever :
 *  - déconnexion explicite : plus aucun rebond silencieux jusqu'à la prochaine connexion ;
 *  - essai automatique : un seul rebond par fenêtre de 5 minutes, contre les boucles.
 */
export const LOGGED_OUT_COOKIE = "veridian-logged-out";
export const AUTO_BOUNCE_COOKIE = "veridian-auto-bounce";
export const AUTO_BOUNCE_TTL_S = 300;

const NO_RETURN_PATHS = /^\/(login|signup|api|auth|invite)(\/|\?|$)/;

type RequestLike = {
  method: string;
  headers: { get(name: string): string | null };
  nextUrl: { searchParams: { has(name: string): boolean } };
};

/** Vraie navigation de page : ni POST, ni iframe, ni préchargement, ni requête du routeur. */
export function isFullNavigation(req: RequestLike): boolean {
  if (req.method !== "GET") return false;
  if (req.headers.get("rsc") || req.nextUrl.searchParams.has("_rsc")) return false;
  if (req.headers.get("next-router-prefetch")) return false;
  const purpose = req.headers.get("purpose") ?? req.headers.get("sec-purpose");
  if (purpose?.includes("prefetch")) return false;
  const dest = req.headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return false;
  const mode = req.headers.get("sec-fetch-mode");
  return !mode || mode === "navigate";
}

/**
 * Chemin de retour sûr : même origine que `origin`, jamais une page de connexion ni une
 * route d'API. Accepte une URL absolue ou un chemin. `null` sinon, donc l'accueil.
 */
export function safeReturnPath(raw: unknown, origin: string): string | null {
  if (typeof raw !== "string" || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  const path = `${url.pathname}${url.search}`;
  if (NO_RETURN_PATHS.test(path)) return null;
  return path;
}

const secureFlag = () =>
  typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";

/** Côté client, avant `signOut`. */
export function markLoggedOut() {
  document.cookie = `${LOGGED_OUT_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax${secureFlag()}`;
}

/** Côté client, après une connexion réussie par le formulaire. */
export function clearBounceCookies() {
  for (const name of [LOGGED_OUT_COOKIE, AUTO_BOUNCE_COOKIE]) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag()}`;
  }
}
