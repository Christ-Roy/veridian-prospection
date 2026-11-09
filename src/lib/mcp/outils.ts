/**
 * Outils MCP de Prospection. Chaque outil appelle les mêmes fonctions que l'écran correspondant, avec
 * l'espace déduit de l'utilisateur (jamais d'un argument) : une IA n'a ni plus de données ni plus de
 * droits que l'utilisateur dans l'interface. Sorties compactes et paginées (contrat MCP §5).
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getLeads, getSegmentLeads, getAllSegmentCounts, patchOutreach } from "@/lib/queries";
import { getAllSegments } from "@/lib/segments";
import { cached } from "@/lib/cache";
import { getTenantProspectLimit } from "@/lib/auth/tenant";
import type { UserContext } from "@/lib/auth/user-context";
import { serveLeadDetail } from "@/lib/leads/serve-detail";
import { isKnownStatus } from "@/lib/outreach/status";
import type { Lead } from "@/lib/types";

export type ContexteOutil = { ctx: UserContext; workspaceId: string | null };

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

export class ErreurOutil extends Error {}

const LECTURE: Annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Un lecteur (`viewer`) consulte, il ne modifie pas le suivi commercial.
export function peutEcrire(ctx: UserContext): boolean {
  return ctx.isAdmin || ctx.workspaces.some((w) => w.role !== "viewer");
}

const SIREN = z.string().regex(/^\d{9}$/, "SIREN à 9 chiffres");
const PAGE = z.number().int().min(1).max(500).default(1);
const PAR_PAGE = z.number().int().min(1).max(50).default(20);

/** Ligne compacte d'une liste : ce qu'il faut pour choisir quelle fiche ouvrir. */
function compact(l: Lead) {
  return {
    siren: l.siren ?? l.domain,
    nom: l.nom_entreprise,
    commune: l.ville,
    departement: l.departement,
    code_naf: l.code_naf,
    effectifs: l.effectifs,
    chiffre_affaires: l.ca,
    site: l.web_domain ?? null,
    email: l.email,
    telephone: l.phone,
    dirigeant: l.dirigeant,
  };
}

/** Plafond du plan : au-delà, la liste est vide, comme à l'écran. */
async function paginer(
  userId: string,
  r: { data: Lead[]; total: number },
  page: number,
  parPage: number,
) {
  const limite = await getTenantProspectLimit(userId);
  const total = Math.min(r.total, limite);
  const pages = Math.max(1, Math.ceil(total / parPage));
  const lignes = (page - 1) * parPage >= limite ? [] : r.data;
  return {
    total,
    page,
    pages,
    page_suivante: page < pages ? page + 1 : null,
    ...(r.total > limite ? { plafond_du_plan: limite } : {}),
    entreprises: lignes.map(compact),
  };
}

