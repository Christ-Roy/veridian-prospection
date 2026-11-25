/**
 * Cœur JSON-RPC du MCP de Prospection (Streamable HTTP, sans état) : `initialize`, `ping`,
 * `tools/list` paginé, `tools/call`. Indépendant de Next pour se tester sans serveur.
 */
import { z } from "zod";

import { avecClients } from "@/atlas/clients";
import { selonPlan } from "@/atlas/gratuit";
import { enRestreint } from "@/atlas/restreint";

import { refuserCoordonnees, retirerCoordonnees, sansCoordonnees } from "./coordonnees";
import { descriptionServie, ErreurOutil, outilsVisibles, type ContexteOutil } from "./outils";

export const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PAGE_OUTILS = 50;
export const SORTIE_MAX = 15_000; // la porte du Hub tronque à ~16 000 caractères : on reste en dessous
/** Appel venu d'un programme (en-tête X-Veridian-MCP-Appel) : 1 Mo, mesuré sur le corps envoyé, comme le Hub le mesure. */
export const SORTIE_MAX_PROGRAMME = 1_000_000;

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

/**
 * Résultat d'un outil. Appel direct : texte, coupé avec un avis (un modèle le lit). Appel d'un programme : la donnée
 * entière en structuredContent, une seule fois, ou une erreur franche au-delà de 1 Mo ; jamais un JSON coupé.
 */
function resultat(id: Id, valeur: unknown, programme: boolean): Reponse {
  if (!programme) return ok(id, { content: [{ type: "text", text: texte(valeur) }] });
  const objet = valeur !== null && typeof valeur === "object" && !Array.isArray(valeur);
  const r = objet
    ? ok(id, { content: [{ type: "text", text: "Donnée dans structuredContent." }], structuredContent: valeur })
    : ok(id, { content: [{ type: "text", text: JSON.stringify(valeur ?? null) }] });
  const octets = Buffer.byteLength(JSON.stringify(r));
  if (octets <= SORTIE_MAX_PROGRAMME) return r;
  return ok(id, {
    isError: true,
    content: [{ type: "text", text: `Réponse trop grosse : ${octets} octets, ${SORTIE_MAX_PROGRAMME} au plus. Demandez moins de lignes ou moins de colonnes (extraire_segment : même curseur, limite plus petite, rien n'est recompté).` }],
  });
}

/**
 * `programme` change la taille et la forme de la réponse. `restreint` (l'appel porte l'en-tête, même dans un lot) retire
 * les coordonnées hors extraire_segment (coordonnees.ts). Aucun des deux ne donne de droit, de quota ni de trace.
 */
export async function traiter(m: Message, c: ContexteOutil, journal: Journal = () => {}, programme = false, restreint = programme): Promise<Reponse | null> {
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
          "Atlas : le marché des entreprises françaises (ODH). Mesurez un marché (analyser_marche), listez-le (explorer_marche, " +
            "lister_entreprises), vérifiez une liste de SIREN (verifier_entreprises), ouvrez une fiche par SIREN.",
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
          description: descriptionServie(o),
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
        const a = args.data as Record<string, unknown>;
        const sans = sansCoordonnees(outil, c, restreint);
        if (sans) refuserCoordonnees(outil, a);
        const valeur = await avecClients(c.ctx.tenantId, async () => (sans ? retirerCoordonnees(await enRestreint(() => outil.run(a, c))) : selonPlan(outil, a, c)));
        journal({ outil: outil.name, issue: "ok", ms: Date.now() - t0 });
        return resultat(id, valeur, programme);
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
