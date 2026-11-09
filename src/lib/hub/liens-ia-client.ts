/**
 * Liens « Ajouter à Claude / ChatGPT / Cursor / VS Code » de la porte MCP, lus au Hub
 * (`GET /api/mcp/liens-installation`, public : les liens ne portent aucun secret). Le Hub reste la seule
 * source de ces liens : Atlas les affiche dans l'app pour qu'on branche son IA sans passer par le Hub.
 *
 * Au mieux : Hub injoignable ou réponse inattendue = `null` (l'écran renvoie alors vers la page IA du
 * Hub). Cache de 10 min, les liens changent rarement.
 */
export type LiensIA = { url: string; claude: string | null; chatgpt: string | null; cursor: string | null; vscode: string | null; claudeCode: string | null; aideChatgpt: string | null };

const CACHE_MS = 10 * 60_000;
let cache: { t: number; v: LiensIA } | null = null;

const lien = (v: unknown) => (typeof v === "string" && /^(https:\/\/|cursor:\/\/|vscode:)/.test(v) ? v : null);
const texte = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 600) : null);

export async function liensIA(opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; maintenant?: number } = {}): Promise<LiensIA | null> {
  const env = opts.env ?? process.env;
  const maintenant = opts.maintenant ?? Date.now();
  if (cache && maintenant - cache.t < CACHE_MS) return cache.v;
  const hub = (env.HUB_API_URL || env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site").replace(/\/$/, "");
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${hub}/api/mcp/liens-installation?app=prospection`, { signal: AbortSignal.timeout(2000), headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const c = (await res.json()) as Record<string, unknown>;
    const url = lien(c.url);
    if (!url) return null;
    const v: LiensIA = {
      url,
      claude: lien(c.claude),
      chatgpt: lien(c.chatgpt),
      cursor: lien(c.cursor),
      vscode: lien(c.vscode),
      claudeCode: texte(c.claudeCode),
      // Le Hub donne l'étape ChatGPT (pas de lien prérempli) dans instructions.chatgpt (contrat CONTRAT-MCP.md).
      aideChatgpt: texte((c.instructions as { chatgpt?: unknown } | undefined)?.chatgpt),
    };
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
