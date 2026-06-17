/**
 * GET /api/search/fields — catalogue auto-documenté des champs filtrables.
 *
 * Permet à l'IA de SAVOIR ce qu'elle peut filtrer (champ, type, opérateurs,
 * valeurs d'énumération) sans deviner. À appeler une fois pour découvrir le
 * vocabulaire du moteur, puis composer des requêtes /api/search/{estimate,companies}.
 *
 * Auth : bearer machine (SEARCH_API_SECRET).
 */
import { NextResponse } from "next/server";
import { authenticateSearch } from "@/lib/search/auth";
import { FIELD_CATALOG } from "@/lib/search/fields";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = authenticateSearch(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const fields = Object.entries(FIELD_CATALOG).map(([key, def]) => ({
    field: key,
    type: def.type,
    operators: def.ops,
    label: def.label,
    ...(def.enumValues ? { allowed_values: def.enumValues } : {}),
  }));

  return NextResponse.json({
    count: fields.length,
    operators_doc: {
      eq: "égal", neq: "différent", gte: ">=", lte: "<=", gt: ">", lt: "<",
      between: "entre min et max (numérique)",
      in: "dans la liste (values[])",
      exists: "value:true => non null ; value:false => null",
      contains: "contient (ILIKE, texte)",
    },
    request_shape: {
      filters: { all: "[conditions AND]", any: "[conditions OR]" },
      condition: { field: "<field>", op: "<operator>", value: "…", values: "[…]", min: 0, max: 0 },
    },
    fields,
  });
}
