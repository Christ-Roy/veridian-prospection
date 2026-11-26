/**
 * Politique de sécurité du contenu (VER-265, modèle `securite/CSP-MODELE.md`, référence Academy) : scripts par nonce seulement,
 * aucun script inline ni externe sans lui, aucun plugin, aucune page de Prospection dans un cadre, violations remontées à `/api/csp`
 * (journal `csp_violation`). Les styles gardent 'unsafe-inline' : React pose des attributs `style` qu'aucun nonce ne couvre.
 * Prospection n'appelle rien d'autre qu'elle-même depuis le navigateur (polices servies par next/font, carte calculée au serveur) ;
 * le Hub n'est qu'une destination de lien ou de formulaire.
 *
 * Mode : `Content-Security-Policy-Report-Only` tant que les violations d'un vrai parcours n'ont pas été relues (26/11), puis
 * `APPLIQUEE = true` pour l'imposer.
 */
export const CHEMIN_RAPPORT = "/api/csp";
export const APPLIQUEE = false;
export const ENTETE = APPLIQUEE ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

const HUB = process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";

export function politique(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    // Le rechargement à chaud du mode développement évalue du code ; la production, jamais.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action 'self' ${HUB}`,
    ...(dev ? [] : ["upgrade-insecure-requests"]),
    `report-uri ${CHEMIN_RAPPORT}`,
    "report-to csp",
  ].join("; ");
}

export function nonce(): string {
  const o = new Uint8Array(16);
  crypto.getRandomValues(o);
  return btoa(String.fromCharCode(...o));
}

/** Ce qu'on garde d'un rapport : la directive et l'origine bloquée, jamais la query ni l'extrait de code (il peut porter une donnée). */
export function resumerRapport(brut: unknown): { directive: string; bloque: string; page: string; source: string | null }[] {
  const liste = Array.isArray(brut) ? brut : [brut];
  const court = (s: unknown, n = 200) => (typeof s === "string" ? s.slice(0, n) : "");
  const sansQuery = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.origin}${x.pathname}`;
    } catch {
      return u.split(/[?#]/)[0];
    }
  };
  return liste.slice(0, 20).flatMap((r) => {
    const o = (r as Record<string, unknown>) ?? {};
    // Ancien format (`report-uri`) : { "csp-report": {...} } ; Reporting API : { type: "csp-violation", body: {...} }.
    const c = (o["csp-report"] ?? (o.type === "csp-violation" ? o.body : null)) as Record<string, unknown> | null;
    if (!c || typeof c !== "object") return [];
    const directive = court(c["effective-directive"] ?? c.effectiveDirective ?? c["violated-directive"], 80);
    if (!directive) return [];
    const bloque = court(c["blocked-uri"] ?? c.blockedURL);
    const ligne = c["line-number"] ?? c.lineNumber;
    const fichier = c["source-file"] ?? c.sourceFile;
    return [
      {
        directive,
        bloque: /^(inline|eval|data|blob|self)$/.test(bloque) ? bloque : sansQuery(bloque),
        page: sansQuery(court(c["document-uri"] ?? c.documentURL, 300)),
        source: fichier ? `${sansQuery(court(fichier))}:${ligne ?? "?"}` : null,
      },
    ];
  });
}
