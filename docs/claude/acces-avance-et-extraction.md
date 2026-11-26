# Accès avancé, clés API et extraction (sorti du CLAUDE.md le 26/11, inchangé)

- Accès avancé (16/11, `src/atlas/acces.ts`, `sql.ts`) : par espace (`tenants.acces_avance`), accordé par un administrateur
  Atlas (`users.atlas_admin`, outil `accorder_acces_avance` ou volet « API et accès avancé »), jamais par le plan. Donne
  `requete_sql` (garde SELECT, 1 000 lignes) et les clés API
  (`Bearer atl_…` sur `/api/atlas/[outil]`, empreinte SHA-256 seule). `verifier_entreprises` : 50/jour gratuit, 5 000 payant.
- `extraire_segment` (VER-242, `src/atlas/extraction.ts`) : liste de SIREN figée en base (curseur stable 7 jours), coordonnées
  relues à chaque page, quota 5 000 lignes/jour/espace compté dans `atlas_exports` sous verrou, canaux `mcp`, `liaison` et `ecran` : l'export Excel/CSV
  réserve ses lignes avant de lire ODH (`reserverExport`), est coupé au reste du jour (`X-Atlas-Coupe-Quota`), 429 à zéro (Robert, 26/11). Appel direct : réponse
  coupée à 15 000 caractères (`SORTIE_MAX`, chez nous), 30 lignes ; en-tête `X-Veridian-MCP-Appel: programme` : 1 Mo, 1 000 lignes.
  Programme = aucune coordonnée hors `extraire_segment`, plan payant compris, sauf accès avancé (`src/lib/mcp/coordonnees.ts`).
  Le Hub ne garde que 300 caractères de la 1re ligne des descriptions.
- Garde SQL (26/11) : chaque source de chaque liste `FROM a, b, c` et chaque `JOIN` est contrôlée, une fonction de table
  (`url`, `numbers`, `remote`…) est refusée même déguisée en sous-requête nommée. Barrière réelle : le compte ClickHouse
  `prospection_ro` (rôle `prospection_ro_role`, ne voit que la base `odh`, `information_schema` refusé, mesuré le 26/11).
