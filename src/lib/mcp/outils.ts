/**
 * Outils MCP de Prospection : ceux d'Atlas (src/atlas/outils-mcp.ts), sur les données ClickHouse d'ODH.
 * Les outils de l'ancienne app (base `entreprises` locale) sont retirés le 09/11 avec elle.
 * L'espace vient de l'utilisateur (jamais d'un argument) : une IA n'a ni plus de données ni plus de
 * droits que l'utilisateur dans l'interface. Sorties compactes et paginées (contrat MCP §5).
 */
import type { z } from "zod";

import type { UserContext } from "@/lib/auth/user-context";
import { OUTILS_ATLAS } from "@/atlas/outils-mcp";

import { ErreurOutil } from "./erreur";

/** `client` : le client IA d'origine (jeton du Hub), pour signer les versions créées par une IA. */
export type ContexteOutil = { ctx: UserContext; workspaceId: string | null; client?: string | null };

type Annotations = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean };

export type Outil = {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  annotations: Annotations;
  /** L'outil n'apparaît dans `tools/list` que si l'utilisateur a ce droit dans l'interface. */
  visible?: (c: ContexteOutil) => boolean;
  run: (args: Record<string, unknown>, c: ContexteOutil) => Promise<unknown>;
};

export { ErreurOutil };

export function outilsVisibles(c: ContexteOutil): Outil[] {
  return OUTILS_ATLAS.filter((o) => !o.visible || o.visible(c));
}
