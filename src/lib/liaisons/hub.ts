/**
 * Demande d'un jeton d'action au Hub (INTEGRATIONS-NATIVES §2.2) : 120 s, une cible, une portée, au nom d'un
 * utilisateur dont Atlas tient la poignée. Le Hub décide (membre, organisation, interrupteur de la paire) à chaque fois.
 */
import { createHmac, randomBytes } from "node:crypto";

import { refusDuHub, RefusLiaison, type Cible } from "./erreurs";
import { secretCourant } from "@/lib/hub/secrets";

export const PORTEES: Record<Cible, string> = { crm: "crm:societe.ecrire crm:tache.ecrire", notifuse: "notifuse:contacts.ecrire" };

export type JetonAction = { jeton: string; url: string };
export type Opts = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; maintenant?: () => number };

const DELAI_MS = 8000;

/**
 * Le jeton ne part qu'en https vers un domaine Veridian, quoi que réponde le Hub. Hors production, http local pour les bancs.
 */
export function adresseSure(url: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (env.NODE_ENV !== "production" && u.protocol === "http:" && u.hostname === "127.0.0.1") return u.href;
  return u.protocol === "https:" && u.port === "" && u.hostname.endsWith(".veridian.site") ? u.href : null;
}

export async function appelerHub(chemin: string, contenu: object, o: Opts, delaiMs: number): Promise<{ res: Response; r: Record<string, unknown> | null }> {
  const env = o.env ?? process.env;
  const secret = secretCourant(env);
  const hub = (env.HUB_API_URL || env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site").replace(/\/+$/, "");
  if (!secret) throw new RefusLiaison("config", "Les liaisons ne sont pas configurées sur ce serveur.", 503);
  const corps = JSON.stringify(contenu);
  const ts = String((o.maintenant ?? Date.now)());
  const nonce = randomBytes(16).toString("hex");
  try {
    const res = await (o.fetchImpl ?? fetch)(`${hub}${chemin}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(delaiMs),
      headers: {
        "Content-Type": "application/json",
        "X-Veridian-App": "prospection",
        "X-Veridian-Timestamp": ts,
        "X-Veridian-Nonce": nonce,
        "X-Veridian-Hub-Signature": createHmac("sha256", secret).update(`${ts}.${nonce}.${corps}`).digest("hex"),
      },
      body: corps,
    });
    return { res, r: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    throw new RefusLiaison("hub_injoignable", "Veridian ne répond pas : rien n'a été envoyé. Réessayez dans un instant.", 503);
  }
}

const memeEspace = (recu: unknown, voulu: string) => typeof recu === "string" && recu.toLowerCase() === voulu.toLowerCase();

export type EtatPaire = "allumee" | "eteinte" | "indisponible" | "inconnu";

/**
 * État des liaisons de cette organisation, de quoi ne pas montrer un bouton qui refusera. Hub muet ou réponse illisible :
 * « inconnu » partout, le clic dira. `null` : le Hub ne reconnaît plus cette poignée.
 */
export async function etatDesPaires(poignee: string, hubTenantId: string, o: Opts = {}): Promise<Record<Cible, EtatPaire> | null> {
  const etats: Record<Cible, EtatPaire> = { crm: "inconnu", notifuse: "inconnu" };
  try {
    const { res, r } = await appelerHub("/api/delegation/paires", { subject_grant: poignee }, o, 2500);
    if (res.status === 403 && r?.error === "grant_invalid") return null;
    if (!res.ok || !memeEspace(r?.tenant_id, hubTenantId) || !Array.isArray(r?.paires)) return etats;
    for (const p of r.paires as Record<string, unknown>[]) {
      const etat = p?.etat;
      if ((p?.audience === "crm" || p?.audience === "notifuse") && (etat === "allumee" || etat === "eteinte" || etat === "indisponible")) etats[p.audience] = etat;
    }
  } catch {
    // Hub injoignable : inconnu.
  }
  return etats;
}

export async function demanderJeton(
  d: { poignee: string; cible: Cible; hubTenantId: string; motif: string },
  o: Opts = {},
): Promise<JetonAction> {
  const env = o.env ?? process.env;
  const { res, r } = await appelerHub(
    "/api/delegation/jeton",
    { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_grant: d.poignee, audience: d.cible, scope: PORTEES[d.cible], motif: d.motif },
    o,
    DELAI_MS,
  );
  if (!res.ok) {
    const attendre = Number(res.headers.get("retry-after"));
    const code = res.status === 429 ? "rate_limited" : typeof r?.error === "string" ? r.error : `http_${res.status}`;
    console.warn(`[liaisons] hub refus cible=${d.cible} code=${code.slice(0, 40)} http=${res.status}`);
    throw refusDuHub(code, d.cible, Number.isFinite(attendre) && attendre > 0 ? Math.min(attendre, 3600) : undefined);
  }
  const url = adresseSure(r?.url ?? (d.cible === "crm" ? env.LIAISON_URL_CRM : env.LIAISON_URL_NOTIFUSE), env);
  if (typeof r?.access_token !== "string" || r.access_token.length < 20 || !url) {
    console.error(`[liaisons] réponse du Hub inutilisable cible=${d.cible} url=${!!url}`);
    throw refusDuHub("reponse_invalide", d.cible);
  }
  // L'espace du jeton doit être celui où l'utilisateur travaille ici : jamais les prospects d'un espace dans un autre.
  if (!memeEspace(r.tenant_id, d.hubTenantId)) {
    console.error(`[liaisons] confusion d'espace refusée cible=${d.cible}`);
    throw new RefusLiaison("autre_espace", "Votre connexion Veridian vise une autre organisation : rouvrez Atlas depuis la bonne.", 403);
  }
  return { jeton: r.access_token, url };
}
