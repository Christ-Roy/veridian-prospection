/** Noms de routes et description OpenAPI des marchés d'un espace : calculés à chaque appel, un marché neuf a sa route aussitôt. */
export type MarcheApi = { id: string; nom: string; type: "marche" | "cible"; chemin: string };

export function slug(nom: string): string {
  return nom.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "marche";
}
/** Deux noms qui donnent la même route : la seconde porte le début de son identifiant. L'ordre est celui de l'identifiant, stable. */
export function nommer(segments: readonly { id: string; nom: string; parent_id: string | null }[]): MarcheApi[] {
  const pris = new Set(["openapi.json"]);
  const chemins = new Map<string, string>();
  for (const s of [...segments].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const c = pris.has(slug(s.nom)) ? `${slug(s.nom)}-${s.id.slice(0, 8)}` : slug(s.nom);
    pris.add(c);
    chemins.set(s.id, c);
  }
  return segments.map((s) => ({ id: s.id, nom: s.nom, type: s.parent_id ? ("cible" as const) : ("marche" as const), chemin: chemins.get(s.id)! }));
}

export function cheminsOpenApi(base: string, marches: readonly MarcheApi[]) {
  const rep = { responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } }, "401": { description: "Clé absente ou refusée" }, "429": { description: "Trop d'appels" } } };
  const param = (name: string, schema: object) => ({ name, in: "query", schema });
  const page = [param("page", { type: "integer", minimum: 1, default: 1 }), param("par_page", { type: "integer", minimum: 1, maximum: 50, default: 20 })];
  const paths: Record<string, object> = { "/": { get: { operationId: "marches", summary: "Marchés et cibles de l'espace", ...rep } } };
  for (const m of marches) {
    const id = m.chemin.replace(/-/g, "_");
    paths[`/${m.chemin}`] = { get: { operationId: id, summary: `${m.nom} : taille et pénétration`, ...rep } };
    paths[`/${m.chemin}/repartition`] = { get: { operationId: `${id}_repartition`, summary: `${m.nom} : répartition`, parameters: [param("axe", { type: "string", enum: ["departement", "naf", "effectif", "annee_creation", "forme"] })], ...rep } };
    paths[`/${m.chemin}/entreprises`] = { get: { operationId: `${id}_entreprises`, summary: `${m.nom} : entreprises, sans coordonnée`, parameters: page, ...rep } };
  }
  return { openapi: "3.1.0", info: { title: "Veridian Atlas, marchés de votre espace", version: "1" }, servers: [{ url: base }], security: [{ cle: [] }], components: { securitySchemes: { cle: { type: "http", scheme: "bearer", description: "Clé atl_…" } } }, paths };
}
