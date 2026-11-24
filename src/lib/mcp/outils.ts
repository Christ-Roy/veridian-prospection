/**
 * Outils MCP de Prospection : ceux d'Atlas (src/atlas/outils-mcp.ts), sur les données ClickHouse d'ODH.
 * Les outils de l'ancienne app (base `entreprises` locale) sont retirés le 09/11 avec elle.
 * L'espace vient de l'utilisateur (jamais d'un argument) : une IA n'a ni plus de données ni plus de
 * droits que l'utilisateur dans l'interface. Sorties compactes et paginées (contrat MCP §5).
 */
import type { z } from "zod";

import type { UserContext } from "@/lib/auth/user-context";
import type { Droits } from "@/atlas/acces";
import { OUTILS_ATLAS } from "@/atlas/outils-mcp";

import { ErreurOutil } from "./erreur";

/**
 * `client` : le client IA d'origine (jeton du Hub), pour signer les versions créées par une IA.
 * `droits` : accès avancé et administration Atlas (src/atlas/acces.ts) ; absents, les outils réservés restent cachés.
 */
export type ContexteOutil = { ctx: UserContext; workspaceId: string | null; client?: string | null; droits?: Droits };

type Annotations = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean };

export type Outil = {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  annotations: Annotations;
  /** L'outil n'apparaît dans `tools/list` que si l'utilisateur a ce droit dans l'interface. */
  visible?: (c: ContexteOutil) => boolean;
  /** Réservé à l'accès avancé de l'espace, ou aux administrateurs Atlas. */
  acces?: "avance" | "admin";
  run: (args: Record<string, unknown>, c: ContexteOutil) => Promise<unknown>;
};

export { ErreurOutil };

export function outilsVisibles(c: ContexteOutil): Outil[] {
  return OUTILS_ATLAS.filter(
    (o) => (!o.visible || o.visible(c)) && (!o.acces || (o.acces === "avance" ? !!c.droits?.accesAvance : !!c.droits?.adminAtlas)),
  );
}

/** Le Hub refuse, dans un programme, un outil qui n'est pas en lecture seule s'il n'est pas nommé dans `autoriser` (24/11). */
const MENTION_PROGRAMME = "Dans un programme : à nommer dans autoriser.";

/** Description servie : la mention se déduit des annotations, un nouvel outil d'écriture l'a donc d'office. */
export function descriptionServie(o: Pick<Outil, "description" | "annotations">): string {
  const a = o.annotations;
  if (a.readOnlyHint && !a.destructiveHint) return o.description;
  const [premiere, ...reste] = o.description.split("\n");
  return [`${premiere} ${MENTION_PROGRAMME}`, ...reste].join("\n");
}
