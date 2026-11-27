# [PROSPECTION] Calendrier — notifications + sync Google Calendar (OAuth)

> **Type** : Feature (dev — notifications + intégration OAuth)
> **Sévérité** : 🟢 P2 — confort utilisateur, pas bloquant
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Demandeur** : Robert
> **Statut** : 🟡 À cadrer — l'OAuth est conditionné à un scope raisonnable

## Contexte — existant

`src/lib/google-calendar.ts` existe déjà mais fait le **minimum** :
`buildGoogleCalendarUrl()` génère une URL Google Calendar préremplie
(pas d'OAuth — l'utilisateur clique, confirme dans Google, l'événement
se crée chez lui manuellement). C'est un "lien d'ajout", pas une sync.

## Demande Robert — 2 niveaux

### Niveau 1 — Système de notification / doublon avec Google Calendar
Permettre que les RDV pris dans Prospection génèrent une **notification**
et un doublon dans Google Calendar de l'utilisateur. Aujourd'hui c'est
manuel (clic sur le lien prérempli). Améliorer le flux pour que ce soit
plus fluide / automatique côté ressenti utilisateur.

### Niveau 2 — Sync OAuth Google Calendar (écriture)
À terme : un **flow OAuth Google** qui permet à Prospection d'**écrire
directement** dans le Google Calendar de l'utilisateur — les RDV créés
dans l'app apparaissent dans son agenda Google sans action manuelle.

**Condition posée par Robert** : seulement **si le scope OAuth n'est pas
trop dur à obtenir**. L'écriture seule (`calendar.events` en write) suffit
— pas besoin de lecture complète de l'agenda.

## À cadrer avant de lancer

1. **Scope OAuth** : vérifier quel scope Google Calendar permet l'écriture
   d'événements (`https://www.googleapis.com/auth/calendar.events` ?), et
   si ça déclenche une **vérification Google** (consent screen review) —
   c'est ça le "scope dur" que Robert veut éviter. Les scopes sensibles
   Calendar peuvent demander une review Google (cf expérience OAuth Hub
   2026-05-20, providers Google).
2. **Où vit le flow OAuth** : côté Prospection directement, ou via le Hub
   (le Hub gère déjà Auth.js + providers Google/Microsoft) ? À trancher —
   le Hub centralise peut-être déjà les credentials Google.
3. **Stockage des tokens** : refresh token Google par user, chiffré.
4. Distinguer clairement Niveau 1 (notification/doublon, plus simple,
   peut s'appuyer sur l'URL préremplie existante + un rappel) du
   Niveau 2 (vraie sync OAuth, plus lourd).

## Pas urgent

Confort utilisateur. À traiter après la refonte UI du calendrier
(ticket `2026-05-22-calendrier-rdv-refonte-ui.md`) et après cadrage du
scope OAuth. Si le scope OAuth s'avère trop coûteux (review Google),
se rabattre sur le Niveau 1 (lien prérempli amélioré + notifications).