export const OUTILS: Outil[] = [
  {
    name: "rechercher_entreprises",
    title: "Rechercher des entreprises",
    description: "Cherche des entreprises françaises par nom, SIREN, dirigeant, département, code NAF ou commune ; liste paginée.",
    input: z.object({
      recherche: z.string().trim().min(2).max(100).optional().describe("Nom, SIREN, dirigeant, email ou téléphone"),
      departements: z.array(z.string().regex(/^(\d{2,3}|2A|2B)$/)).max(20).optional().describe("Codes département, ex. [\"69\", \"38\"]"),
      codes_naf: z.array(z.string().regex(/^\d{2}\.\d{2}[A-Z]$/)).max(20).optional().describe("Codes NAF exacts, ex. [\"43.22A\"]"),
      commune: z.string().trim().min(2).max(80).optional(),
      avec_email: z.boolean().optional(),
      avec_telephone: z.boolean().optional(),
      tri: z.enum(["score", "chiffre_affaires", "date_creation"]).default("score"),
      page: PAGE,
      par_page: PAR_PAGE,
    }),
    annotations: LECTURE,
    run: async (a, c) => {
      const filters: Record<string, string> = {};
      if (a.recherche) filters.search = String(a.recherche);
      if (Array.isArray(a.departements) && a.departements.length) filters.departement = a.departements.join(",");
      if (Array.isArray(a.codes_naf) && a.codes_naf.length) filters.code_naf = a.codes_naf.join(",");
      if (a.commune) filters.commune = String(a.commune).toUpperCase();
      if (a.avec_email === true) filters.email = "!empty";
      if (a.avec_email === false) filters.email = "empty";
      if (a.avec_telephone === true) filters.phone = "!empty";
      if (a.avec_telephone === false) filters.phone = "empty";
      const sort = { score: "prospect_score", chiffre_affaires: "ca", date_creation: "date_creation" }[a.tri as string] ?? "prospect_score";
      const page = a.page as number, parPage = a.par_page as number;
      const r = await getLeads({ page, pageSize: parPage, sort, sortDir: "desc", filters }, c.ctx.tenantId);
      return paginer(c.ctx.userId, r, page, parPage);
    },
  },
  {
    name: "fiche_entreprise",
    title: "Fiche d'une entreprise",
    description: "Fiche complète d'une entreprise par SIREN (contacts, dirigeant, finances, web) ; compte comme une consultation dans le quota.",
    input: z.object({ siren: SIREN }),
    // Consulter une fiche l'inscrit dans l'historique et le quota : pas une lecture pure, jamais destructif.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (a, c) => {
      const r = await serveLeadDetail({
        userId: c.ctx.userId,
        siren: String(a.siren),
        scope: async () => ({ tenantId: c.ctx.tenantId, workspaceId: c.workspaceId }),
      });
      if (r.kind === "rate_limited") throw new ErreurOutil("Trop de fiches ouvertes cette minute (30 au plus). Réessayez dans 30 secondes.");
      if (r.kind === "not_found") throw new ErreurOutil(`Aucune entreprise suivie avec le SIREN ${a.siren}.`);
      return r.lead;
    },
  },
  {
    name: "entreprises_par_departement",
    title: "Entreprises par département",
    description: "Nombre d'entreprises suivies dans chaque département français.",
    input: z.object({}),
    annotations: LECTURE,
    run: async () => {
      const rows = await cached("mcp-by-department", 5 * 60 * 1000, () =>
        prisma.$queryRaw<{ dept: string; count: bigint }[]>`
          SELECT departement AS dept, COUNT(*) AS count
          FROM entreprises
          WHERE departement IS NOT NULL
            AND is_registrar = false
            AND COALESCE(ca_suspect, false) = false
          GROUP BY departement
          ORDER BY departement
        `,
      );
      return Object.fromEntries(rows.filter((r) => r.dept).map((r) => [r.dept, Number(r.count)]));
    },
  },
  {
    name: "lister_segments",
    title: "Lister les segments",
    description: "Segments de prospection disponibles (identifiant, libellé, nombre d'entreprises).",
    input: z.object({}),
    annotations: LECTURE,
    run: async (_a, c) => {
      const tenantId = c.ctx.tenantId;
      const counts = await cached(`segment-counts-${tenantId}`, 10 * 60 * 1000, () => getAllSegmentCounts(tenantId));
      return getAllSegments().map((s) => ({ id: s.id, libelle: s.label, type: s.type, entreprises: counts[s.id] ?? 0 }));
    },
  },
  {
    name: "entreprises_du_segment",
    title: "Entreprises d'un segment",
    description: "Liste paginée des entreprises d'un segment (identifiant donné par lister_segments).",
    input: z.object({ segment: z.string().regex(/^[a-z0-9_/-]{1,80}$/i), page: PAGE, par_page: PAR_PAGE }),
    annotations: LECTURE,
    run: async (a, c) => {
      const page = a.page as number, parPage = a.par_page as number;
      const r = await getSegmentLeads(String(a.segment), { page, pageSize: parPage, sortDir: "desc" }, c.ctx.tenantId);
      return paginer(c.ctx.userId, (r ?? { data: [], total: 0 }) as unknown as { data: Lead[]; total: number }, page, parPage);
    },
  },
  {
    name: "changer_statut",
    title: "Changer le statut d'un prospect",
    description: "Met à jour le statut commercial d'une entreprise (ex. a_contacter, rappeler, interesse, pas_interesse).",
    input: z.object({ siren: SIREN, statut: z.string().refine(isKnownStatus, "statut inconnu") }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    visible: (c) => peutEcrire(c.ctx),
    run: async (a, c) => {
      await patchOutreach(String(a.siren), { status: String(a.statut) }, c.ctx.tenantId, c.workspaceId, c.ctx.userId);
      return { ok: true, siren: a.siren, statut: a.statut };
    },
  },
];

export function outilsVisibles(c: ContexteOutil): Outil[] {
  return OUTILS.filter((o) => !o.visible || o.visible(c));
}
