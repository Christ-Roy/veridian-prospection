/**
 * Cœur JSON-RPC du MCP de Prospection (Streamable HTTP, sans état) : `initialize`, `ping`,
 * `tools/list` paginé, `tools/call`. Indépendant de Next pour se tester sans serveur.
 */
import { z } from "zod";

import { ErreurOutil, outilsVisibles, type ContexteOutil } from "./outils";

export const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PAGE_OUTILS = 50;
export const SORTIE_MAX = 15_000; // la porte du Hub tronque à ~16 000 caractères : on reste en dessous

type Id = string | number | null;
export type Message = { jsonrpc?: string; id?: Id; method?: string; params?: Record<string, unknown> };
export type Reponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string } };

const err = (id: Id, code: number, message: string): Reponse => ({ jsonrpc: "2.0", id, error: { code, message } });
const ok = (id: Id, result: unknown): Reponse => ({ jsonrpc: "2.0", id, result });

/** Journal d'un appel : nom et issue, jamais les arguments (contrat MCP, « Accès »). */
export type Journal = (e: { outil: string; issue: "ok" | "erreur" | "refus"; ms: number }) => void;

function schema(o: z.ZodObject) {
  const s = z.toJSONSchema(o, { io: "input" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

function texte(valeur: unknown): string {
  const t = JSON.stringify(valeur);
  if (t.length <= SORTIE_MAX) return t;
  return `${t.slice(0, SORTIE_MAX)}\n[réponse tronquée à ${SORTIE_MAX} caractères : réduisez par_page ou affinez la recherche]`;
}

export async function traiter(m: Message, c: ContexteOutil, journal: Journal = () => {}): Promise<Reponse | null> {
  const id = m.id ?? null;
  // Notification (pas d'id) : aucune réponse.
  if (m.id === undefined) return null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return err(id, -32600, "requête JSON-RPC invalide");
  const params = m.params ?? {};

  switch (m.method) {
    case "initialize": {
      const demandee = typeof params.protocolVersion === "string" ? params.protocolVersion : VERSIONS[0];
      return ok(id, {
        protocolVersion: VERSIONS.includes(demandee) ? demandee : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "prospection", title: "Prospection Veridian", version: "1.0.0" },
        instructions:
          "Entreprises françaises de l'espace de l'utilisateur. Cherchez avec rechercher_entreprises, puis ouvrez une fiche par SIREN.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list": {
      const tous = outilsVisibles(c);
      const debut = typeof params.cursor === "string" && /^\d+$/.test(params.cursor) ? Number(params.cursor) : 0;
      const page = tous.slice(debut, debut + PAGE_OUTILS);
      return ok(id, {
        tools: page.map((o) => ({
          name: o.name,
          title: o.title,
          description: o.description,
          inputSchema: schema(o.input),
          annotations: { title: o.title, ...o.annotations },
        })),
        ...(debut + PAGE_OUTILS < tous.length ? { nextCursor: String(debut + PAGE_OUTILS) } : {}),
      });
    }
    case "tools/call": {
      const nom = params.name;
      const outil = outilsVisibles(c).find((o) => o.name === nom);
      // Un outil masqué pour cet utilisateur répond comme un outil inexistant.
      if (!outil) return err(id, -32602, `outil inconnu : ${String(nom)}`);
      const t0 = Date.now();
      const args = outil.input.safeParse(params.arguments ?? {});
      if (!args.success) {
        journal({ outil: outil.name, issue: "refus", ms: Date.now() - t0 });
        const detail = args.error.issues.map((i) => `${i.path.join(".") || "arguments"} : ${i.message}`).join(" ; ");
        return ok(id, { isError: true, content: [{ type: "text", text: `Arguments invalides. ${detail}` }] });
      }
      try {
        const valeur = await outil.run(args.data as Record<string, unknown>, c);
        journal({ outil: outil.name, issue: "ok", ms: Date.now() - t0 });
        return ok(id, { content: [{ type: "text", text: texte(valeur) }] });
      } catch (e) {
        journal({ outil: outil.name, issue: "erreur", ms: Date.now() - t0 });
        if (e instanceof ErreurOutil) return ok(id, { isError: true, content: [{ type: "text", text: e.message }] });
        console.error(`[mcp] ${outil.name} :`, e);
        return ok(id, { isError: true, content: [{ type: "text", text: "Erreur interne de Prospection. Réessayez plus tard." }] });
      }
    }
    default:
      return err(id, -32601, `méthode non prise en charge : ${m.method}`);
  }
}
