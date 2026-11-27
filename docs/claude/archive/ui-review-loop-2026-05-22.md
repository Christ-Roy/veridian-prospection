# Boucle de revue UI — veridian-prospection

> Setup câblé 2026-05-22. Permet à un agent de livrer de l'UI de qualité
> en autonomie, sans que Robert serve de test runner visuel.

## Le problème que ça résout

Sur le backend, la boucle de feedback est fermée : code → tests → vert/rouge.
Sur l'UI elle ne l'était pas : code → on suppose → Robert valide. Robert
devenait le validateur. Ce setup ferme la boucle : l'agent UI se fait
auditer par un reviewer qui a des yeux (Chrome) et un critère objectif
(le design system), AVANT de livrer.

## Les 3 briques

1. **Hot reload UI** — container `next dev` sur dev-pub.
   - Code : `dev-pub:~/prospection-ui-dev` (clone du repo, branche `staging`)
   - Compose : `~/prospection-ui-dev/docker-compose.uidev.yml`
   - URL : `https://ui-dev.staging.veridian.site` (réseau `staging-edge`,
     DB = `postgres-staging` → data réelle, derrière Tailscale)
   - Port interne 3100.

2. **Sub-agent `ui-reviewer`** — `.claude/agents/ui-reviewer.md` (Opus).
   Inspecte le rendu réel dans Chrome, zoome, teste 375/768/1440px,
   mesure le DOM calculé, vérifie la conformité au design system, rend
   un verdict écrit chiffré. Ne code pas.

3. **Le design system comme critère** — shadcn/ui + tokens OKLCH
   (`src/app/globals.css`). C'est la loi. Le reviewer traque les écarts.

## La boucle (pattern fix → review → fix)

```
Agent UI (travaille sur staging, code synchro sur dev-pub:~/prospection-ui-dev)
  └─ code une zone
  └─ git push staging  OU  rsync vers dev-pub:~/prospection-ui-dev
     (le hot reload recharge)
  └─ délègue à ui-reviewer → screenshots + zoom + verdict chiffré
  └─ applique les corrections du verdict
  └─ re-review
  └─ boucle jusqu'au verdict ✅ CONFORME
  └─ livre à Robert : screenshots avant/après finaux
```

Robert n'intervient qu'à la fin, sur des captures. Plus pendant.

## Gérer le hot reload

```bash
# Démarrer / redémarrer
ssh dev-pub 'cd ~/prospection-ui-dev && docker compose -f docker-compose.uidev.yml up -d'

# Synchro du code local → dev-pub (si on code en local plutôt que push)
rsync -az --exclude node_modules --exclude .next \
  ./ dev-pub:~/prospection-ui-dev/

# Logs (suivre le build / les erreurs de compilation)
ssh dev-pub 'docker logs -f prospection-ui-dev-ui-dev-1'

# Mettre le worktree à jour sur le dernier staging
ssh dev-pub 'cd ~/prospection-ui-dev && git pull origin staging && git submodule update --remote'

# Arrêter (libère ~2G RAM sur dev)
ssh dev-pub 'cd ~/prospection-ui-dev && docker compose -f docker-compose.uidev.yml down'
```

## Pourquoi sur dev-pub et pas en local

La machine locale (mail) est chroniquement saturée (load ~10/4 cores,
~500 Mi RAM libre). `next dev` la mettrait à genoux. dev-pub a la place
(load ~2, 3.8 Gi dispo) et la DB staging est déjà à côté.

## Règles

- L'agent UI travaille sur `staging` (trunk — pas de branche feature,
  cf CLAUDE.md racine).
- Le reviewer ne modifie jamais de fichier — il audite.
- Toujours spawner ui-reviewer en `model: opus`.
- Le hot reload est éphémère : si dev-pub est sous pression, le couper
  (`compose down`) entre deux chantiers UI.
- Ambition par défaut : corriger les défauts en respectant le design
  system. Montée esthétique = décision explicite de Robert.
