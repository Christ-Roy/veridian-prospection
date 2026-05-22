# [PROSPECTION] PATCH /api/leads/[domain] manquant — 405 sur 7 appels UI

> **Type** : Bug backend — route API incomplète
> **Sévérité** : 🔴 P0 — fonctionnalité métier cassée (changement de statut prospect)
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Découvert par** : team ui-polish (hors scope UI/UX — ui-reviewer)

## Contexte

Pendant le polish UI (vue carte mobile /prospects), la team a testé le
bouton « + Pipeline » des cartes prospect. Il déclenche
`PATCH /api/leads/:id` qui répond **405 Method Not Allowed** — et l'échec
est totalement silencieux (aucun toast côté UI).

## Problème

`src/app/api/leads/[domain]/route.ts` (75 lignes) **n'exporte que `GET`**.
Aucun handler `PATCH`. Pourtant le verbe `PATCH` sur cet endpoint est
appelé à **7 endroits** du code :

- `src/components/dashboard/prospect-page.tsx:393` (changement de statut groupé — sélection)
- `src/components/dashboard/prospect-page.tsx:807` (bouton statut, vue table)
- `src/components/dashboard/prospect-page.tsx:949` (bouton « + Pipeline », vue carte mobile)
- `src/components/dashboard/lead-sheet.tsx:122` et `:697`
- `src/components/dashboard/lead-sheet/lead-header.tsx:59` et `:131`
- `src/components/dashboard/lead-sheet/auto-save-notes.tsx:31`
- `src/components/dashboard/lead-sheet/appointments-section.tsx:105`
- `src/components/dashboard/lead-sheet/quick-notes.tsx:59`

→ **Tous ces appels échouent en 405** (changement de statut, sauvegarde
de notes, édition de fiche, RDV…). Soit la fonctionnalité est cassée en
prod depuis un moment et personne ne l'a vu (échecs silencieux), soit il
existe une autre route censée recevoir ces PATCH qui n'a pas été trouvée
au grep — **à investiguer en priorité**.

## Fix attendu

1. **Investiguer d'abord** : ces 7 appels marchent-ils en prod ? Vérifier
   les logs prod (`/api/leads/*` PATCH → 405 ?). Si oui = bug prod réel,
   pas juste staging.
2. **Ajouter le handler `PATCH`** dans `src/app/api/leads/[domain]/route.ts` :
   auth requise (même garde que `GET`), validation du body (`status`,
   `notes`, etc. selon ce que les 7 callers envoient — auditer les bodies),
   `request.json()` safe-parse (`.catch(() => ({}))`, cf pattern Veridian),
   mise à jour Prisma scopée au `tenant_id`, réponse propre.
3. Couvrir par un test (`__tests__/api/leads/[domain].test.ts` ou e2e).

## Impact

Changement de statut prospect, ajout au pipeline, sauvegarde de notes,
édition de fiche, prise de RDV — toutes ces actions métier passent par ce
PATCH. Si le 405 est réel en prod, **le cœur fonctionnel de l'app de
prospection est cassé**. P0 à confirmer/corriger d'urgence.

## Note UI (traité par la team ui-polish, pas dans ce ticket)

L'échec silencieux (pas de toast) est un défaut UI séparé — la team
ui-polish ajoute le feedback succès/erreur sur les boutons concernés.
Mais même avec le toast, l'action restera KO tant que ce PATCH n'existe pas.

## ✅ Archivé 2026-05-22 — livré et vérifié en prod
