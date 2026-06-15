# Finir le refactor `domain` → `SIREN` (clé primaire changée, migration à moitié faite)

> **Sévérité** : 🟡 P1 (dette technique, source de confusion + bloque l'intégration externe)
> **Owner** : agent veridian-prospection
> **Créé** : 2026-06-15

## Contexte

Le 2026-04-05, la clé primaire des entités prospect est passée de `domain` à **SIREN**
(refactor radical de la DB). Mais la migration a été faite **à moitié** : la DB et les
queries utilisent le SIREN, alors que les **routes API, params d'URL et champs de body
publics ont gardé le nom `domain`** "pour back-compat". Résultat : partout, un paramètre
nommé `domain` porte en réalité un SIREN (9 chiffres). C'est trompeur, ça piège quiconque
veut consommer l'API (humain ou agent), et la "Phase 3" du refactor n'a jamais été finie.

Découvert en voulant brancher l'agent secrétaire mail sur l'app prospection : impossible
de croiser un **email entrant → domaine → lead**, car la clé est maintenant un SIREN et
les routes `[domain]` attendent un SIREN, pas un domaine.

## Occurrences recensées (2026-06-15)

### Routes avec param `[domain]` qui porte un SIREN
- `src/app/api/leads/[domain]/route.ts` — commentaire ligne 36 : *"URL param named `domain` for back-compat but now carries a SIREN (9 digits)"*, ligne 37 `const { domain: siren } = await params`
- `src/app/api/leads/[domain]/timeline/route.ts` (ligne 30 `domain: siren`)
- `src/app/api/leads/[domain]/history/route.ts` (ligne 18 `domain: siren`)
- `src/app/api/outreach/[domain]/route.ts`

### Body/query `domain` legacy (pattern `?? body.domain`)
- `src/app/api/followups/route.ts` (lignes 14-15, 32-33 : accepte `?siren=` ET legacy `?domain=`)
- `src/app/api/phone/server-call/route.ts` (ligne 44-45 : `body.siren ?? body.domain`)
- `src/app/api/phone/call-log/route.ts` (lignes 10-11, 57, 96)
- `src/app/api/phone/summarize-call/route.ts` (ligne 36-37)

### Phase 3 explicitement inachevée
- `src/app/api/entreprises/[siren]/outreach/route.ts` (ligne 22) : TODO *"SIREN refactor Phase 3 — outreach endpoint keyed by SIREN"* — l'endpoint cible SIREN-centric existe en stub mais n'a pas remplacé `/api/outreach/[domain]`.

## À faire

1. **Renommer les routes** `[domain]` → `[siren]` (avec redirections/aliases temporaires si des clients front en dépendent encore — vérifier les appels dans `src/` avant suppression).
2. **Renommer les params de body/query** `domain` → `siren` ; garder l'acceptation de `domain` en lecture le temps d'une dépréciation, mais logger un warning de dépréciation à chaque usage.
3. **Finir la Phase 3** : faire de `/api/entreprises/[siren]/outreach` le canonique, déprécier `/api/outreach/[domain]`.
4. **Grep de complétude** : `grep -rniE "domain.*siren|siren.*domain|back.?compat|now carries a SIREN" src/` doit revenir vide une fois fini.
5. Mettre à jour `CLAUDE.md` / docs API pour refléter SIREN comme clé.

## Bonus utile (motive ce ticket)
Une fois propre, **ajouter un endpoint `/api/lead-by-email`** (auth machine via `CRON_SECRET`, même pattern que `src/app/api/cron/imap-sync/route.ts`) pour permettre à des outils externes (agent secrétaire) de qualifier un expéditeur : email → entreprise (via `Entreprise.bestEmailNormalized`) → état pipeline. C'est le besoin qui a fait découvrir cette dette.
