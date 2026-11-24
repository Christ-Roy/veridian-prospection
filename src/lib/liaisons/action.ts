/** Appel d'une action chez l'app cible : `tools/call` sur son MCP, avec le jeton d'action. Réponse JSON ou SSE. */
import { NOM_CIBLE, refusDuHub, RefusLiaison, type Cible } from "./erreurs";
import type { JetonAction } from "./hub";

const REPONSE_MAX = 2_000_000;
type Opts = { fetchImpl?: typeof fetch; delaiMs?: number };

async function corpsBorne(res: Response): Promise<string> {
  const lecteur = res.body?.getReader();
  if (!lecteur) return "";
  const morceaux: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    n += value.length;
    if (n > REPONSE_MAX) {
      await lecteur.cancel();
      throw new RefusLiaison("reponse_invalide", "Réponse trop longue de l'application cible.", 502);
    }
    morceaux.push(value);
  }
  return Buffer.concat(morceaux).toString("utf8");
}

const objet = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
function analyser(texte: string): Record<string, unknown> | null {
  const charge = texte.split(/\r?\n/).findLast((l) => l.startsWith("data:"))?.slice(5) ?? texte;
  try {
    return objet(JSON.parse(charge));
  } catch {
    return null;
  }
}

/** Code de refus, où qu'il soit : `error.data.error`, `error.data.code`, `error` ou `code`. */
function codeRefus(r: Record<string, unknown> | null): string {
  const e = objet(r?.error);
  const d = objet(e?.data);
  for (const v of [d?.error, d?.code, e?.error, r?.error, r?.code]) if (typeof v === "string") return v;
  return "";
}

/** Rend l'objet produit par l'outil. Lève `RefusLiaison` ; les codes d'espace du contrat MCP deviennent des messages. */
export async function appelerAction(
  a: JetonAction,
  cible: Cible,
  outil: string,
  args: Record<string, unknown>,
  cleIdempotence: string,
  o: Opts = {},
): Promise<Record<string, unknown>> {
  const nom = NOM_CIBLE[cible];
  let res: Response;
  let texte: string;
  try {
    res = await (o.fetchImpl ?? fetch)(a.url, {
      method: "POST",
      redirect: "error", // le jeton ne suit jamais une redirection
      signal: AbortSignal.timeout(o.delaiMs ?? 60_000),
      headers: {
        Authorization: `Bearer ${a.jeton}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Idempotency-Key": cleIdempotence,
        "X-Veridian-MCP-Appel": "programme",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: outil, arguments: args } }),
    });
    texte = await corpsBorne(res);
  } catch (e) {
    if (e instanceof RefusLiaison) throw e;
    // Peut-être reçu : le rejeu du même geste est sans effet chez la cible.
    throw new RefusLiaison("cible_injoignable", `Pas de réponse de ${nom}. Vous pouvez réessayer, rien ne sera créé deux fois.`, 503);
  }
  const r = analyser(texte);
  const code = codeRefus(r);
  const resultat = objet(r?.result);
  if (!res.ok || !resultat || r?.error) {
    console.warn(`[liaisons] action refusée cible=${cible} outil=${outil} http=${res.status} code=${code.slice(0, 60)}`);
    throw traduireRefus(cible, res.status, code, JSON.stringify(r?.error ?? ""), Number(res.headers.get("retry-after")));
  }
  const brut = Array.isArray(resultat.content) ? objet(resultat.content[0])?.text : undefined;
  let sortie = objet(resultat.structuredContent);
  if (!sortie && typeof brut === "string") {
    try {
      sortie = objet(JSON.parse(brut));
    } catch {
      sortie = null;
    }
  }
  if (resultat.isError === true || !sortie) {
    const c = typeof sortie?.code === "string" ? sortie.code : "";
    console.warn(`[liaisons] outil en erreur cible=${cible} outil=${outil} code=${c}`);
    throw traduireRefus(cible, 200, c, typeof brut === "string" ? brut : "", NaN);
  }
  return objet(sortie.result) ?? sortie;
}

function traduireRefus(cible: Cible, http: number, code: string, texte: string, attendre: number): RefusLiaison {
  const nom = NOM_CIBLE[cible];
  const dit = (c: string) => code === c || texte.includes(c);
  if (http === 429) return refusDuHub("plafond", cible, attendre > 0 ? Math.min(attendre, 3600) : undefined);
  if (dit("tenant_not_linked")) return new RefusLiaison("cible_non_reliee", `Votre organisation n'est pas reliée à ${nom} : ouvrez-le une fois depuis Veridian, puis réessayez.`, 403);
  if (dit("tenant_forbidden") || dit("hub_user_unknown")) return new RefusLiaison("cible_non_membre", `Vous n'avez pas accès à ${nom} dans cette organisation.`, 403);
  if (dit("would_trigger")) return new RefusLiaison("sequence", "Cette liste démarre une séquence d'envoi : choisissez une liste sans séquence. Rien n'a été écrit.", 409);
  if (/not found|unknown tool|outil inconnu/i.test(texte)) return new RefusLiaison("cible_absente", `${nom === "Mail" ? "Mail" : "Votre CRM"} ne sait pas encore recevoir cet envoi : la liaison n'y est pas installée.`, 409);
  return new RefusLiaison("cible_refus", `${nom === "Mail" ? "Mail" : "Le CRM"} n'a pas accepté cet envoi. Vous pouvez réessayer, rien ne sera créé deux fois.`, 502);
}
