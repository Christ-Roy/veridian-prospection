# [PROSPECTION] Switch mode agence web / générique + onboarding ciblage leads

> **Type** : Feature produit (dev + UI/UX)
> **Sévérité** : 🟡 P1 — structurant pour la commercialisation de l'app
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Demandeur** : Robert (vision produit, session 2026-05-22)
> **Statut** : 🟡 À cadrer — idée capturée, pas encore spécifiée

## Contexte

L'app n'a aujourd'hui pas de vrai onboarding (le parcours initial n'a
jamais été réalisé proprement — l'app était un POC, le besoin n'était pas
clair à l'époque). Robert pose deux features liées pour rendre l'app
**commercialisable** et lui donner un positionnement.

## Feature 1 — Switch « mode agence web » / « mode générique »

Un switch global sur l'app qui change la logique de tri/scoring des
entreprises affichées :

- **Mode générique** (DÉFAUT) : tri par CA / effectif. Large, grand
  public, moins de valeur ajoutée — mais c'est la version « tout public ».
- **Mode agence web** : tri par **dette technique** des entreprises.
  C'est le différenciateur de niche de Veridian Prospection (la base a
  996K entreprises avec scoring technique). Réservé/activable via les
  **paramètres**.

Intention : avoir une **version générique** ET une **version nichée** de
l'app sans dupliquer le produit — un simple switch.

→ À cadrer : le switch change-t-il seulement le TRI/affichage (les mêmes
entreprises, ordre différent) ou FILTRE-t-il les leads proposés ? Robert
n'a pas tranché — à creuser avec le code existant (le scoring technique
existe déjà, voir `lib/queries/` + composants `quality-*`).

## Feature 2 — Onboarding : ciblage géo + secteur

Au premier login, un parcours de configuration où le client choisit :
- Les **zones géographiques** à cibler — le plus précis possible
  (département ? commune ? zone de chalandise ?).
- Le ou les **secteurs** des leads.

But : permettre au client de **choisir finement le type de leads** qu'il
va recevoir, plutôt que de démarrer dans une app vide ou face à toute la
base brute.

→ À cadrer : ces choix deviennent-ils le filtre PAR DÉFAUT permanent du
compte, ou juste un point de départ modifiable ? À creuser avec le code :
des composants de filtrage existent DÉJÀ (`geo-filter-sidebar.tsx`,
`sector-sidebar.tsx`, `quality-filter-sidebar.tsx`, `size-filter-sidebar.tsx`,
`france-map.tsx`) — une partie du travail est probablement déjà là,
dispersée. Vérifier comment les filtres sont persistés aujourd'hui.

## Périmètre & nature du chantier

⚠️ Ce N'EST PAS un fix UI — c'est du **développement de feature** :
- Le switch touche la logique de scoring/tri (backend + UI).
- L'onboarding = parcours multi-étapes + persistance des préférences
  (modèle de données, API).
- Hors scope d'une simple team de polish UI.

## Avant de spécifier — reconnaissance du code à faire

1. Lire le scoring technique actuel : comment la dette technique est
   calculée et exposée (`lib/queries/`, routes `/api/prospects`).
2. Lire les sidebars de filtrage existantes et leur persistance.
3. Voir s'il reste des traces de l'onboarding POC
   (`src/components/layout/onboarding.tsx` existe — état à vérifier).
4. Lire `veridian-hub/docs/PRICING-VERIDIAN.md` — le mode agence vs
   générique peut avoir un lien avec le pricing/positionnement.

## Prochaine étape

Quand Robert ouvre ce chantier : cadrage produit (les 2 questions
"à creuser" ci-dessus) → spec → estimation → exécution. À traiter APRÈS
le sprint fixes UI mobile en cours.
