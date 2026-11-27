/**
 * Liens d'installation du connecteur Veridian, lus au Hub (`GET /api/mcp/liens-installation?app=prospection`, public, sans
 * secret ; CONTRAT-MCP.md, CONTRAT-HUB §5.24.1 « Contenu de la carte sans moteur »). Le Hub reste la seule source : rien n'est
 * recopié en dur ici, la carte « Relier mon IA » les affiche tels qu'il les sert.
 *
 * `assistants[]` donne un bouton par assistant (`libelle`, `installation`, `etape` quand le lien ne préremplit pas, ChatGPT).
 * Seules les origines garanties par le contrat passent (une réponse piégée ne met pas de `javascript:` dans un bouton) ;
 * un bouton hors de ces origines est retiré, avec un avertissement.
 * Au mieux : Hub injoignable ou réponse inattendue = `null` (la carte garde le texte et le lien vers le Hub). Cache 5 min.
 */
export type AssistantIA = { cle: string; libelle: string; installation: string; etape: string | null };
export type LiensIA = { url: string; claudeCode: string | null; assistants: AssistantIA[] };

const CACHE_MS = 5 * 60_000;
let cache: { t: number; v: LiensIA } | null = null;

/** Origines garanties des liens `installation` (CONTRAT-MCP.md). */
const ORIGINES = [/^https:\/\/claude\.ai\//, /^https:\/\/chatgpt\.com\//, /^cursor:\/\//, /^https:\/\/vscode\.dev\//];
const installation = (v: unknown) => (typeof v === "string" && ORIGINES.some((o) => o.test(v)) ? v : null);
const texte = (v: unknown, max = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const adresse = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v : null);

export async function liensIA(opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; maintenant?: number } = {}): Promise<LiensIA | null> {
  const env = opts.env ?? process.env;
  const maintenant = opts.maintenant ?? Date.now();
  if (cache && maintenant - cache.t < CACHE_MS) return cache.v;
  const hub = (env.HUB_API_URL || env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site").replace(/\/$/, "");
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${hub}/api/mcp/liens-installation?app=prospection`, { signal: AbortSignal.timeout(2000), headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const c = (await res.json()) as Record<string, unknown>;
    const url = adresse(c.url);
    if (!url) return null;
    const assistants: AssistantIA[] = [];
    for (const a of Array.isArray(c.assistants) ? (c.assistants as Record<string, unknown>[]) : []) {
      const lien = installation(a?.installation);
      const libelle = texte(a?.libelle, 60);
      if (!lien || !libelle) {
        console.warn(`[ia][liens] bouton retiré (origine hors contrat ou libellé absent) cle=${String(a?.cle).slice(0, 30)}`);
        continue;
      }
      assistants.push({ cle: texte(a.cle, 30) ?? libelle, libelle, installation: lien, etape: texte(a.etape) });
    }
    const v: LiensIA = { url, claudeCode: texte(c.claudeCode, 300), assistants };
    cache = { t: maintenant, v };
    return v;
  } catch {
    return null;
  }
}

/** Pour les tests. */
export function viderCacheLiensIA() {
  cache = null;
}
