# [RESOLVED] /leads/buy "Application error" — root cause = chunks JS 502 pendant déploiement

> **Statut** : ✅ Résolu 2026-05-25 par agent FIX-LEADS-BUY
> **Sévérité initiale** : 🔴 P0 (présumée bug code refill-icp)
> **Sévérité réelle** : 🟡 P1 transitoire (fenêtre 502 deploy, pas un bug logique)
> **Mitigation livrée** : error boundary racine App Router avec retry ChunkLoadError
> **Suite long-terme** : ticket P3 ouvert dans `veridian-infra/todo/`

## Symptôme observé (ticket original)

Spec E2E `e2e/staging-full/refill-icp.spec.ts:82:7 "3. preview se met à jour
quand on change un filtre"` a fail dans la mega battery baseline avec écran
"Application error: a client-side exception has occurred while loading
prospection.staging.veridian.site".

Hypothèses initiales : race condition `LiveCountPreview` debounce, Zod parse
qui throw sur shape intermédiaire, hydration mismatch.

## Root cause réelle

Trace Playwright (`test-results/refill-icp-Refill-ICP-page-7e145-r-quand-on-change-un-filtre-chromium-headfull/trace.zip`) :

```
200 https://prospection.staging.veridian.site/leads/buy
502 https://prospection.staging.veridian.site/_next/static/chunks/app/leads/buy/page-7393e8b4b5a40595.js
502 .../_next/static/chunks/9773-11fb7194117c4cd0.js
502 .../_next/static/chunks/6281-9e61eeed4d6fea46.js
502 .../_next/static/chunks/6517-893e0d00bf3751ee.js
```

Le HTML SSR de `/leads/buy` rend OK (200), mais les chunks JS client servent
**502 Bad Gateway**. Quand React hydrate le bundle client (`RefillIcpClient`
+ dépendances), le chunk load fail → Next.js bascule sur l'écran d'erreur
client par défaut.

Confirmation timing :
- Test exécuté à 17:19:37 UTC
- `curl /api/version` → container build à 17:52:03 UTC (~33 min plus tard)
- Donc le container Prosp staging était en cours de restart/build au moment
  de la spec. Fenêtre 502 classique d'un déploiement sans blue-green.

Aucune erreur JS de logique dans la trace (`grep "page-error"` → 0 résultat),
aucun crash dans les composants W7b. Les 8 composants refill-icp sont sains.

Vérification a posteriori : suite complète `refill-icp.spec.ts` re-runnée
contre staging stable = 15/16 specs verts, dont la spec 3 du ticket. Le seul
fail restant est un mismatch query param login (`next=` vs `redirect=`,
ticket différent hors périmètre).

## Mitigation livrée

`src/app/error.tsx` (error boundary racine App Router) qui :

1. Detect ChunkLoadError via signature `name`/`message` (cf
   `src/lib/error-boundary-utils.ts` testé).
2. Force un `window.location.reload()` pour récupérer le HTML SSR à jour
   avec les nouveaux hashes de chunks.
3. Compteur sessionStorage : max 2 reloads consécutifs en 30s pour casser
   une boucle si le déploiement met du temps à se stabiliser.
4. UI fallback explicite ("Mise à jour en cours, rechargement…") + bouton
   manuel "Recharger maintenant".

Couvre PROSPECTION en entier (pas que `/leads/buy`) puisque le problème
peut frapper n'importe quelle page client-side pendant un deploy.

Tests Vitest : `src/lib/error-boundary-utils.test.ts` — 10 tests dont
- detection ChunkLoadError par name/message (4 signatures)
- non-detection erreurs génériques
- comportement retry (1er reload, 2e reload, blocage 3e, reset window 30s)
- fallback storage indisponible

Sabotage-test validé : forcer `isChunkLoadError -> false` fait fail 4 specs
de détection.

## Suite long-terme (hors scope ticket actuel)

Ticket déposé dans `veridian-infra/todo/2026-05-25-prosp-staging-blue-green-fenetre-502.md` :
mettre en place blue-green sur le compose Prosp staging OU health-gate Traefik
sur `/api/health` pour éliminer la fenêtre 502 à la racine plutôt que la
masquer côté UI.

## Definition of done

- [x] Root cause identifiée et documentée (trace + timing serveur)
- [x] Error boundary racine livré + tests unit (10/10 verts)
- [x] Sabotage-test mental validé
- [x] Suite refill-icp.spec.ts re-runnée verte sur staging stable
- [x] Ticket archivé + ticket infra long-terme ouvert
- [x] Mitigation couvre TOUTES les pages Prospection (pas seulement /leads/buy)

## Apprentissages

1. Un crash UI dans un E2E ne signifie pas forcément un bug code — toujours
   regarder la trace network avant de patcher la logique React.
2. La mega battery doit éviter de tourner pendant un push staging (timing).
   Ticket sibling `2026-05-25-mega-battery-doit-tourner-sur-devpub-pas-local.md`
   pourrait s'enrichir d'une attente "container build_at > started_at + 60s"
   avant de lancer.
3. Pas de blue-green sur le compose Prosp staging — fenêtre 502 inévitable
   tant qu'on n'y câble pas un mécanisme. Mitigation UI = défense en
   profondeur, pas substitut.

## Référence

- Mega battery baseline 2026-05-25 17:11 UTC
- Spec qui fail : `e2e/staging-full/refill-icp.spec.ts:82:7`
- Trace exploitée : `test-results/refill-icp-Refill-ICP-page-7e145-r-quand-on-change-un-filtre-chromium-headfull/trace.zip`
- Container build_at (root cause timing) : `2026-05-25T17:52:03Z`
- Feature livrée par W7b : commit `ffe0404`
