/** Pages ouvertes sans compte : des comptes du cube, jamais une entreprise (src/atlas/marches-publics.ts). Edge-safe. */
export const isPublicPath = (path: string): boolean => path === "/marches" || /^\/marche\/[^/]+$/.test(path);
