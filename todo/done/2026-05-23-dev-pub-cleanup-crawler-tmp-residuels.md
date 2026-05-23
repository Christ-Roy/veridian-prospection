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

## Update 2026-05-23 — Cron court terme installé

Suite à seconde saturation disque (CI staging run `26340882134` échoué sur
`npm error nospc`), le cron court terme est posé sur dev-pub :

```
0 4 * * * find /tmp -maxdepth 1 -name 'prosp-crawler-*' -mmin +60 -type d -exec rm -rf {} +
```

Fixe le symptôme (saturation récurrente). La cause racine (workflow
CI qui ne cleanup pas en cas de cancel / failure intermédiaire) reste à
traiter en sprint dédié.

Cleanup manuel immédiat fait : 3,6 GB libérés (4 dirs résiduels).
Disque dev-pub 90% → 84%.

## Update 2026-05-23 — Cause racine fixée (Agent J)

**Cause racine identifiée** : le container Playwright (`mcr.microsoft.com/playwright:v1.60.0-jammy`) tourne en root et crée son `node_modules` en root-owned dans `/tmp/prosp-crawler-<run_id>`. Le step `Cleanup crawler payload` faisait `ssh ubuntu@... rm -rf $DEST` → **Permission denied** systématique sur les fichiers root, masqué par le `|| true`. Le dir restait résiduel (~3 GB / run).

Le cron court terme `find -mmin +60` ne contournait pas le problème (rm en ubuntu via cron, même Permission denied).

**Fix commit** `aefb87a` (workflow `prospection-deploy-staging.yml`) :
1. Cleanup via container alpine root : `docker run --rm -v /tmp:/tmp alpine rm -rf $DEST` — root dans le container = peut effacer les fichiers root du host.
2. Sweep préemptif au début du step `Sync crawler payload` : container alpine `find -mmin +60 -exec rm -rf` pour balayer les résidus historiques + runs cancelled.
3. Log warning explicite si cleanup container échoue.

**Validation prod (2026-05-23 21:09)** : run `26343620449` ✅ success, `ls /tmp/prosp-crawler-*` = 0 résiduel, disque stable 91%.

`cancel-in-progress: false` conservé (un deploy en cours ne doit pas être interrompu — risque de désync image:tag déployée).

Le cron court terme posé sur dev-pub reste utile comme filet de sécurité (suppression des résidus très anciens via container root si on en oublie un).

→ Ticket résolu, archivé dans `done/`.
