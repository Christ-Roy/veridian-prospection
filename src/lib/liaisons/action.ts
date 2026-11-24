/**
 * Appel d'une action chez l'app cible, avec le jeton d'action. CRM : `tools/call` sur son MCP (JSON ou SSE). Mail :
 * `POST <adresse>/<action>` (fiche 87 de Notifuse), idempotente par clé.
 */
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

/** Requête bornée. Le jeton ne suit jamais une redirection. */
async function poster(url: string, jeton: string, cible: Cible, corps: unknown, cle: string, o: Opts): Promise<{ res: Response; texte: string }> {
  try {
    const res = await (o.fetchImpl ?? fetch)(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(o.delaiMs ?? 60_000),
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Idempotency-Key": cle,
        "X-Veridian-MCP-Appel": "programme",
      },
      body: JSON.stringify(corps),
    });
    return { res, texte: await corpsBorne(res) };
  } catch (e) {
    if (e instanceof RefusLiaison) throw e;
    // Peut-être reçu : le rejeu du même geste est sans effet chez la cible.
    throw new RefusLiaison("cible_injoignable", `Pas de réponse de ${NOM_CIBLE[cible]}. Vous pouvez réessayer, rien ne sera créé deux fois.`, 503);
  }
}

/** Action de Mail. Rend `resultat`. */
export async function appelerMail(a: JetonAction, action: string, corps: Record<string, unknown>, cle: string, o: Opts = {}): Promise<Record<string, unknown>> {
  const { res, texte } = await poster(`${a.url.replace(/\/+$/, "")}/${action}`, a.jeton, "notifuse", corps, cle, o);
  const r = analyser(texte);
  const sortie = objet(r?.resultat);
  if (res.ok && sortie) return sortie;
  const code = codeRefus(r);
  console.warn(`[liaisons] action refusée cible=notifuse action=${action} http=${res.status} code=${code.slice(0, 60)}`);
  throw traduireRefus("notifuse", res.status, code, JSON.stringify(r?.detail ?? ""), Number(res.headers.get("retry-after")));
}

/** Code de refus, où qu'il soit : `error.data.error`, `error.data.code`, `error` ou `code`. */
function codeRefus(r: Record<string, unknown> | null): string {
  const e = objet(r?.error);
  const d = objet(e?.data);
  for (const v of [d?.error, d?.code, e?.error, r?.error, r?.code]) if (typeof v === "string") return v;
  return "";
}

/** Outil du CRM. Rend l'objet produit par l'outil. Lève `RefusLiaison` ; les codes d'espace du contrat MCP deviennent des messages. */
export async function appelerCrm(a: JetonAction, outil: string, args: Record<string, unknown>, cle: string, o: Opts = {}): Promise<Record<string, unknown>> {
  const cible: Cible = "crm";
  const { res, texte } = await poster(a.url, a.jeton, cible, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: outil, arguments: args } }, cle, o);
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
  if (http === 429) return refusDuHub("rate_limited", cible, attendre > 0 ? Math.min(attendre, 3600) : undefined);
  if (dit("tenant_not_linked") || dit("espace_non_relie")) return new RefusLiaison("cible_non_reliee", `Votre organisation n'est pas reliée à ${nom} : ouvrez-le une fois depuis Veridian, puis réessayez.`, 403);
  if (["tenant_forbidden", "hub_user_unknown", "utilisateur_inconnu", "non_membre"].some(dit)) return new RefusLiaison("cible_non_membre", `Vous n'avez pas accès à ${nom} dans cette organisation.`, 403);
  if (dit("espace_suspendu")) return new RefusLiaison("cible_suspendue", `Votre espace dans ${nom} est suspendu.`, 403);
  if (dit("cle_reutilisee")) return new RefusLiaison("geste_reutilise", "Le contenu a changé depuis le premier essai : recommencez l'envoi.", 409);
  if (dit("en_cours")) return new RefusLiaison("en_cours", "Cet envoi est déjà en cours.", 409, 5);
  if (dit("would_trigger")) return new RefusLiaison("sequence", "Cette liste démarre une séquence d'envoi : choisissez une liste sans séquence. Rien n'a été écrit.", 409);
  if (dit("action_inconnue") || /not found|unknown tool|outil inconnu/i.test(texte)) return new RefusLiaison("cible_absente", `${nom === "Mail" ? "Mail" : "Votre CRM"} ne sait pas encore recevoir cet envoi : la liaison n'y est pas installée.`, 409);
  return new RefusLiaison("cible_refus", `${nom === "Mail" ? "Mail" : "Le CRM"} n'a pas accepté cet envoi. Vous pouvez réessayer, rien ne sera créé deux fois.`, 502);
}
