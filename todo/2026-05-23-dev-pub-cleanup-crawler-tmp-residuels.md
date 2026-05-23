# [PROSPECTION] dev-pub : `/tmp/prosp-crawler-*` résiduels (~7 GB) non nettoyés

> **Type** : Infra / CI cleanup
> **Sévérité** : 🟡 P1 — dev-pub saturé à 100% disque (87% selon last snapshot, 100% lors du sprint). Bloque les builds + déploiements.
> **Owner** : agent Prospection (workflow CI)
> **Créé** : 2026-05-23
> **Découvert par** : agent e2e-skip-vide pendant validation E2E (cleanup manuel 3 dirs anciens pour pouvoir bosser)

## Symptôme

Sur dev-pub, 6× dossiers `/tmp/prosp-crawler-*` résiduels, ~7 GB cumulés. Disque à 100% (ou 87% post-cleanup), bloque les builds des agents qui ont besoin de container éphémère + workspace.

Pattern de nommage : `/tmp/prosp-crawler-<run_id>` (chaque exec workflow `prospection-deploy-staging.yml` step `Sync crawler payload`).

## Cause racine probable

Le workflow `.github/workflows/prospection-deploy-staging.yml` step crawler (refactor commit `dcf6922` par fix-401-xhr / crawler-fix) crée `/tmp/prosp-crawler-${{ github.run_id }}` sur dev-pub et a un step `Cleanup payload` en `if: always()`. Mais :
- Si la CI fail AVANT le cleanup (timeout réseau, kill SSH, etc.) → dir résiduel
- Si plusieurs runs en parallèle se télescopent (concurrency cancel-in-progress: false) → cancel d'un run = pas de cleanup
- Le `rm -rf` du cleanup peut échouer silencieusement (permissions, file lock)

## Fix attendu

### Court terme (1h)
1. Ajouter un cron sur dev-pub qui nettoie `/tmp/prosp-crawler-*` mmin +60 (1h) quotidien
   ```
   0 4 * * * find /tmp -maxdepth 1 -name 'prosp-crawler-*' -mmin +60 -type d -exec rm -rf {} +
   ```
2. Ajouter à `veridian-system-monitor` un check disque dev-pub > 85% → alert Telegram

### Long terme (refactor workflow)
- Faire le cleanup côté Docker `volumes` au lieu de `/tmp` (Docker volume avec policy retention)
- OU passer le crawler en service stateless (container avec workspace dans `/work` lifetime = container lifetime)

## Impact si non traité

dev-pub saturera à intervalles réguliers (~10-15 runs CI staging). Bloque hot reload UI dev + builds des agents + déploiements staging.

## Référence

- Workflow concerné : `.github/workflows/prospection-deploy-staging.yml` step `Sync crawler payload` + `Cleanup payload`
- Découverte : agent e2e-skip-vide 2026-05-23 (Phase validation E2E)
- 3 dirs nettoyés manuellement pour pouvoir bosser (mmin +120, anciens)
