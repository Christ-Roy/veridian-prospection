# [PROSPECTION] ⚠️ Banc d'essai next-dev sur DB clonée prod + AUDIT PARANO des API

> **Sévérité** : 🔴 P0 (BLOQUANT — prérequis de tous les autres tickets IA-search)
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-16
> **Demandé par** : Robert (verbatim) *"il me semble que les api sont cassé et
> qu'il a full truc à régler il faut vraiment tout contrôler en mode parano…
> un mode next dev sur la db cloné de prod serait pertinent pour itérer rapidement"*

## Pourquoi c'est P0 et BLOQUANT

La DB staging a été recréée VIDE le 2026-06-16 (**1 entreprise, 1 outreach**).
Tout ce qui a été "validé" jusqu'ici = "ça compile et répond 200 sur une base
vide". **Ça ne prouve RIEN** :
- Justesse des filtres : un WHERE faux renvoie 0 sur une base vide comme sur une
  base pleine → indétectable sans data.
- Perf / index : un COUNT sur 996K lignes sans index sur la colonne filtrée =
  seq scan = plusieurs secondes = DoS. Invisible sur 1 ligne.
- Bugs réels (jointures outreach, NULLs, types) ne sortent que sur vraie data.

→ **On ne code aucun nouvel endpoint IA tant qu'on n'a pas (a) une DB de test
réaliste et (b) un audit honnête de ce qui marche/casse déjà.**

## Partie A — Banc d'essai : next dev sur DB clonée de prod

### L'existant à réutiliser (NE PAS recréer)
- `ui-dev` sur dev-pub : `~/prospection-ui-dev/docker-compose.uidev.yml`, next dev
  hot-reload port 3100, code en bind mount, URL `ui-dev.staging.veridian.site`.
  **Problème** : pointe sur `postgres-staging` (vide).
- `scripts/sync-prod-to-staging.sh` : dump prod → restore staging. **Obsolète** :
  pointe sur des containers Dokploy qui n'existent plus (`compose-bypass-…`).
  À RÉPARER (cibler `postgres-staging` / le nouveau container).

### À faire
1. **Cloner la DB prod → une DB de dev dédiée** (PAS la staging des tests E2E,
   pour ne pas polluer le crawler) sur dev-pub. Soit une 2e DB dans
   `postgres-staging` (`prospection_devclone`), soit un container dédié.
   - Source : `ssh prod-pub docker exec code-prospection-saas-db-1 pg_dump …`
     (read-only sur prod, `--no-owner --no-acl`).
   - ⚠️ `entreprises` = 996K lignes + indexes → dump volumineux. Vérifier l'espace
     disque dev-pub (était à 83% le 2026-06-16 — cf alerte infra). Si trop juste :
     cloner `entreprises` + tables référentiel, et un échantillon des tables tenant.
2. **Pointer un next dev dessus** (réutiliser le pattern `ui-dev`, nouveau compose
   `docker-compose.search-dev.yml` ou réutiliser ui-dev avec DATABASE_URL → la
   clone). Hot reload pour itérer vite sur les formes d'API.
3. **Réparer/rafraîchir `sync-prod-to-staging.sh`** pour que le clonage soit
   rejouable (cron hebდo possible plus tard) et documenté.
4. Documenter dans `.claude/rules/` ou un README : comment lancer le banc, comment
   rafraîchir la clone, comment couper (dev-pub sous pression disque).

### Garde-fous
- **Read-only sur prod** : uniquement `pg_dump`, jamais d'écriture.
- **Pas de secrets prod** dans l'env de dev (clé Stripe live, etc. → masquer/no-op).
- **Données perso** : la clone contient des coordonnées réelles (RGPD). Accès
  restreint dev-pub (déjà derrière Tailscale). Pas d'export hors tailnet.

## Partie B — Audit PARANO de l'existant (sur la DB clonée)

Une fois le banc up avec vraie data, **tester méthodiquement TOUTES les API de
lecture/recherche existantes** et documenter l'état réel (vert/cassé/lent) :

### Endpoints à auditer (au minimum)
- `/api/prospects` (+ filtres : secteurs, depts, CA, effectifs, âge dirigeant,
  signaux web, certifs, hasWebsite, requirePhone/Email…)
- `/api/leads` + `/api/leads/estimate-count` (le futur cœur de l'itération IA)
- `/api/entreprises`, `/api/entreprises/[siren]`, `/api/entreprises/segments`,
  `/api/entreprises/segments/[id]`
- `/api/segments`, `/api/segments/[...slug]` (les 31 vues v_*)
- `/api/stats/*` (overview, segments, by-department, today)
- `/api/sans-site-filters`, `/api/sectors`

### Pour CHAQUE endpoint, vérifier
- [ ] Répond 200 sur vraie data (pas juste sur base vide).
- [ ] **Justesse** : le filtre fait-il ce qu'il dit ? (ex: CA 500K-2M renvoie-t-il
      bien des boîtes dans cette tranche ? recouper avec un COUNT SQL manuel).
- [ ] **Perf** : temps de réponse sur 996K. `EXPLAIN ANALYZE` sur les requêtes
      lentes. Lister les colonnes filtrées SANS index (candidates à `CREATE INDEX`).
- [ ] **NULLs / cas limites** : filtre sur colonne souvent NULL, secteur inexistant,
      dept invalide, CA négatif…
- [ ] **Sécurité** : injection via params, accès sans auth, leak cross-tenant
      sur les tables à tenant_id.

### Livrable de l'audit
- Un rapport `todo/2026-06-XX-audit-api-prospection-resultats.md` : tableau
  endpoint × (état, perf ms, bugs trouvés, index manquants).
- Pour chaque bug/lenteur : soit fix immédiat (si rapide+sûr), soit sous-ticket.
- La liste des `CREATE INDEX` à poser (sur entreprises) pour que le moteur IA
  soit rapide — à appliquer staging puis prod (tier 🔴, migration).

## DoD
- [ ] DB clonée de prod accessible par un next dev hot-reload sur dev-pub.
- [ ] `sync-prod-to-staging.sh` (ou équivalent) réparé et rejouable.
- [ ] Rapport d'audit honnête de TOUTES les API de recherche sur vraie data.
- [ ] Liste des index manquants + bugs priorisés.
- [ ] Décision claire : ce qui est réutilisable tel quel vs ce qui doit être
      refait pour le moteur IA.
