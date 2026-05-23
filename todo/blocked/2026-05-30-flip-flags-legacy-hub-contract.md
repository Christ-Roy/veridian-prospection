# [PROSPECTION] Flip flags ACCEPT_LEGACY_* en prod — Phase 3 contrat Hub

> **Type** : Cleanup contrat cross-app
> **Sévérité** : 🟡 P1 — pas bloquant mais ferme une vieille dette de contrat
> **Owner** : agent Prospection
> **Créé** : 2026-05-23 (rappel scheduled)
> **Action à partir du** : **2026-05-30**
> **Suite directe de** : `todo/2026-05-19-hub-contract-phase1-suite.md`

## Pourquoi un ticket séparé

L'agent `hub-contract` (passe 2026-05-23) a re-validé Phase 1 (smoke prod HMAC standard) + Phase 2 (audit logs 7j = 0 `legacy *`). **Phase 3 (flip flags) n'est pas exécutable avant 2026-05-30** parce que :

- Le warning observability `e823297` qui permet d'observer en confiance les `legacy *` n'est en **prod** que depuis le 2026-05-23 01:24 (merge `bbd6d74`).
- L'estimation 2026-05-27 du ticket parent était basée sur la date du commit `e823297` (2026-05-20), pas sur sa date d'arrivée en prod.
- Fenêtre 7j RÉELLE = 2026-05-23 → **2026-05-30**.

Ce ticket vit séparément pour qu'on ne perde pas le rappel dans le bruit du ticket parent (qui a déjà 3 réponses datées).

## À faire AU 2026-05-30 (ou après)

### 1. Re-audit logs prod sur 7j
```
ssh prod-pub 'docker logs compose-connect-redundant-firewall-l5fmki-prospection-1 --since 168h 2>&1 | grep -iE "legacy"'
```
Doit retourner **0 occurrence**. Si > 0 → investiguer ce qui appelle encore en legacy, ne pas flipper, ré-ouvrir le ticket parent.

### 2. Si 0 → flip Dokploy
ENV `ACCEPT_LEGACY_BEARER` et `ACCEPT_LEGACY_HMAC` ne sont PAS définis dans le compose ENV Dokploy prod actuellement (vérifié 2026-05-23 par `hub-contract`). Le code applique le défaut (`!== "0"` → legacy accepté). Pour flipper, il faut **AJOUTER** les 2 lignes :

```
composeId Prospection prod = 0mJI-sSt6jcOMr_2QJ1iI
```

```bash
# Pattern Dokploy API (cf memory project_dokploy_improvements)
# GET current env
curl -X GET "https://dokploy.veridian.site/api/compose.one?composeId=0mJI-sSt6jcOMr_2QJ1iI" -H "x-api-key: $DOKPLOY_API_KEY"

# Concat ENV existant + ACCEPT_LEGACY_BEARER=0 + ACCEPT_LEGACY_HMAC=0
# POST update
curl -X POST "https://dokploy.veridian.site/api/compose.update" \
  -H "x-api-key: $DOKPLOY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"composeId": "0mJI-sSt6jcOMr_2QJ1iI", "env": "<ENV existant>\nACCEPT_LEGACY_BEARER=0\nACCEPT_LEGACY_HMAC=0"}'

# Deploy
curl -X POST "https://dokploy.veridian.site/api/compose.deploy" \
  -H "x-api-key: $DOKPLOY_API_KEY" \
  -d '{"composeId": "0mJI-sSt6jcOMr_2QJ1iI"}'
```

### 3. Monitor 10 min post-deploy
```bash
# Healthcheck + SHA stable + auto-rollback si 3 fails consécutifs
# Pattern utilisé pour le hotfix 2026-05-23 → /tmp/monitor_prod_postdeploy_hotfix.sh
```

### 4. Smoke prod HMAC standard
Refaire le smoke fait par `hub-contract` 2026-05-23 (POST /api/tenants/provision avec HMAC) — doit toujours retourner 200. Si 401 = problème, rollback.

### 5. Cleanup docs + ticket Hub
- `docs/hub-contract.md` : retire la section "Compatibilité legacy"
- Dépose `veridian-hub/todo/2026-05-30-patch-matrice-section-10-contrat.md` demandant à l'agent Hub de patcher :
  - §10.4 ligne `HMAC standard {ts}.{body}` colonne Prospection : ⚠️ → ✅
  - §10.1 ligne 1 (`POST provision`) colonne Prospection : ⚠️ → ✅

### 6. Archive
- `mv todo/2026-05-19-hub-contract-phase1-suite.md todo/done/`
- `mv todo/2026-05-30-flip-flags-legacy-hub-contract.md todo/done/`

## Risque & rollback

Tier 🔴 HAUT (modif ENV prod sensible) mais réversible :
- Si quelque chose casse → re-set `ACCEPT_LEGACY_BEARER=1` + `ACCEPT_LEGACY_HMAC=1` + `compose.deploy`. ~2 min downtime éventuel.
- L'app reste healthy entre-temps (legacy bridges sont juste des `if (flag) accept(...)`, le HMAC standard fonctionne toujours).

## Si tu lis ce ticket en autonomie

C'est la responsabilité de l'agent Prospection. Si tu n'es pas sûr, valide avec Robert avant le flip — c'est de la prod et c'est un cleanup, pas une urgence. Mieux vaut attendre un jour de plus que casser.
