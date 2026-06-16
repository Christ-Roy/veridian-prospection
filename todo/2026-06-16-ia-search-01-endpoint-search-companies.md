# [PROSPECTION] `/api/search/companies` — endpoint de recherche IA (cœur du moteur)

> **Sévérité** : 🟡 P1
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Dépend de** : -06 (banc d'essai + audit) — ne pas coder à l'aveugle.

## But

L'endpoint que l'IA appelle pour **trouver des entreprises** : elle envoie un
JSON de filtres structuré, reçoit une page de résultats. C'est le cœur du moteur
de sourcing.

## Contrat (proposition à valider sur le banc)

`POST /api/search/companies`

```jsonc
// Request
{
  "tenant_id": "veridian",          // multi-tenant-ready dès V1 (cf principe)
  "filters": { /* schéma ticket -02 */ },
  "sort": { "field": "prospect_score", "dir": "desc" },
  "page": 1,
  "page_size": 50,                  // borné (max 200) anti-DoS
  "fields": ["siren","denomination","best_phone_e164","best_email_normalized","ca","commune"]
                                     // projection : l'IA demande ce dont elle a besoin
}
// Response
{
  "total_estimated": 12400,         // COUNT (peut être plafonné/approximé si énorme)
  "page": 1, "page_size": 50,
  "results": [ { /* champs projetés */ } ],
  "query_id": "uuid"                // pour ré-export / traçabilité
}
```

## Exigences

1. **Auth M2M** : bearer/HMAC (réutiliser le pattern `CRON_SECRET` ou une vraie
   clé API machine — décider sur le banc). JAMAIS anonyme.
2. **multi-tenant-ready** : `tenant_id` dans la signature. En V1 = "veridian"
   (un seul). Le code route DÉJÀ par tenant (jointure outreach tenant-scoped via
   le helper existant) pour ne rien défaire à l'ouverture clients.
3. **ZÉRO SQL libre** : `filters` validé Zod (ticket -02) → `buildSearchWhereSql`
   paramétré, contre `COLUMN_MAP`. Réutiliser/étendre `buildIcpWhereSql`.
4. **Projection sûre** : `fields` validé contre la whitelist (pas de `SELECT *`,
   pas de colonne sensible non autorisée).
5. **DEFAULT_ENTREPRISES_WHERE** toujours appliqué (exclut registrars + ca_suspect).
6. **Rate-limit** + bornes (page_size max, timeout requête).
7. **Pagination stable** : keyset/seek si possible sur gros volumes (OFFSET lent
   sur 996K — à mesurer au banc).

## Pièges connus (cf audit -06)
- Jointure `outreach` doit rester tenant-scoped (sinon leak cross-tenant).
- `total_estimated` exact sur 996K peut être lent → envisager un COUNT plafonné
  ("10000+") ou un estimate via `pg_class.reltuples` pour les très gros segments.
- `domain` (legacy) = SIREN, le vrai domaine web = `web_domain_normalized`
  (cf ticket domaine-web). Ne pas confondre dans les `fields`.

## DoD
- [ ] Endpoint testé sur DB clonée prod (vraie data), pas base vide.
- [ ] Auth M2M effective, rate-limit, validation stricte (rejette champ inconnu).
- [ ] Résultats recoupés manuellement (le filtre fait ce qu'il dit).
- [ ] Perf mesurée + acceptable sur segments larges (sinon index → -06).
- [ ] Test contractuel + e2e.
