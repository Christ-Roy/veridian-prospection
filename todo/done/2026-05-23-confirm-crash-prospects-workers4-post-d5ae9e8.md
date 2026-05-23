# [PROSPECTION] Confirmer fix bug intermittent /prospects via crawler workers=4 — post-push d5ae9e8

> **Type** : Validation post-fix
> **Sévérité** : 🟡 P1 — il faut savoir si les guards défensifs de
>   `d5ae9e8` (pipeline-board.tsx + sans-site-sidebar.tsx + segment-page.tsx)
>   couvrent bien le crash observé.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23

## Contexte

Pendant le diagnostic du bug 401 dashboard-crawler
(`done/2026-05-23-fix-401-api-routes-clientside-auth.md`), j'ai observé
un crash client-side intermittent en exécutant le crawler avec
`workers=4` sur dev-pub container Playwright :

```
[chromium] › /prospects — pas d'erreur visible ni console
  Error: /prospects ne doit pas contenir le pattern /Application error/i
  Received string: "...Application error: a client-side exception has occurred
  while loading prospection.staging.veridian.site..."
```

Page snapshot Playwright a confirmé un vrai message React error boundary
(pas un faux positif sur du code script Next.js inline).

L'agent `bug-intermittent` a posé des guards défensifs sur 3 composants
suspects (commit `d5ae9e8` : `pipeline-board.tsx`, `sans-site-sidebar.tsx`,
`segment-page.tsx`) sans avoir pu reproduire le bug en 18 navigations
Chrome MCP. Le crawler workers=4 EST un reproducer naturel — il faut
juste s'en servir comme validation.

## Hypothèse

Le crash vient probablement d'une race condition multi-worker sur le
compte canonique e2e-persistent (4 logins parallèles → seed Prisma
parallèle → upserts concurrents → état transitoirement incohérent côté
DB qui fait crasher un composant client qui n'attendait pas de
null/undefined dans une liste).

Si `d5ae9e8` couvre les 3 patterns à risque, le crash devrait avoir
disparu. Sinon → 4ème pattern non identifié.

## DoD

- [ ] Attendre que `d5ae9e8` soit sur `staging` déployé (sync avec
  team-lead).
- [ ] Lancer 5× le crawler avec workers=4 sur dev-pub container
  Playwright (cf protocole tickets fix-401 / crawler-fix) :
  ```bash
  ssh dev-pub 'docker run --rm --network staging-edge \
    -v /home/ubuntu/prospection-e2e-validate:/work -w /work \
    -e DATABASE_URL="…" -e PROSPECTION_URL="…" \
    mcr.microsoft.com/playwright:v1.60.0-jammy \
    bash -c "npx playwright test e2e/dashboard-crawler.spec.ts \
      --project=chromium --reporter=list --workers=4 --repeat-each=5"'
  ```
- [ ] **Si 5/5 verts** → le bug est couvert par `d5ae9e8`. Fermer ce ticket.
- [ ] **Si au moins 1 rouge avec "Application error"** → capturer la stack
  trace côté `/api/errors` (la route existe — cf
  `auth.config.ts:55`). Identifier le composant fautif qui n'est pas
  dans la liste `d5ae9e8`. Ouvrir ticket follow-up.

## Pas P0 parce que

- L'app prod a déjà ce code et le bug reste très intermittent (pas vu
  par les users humains ni par les autres specs E2E).
- Le crawler workers=1 passe 7/7 — le mode "single user humain" est sain.
- Mais le risque est non nul : un user qui ouvre 2 onglets rapidement
  pourrait theoriquement déclencher le même crash.
