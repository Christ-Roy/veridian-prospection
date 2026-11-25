/**
 * Jeton d'action : une autre app Veridian (`act.sub`) demande une action au nom d'un utilisateur, sous une portée étroite
 * (veridian-hub/docs/CONTRAT-HUB.md §5.19.5). 120 s au plus, un seul usage, audience à part de `/api/mcp`.
 */
import { JetonRefuse, mcpAudience, verifierJwtHub, type OptsJeton } from "@/lib/mcp/jeton-hub";

export type JetonAction = { hubUserId: string; tenantId: string; app: string; portees: string[]; jti: string; exp: number };

export function actionsAudience(env: NodeJS.ProcessEnv = process.env): string {
  return new URL("/api/veridian/actions", mcpAudience(env)).toString();
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const VIE_MAX_S = 120;

export async function verifierJetonAction(jeton: string, opts: OptsJeton = {}): Promise<JetonAction> {
  const c = await verifierJwtHub(jeton, actionsAudience(opts.env ?? process.env), opts);
  const act = c.act as { sub?: unknown; act?: unknown } | undefined;
  if (!act || typeof act !== "object" || Array.isArray(act) || typeof act.sub !== "string" || act.act !== undefined) throw new JetonRefuse("acteur absent");
  const app = /^app:([a-z]{2,20})$/.exec(act.sub)?.[1];
  if (!app) throw new JetonRefuse("acteur inconnu");
  if (typeof c.iat !== "number" || c.exp - c.iat > VIE_MAX_S || c.exp <= c.iat) throw new JetonRefuse("durée refusée");
  if (c.exp * 1000 <= (opts.maintenant ?? Date.now())) throw new JetonRefuse("jeton expiré");
  if (typeof c.jti !== "string" || !/^[\w.:-]{8,128}$/.test(c.jti)) throw new JetonRefuse("identifiant absent");
  if (typeof c.tenant_id !== "string" || !UUID.test(c.tenant_id)) throw new JetonRefuse("organisation absente");
  const portees = typeof c.scope === "string" ? c.scope.split(" ").filter(Boolean) : [];
  return { hubUserId: c.sub.toLowerCase(), tenantId: c.tenant_id.toLowerCase(), app, portees, jti: c.jti, exp: c.exp };
}
