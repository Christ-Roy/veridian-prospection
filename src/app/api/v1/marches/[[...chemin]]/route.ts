/**
 * API par marché (VISION-ATLAS R2) : chaque marché enregistré a ses routes, sans rien déployer. Clé `atl_` de l'espace (accès avancé).
 *   GET /api/v1/marches                              les marchés et cibles de l'espace
 *   GET /api/v1/marches/openapi.json                 la description, une route par marché
 *   GET /api/v1/marches/{marche}                     définition, taille, pénétration
 *   GET /api/v1/marches/{marche}/repartition?axe=    departement, naf, effectif, annee_creation, forme
 *   GET /api/v1/marches/{marche}/entreprises?page=   les entreprises, sans coordonnée
 * `{marche}` : l'identifiant, ou le nom en minuscules sans accents (« eleveurs-canins »).
 */
import { NextRequest, NextResponse } from "next/server";

import { contexteDepuisCle, droits } from "@/atlas/acces";
import { avecClients } from "@/atlas/clients";
import { retirerCoordonnees } from "@/lib/mcp/coordonnees";
import { cheminsOpenApi, nommer, type MarcheApi } from "@/atlas/api-marches";
import * as seg from "@/atlas/segments";
import { resolveInsertWorkspaceId } from "@/lib/auth/user-context";
import { ErreurOutil } from "@/lib/mcp/erreur";
import { outilsVisibles } from "@/lib/mcp/outils";
import { isRateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const rendre = (corps: unknown, status = 200, h: Record<string, string> = {}) => NextResponse.json(corps, { status, headers: { "Cache-Control": "no-store", ...h } });
const refus = (status: number, error: string, h = {}) => rendre({ error }, status, h);
const AXES = new Set(["departement", "naf", "effectif", "annee_creation", "forme"]);
const entier = (v: string | null, defaut: number, max: number) => (v && /^\d{1,4}$/.test(v) ? Math.min(max, Math.max(1, Number(v))) : defaut);

export async function GET(request: NextRequest, { params }: { params: Promise<{ chemin?: string[] }> }) {
  const ctx = await contexteDepuisCle(request.headers.get("authorization"));
  if (!ctx) return refus(401, "Clé API absente, invalide ou révoquée (Authorization: Bearer atl_…)", { "WWW-Authenticate": "Bearer" });
  if (isRateLimited(`api-marches:${ctx.userId}`, 120, 60_000)) return refus(429, "120 appels par minute au plus", { "Retry-After": "60" });
  const [cle, suite, ...reste] = (await params).chemin ?? [];
  if (reste.length) return refus(404, "route inconnue");
  const marches: MarcheApi[] = nommer((await seg.listerArbre(ctx.tenantId)).segments);
  const base = `${process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin}/api/v1/marches`;
  if (!cle) return rendre({ marches: marches.map((m) => ({ ...m, url: `${base}/${m.chemin}` })) });
  if (cle === "openapi.json" && !suite) return rendre(cheminsOpenApi(base, marches));

  const m = marches.find((x) => x.id === cle.toLowerCase() || x.chemin === cle);
  if (!m) return refus(404, "marché inconnu dans cet espace");
  const c = { ctx, workspaceId: await resolveInsertWorkspaceId(ctx), client: "clé API", droits: await droits(ctx.userId, ctx.tenantId) };
  // Les mêmes outils que l'écran et l'IA : mêmes droits, mêmes chiffres.
  const jouer = async (nom: string, args: Record<string, unknown>) => {
    const o = outilsVisibles(c).find((x) => x.name === nom)!;
    return (await o.run(o.input.parse(args) as Record<string, unknown>, c)) as Record<string, unknown>;
  };
  const q = request.nextUrl.searchParams;
  try {
    return await avecClients(ctx.tenantId, async () => {
      const filtre = await seg.filtreEffectif(ctx.tenantId, m.id);
      if (!suite) {
        const [taille, part, d] = await Promise.all([jouer("analyser_marche", { filtre }), jouer("penetration_marche", { segment_id: m.id }), jouer("lire_segment", { segment_id: m.id })]);
        return rendre({ ...m, url: `${base}/${m.chemin}`, version: d.version, filtre, entreprises_contactables_du_filtre: d.total, marche: taille.total, conditions_ignorees: taille.conditions_ignorees, penetration: part, provenance: taille.provenance });
      }
      if (suite === "repartition") {
        const axe = q.get("axe") ?? "departement";
        if (!AXES.has(axe)) return refus(400, `axe : ${[...AXES].join(", ")}`);
        const r = await jouer("analyser_marche", { filtre, axe, limite: entier(q.get("limite"), 120, 500) });
        return rendre({ axe, total: r.total, lignes: r.lignes, conditions_ignorees: r.conditions_ignorees });
      }
      if (suite === "entreprises") {
        const page = entier(q.get("page"), 1, 200), par_page = entier(q.get("par_page"), 20, 50);
        // Une cible liste ses fiches contactables ; un marché, toutes ses entreprises. Jamais une coordonnée : l'extraction a son outil.
        const r = m.type === "cible" ? await jouer("classer_segment", { segment_id: m.id, page, par_page }) : await jouer("lister_entreprises", { filtre, page, par_page });
        const propre = retirerCoordonnees(r) as Record<string, unknown>;
        return rendre({ page, par_page, total: propre.total, page_suivante: propre.page_suivante ?? null, lignes: propre.lignes, conditions_ignorees: propre.conditions_ignorees ?? [] });
      }
      return refus(404, "route inconnue : repartition ou entreprises");
    });
  } catch (e) {
    if (e instanceof ErreurOutil) return refus(400, e.message);
    console.error("[api-marches]", e);
    return refus(500, "Erreur interne");
  }
}
