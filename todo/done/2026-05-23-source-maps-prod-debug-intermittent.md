# [PROSPECTION] Activer source maps prod pour debug bugs intermittents

> **Type** : DX / Observability
> **Sévérité** : 🟢 P2 — désagrément debug, pas critique
> **Owner** : agent Prospection
> **Créé** : 2026-05-23

## Contexte

Pendant le debug du `bug-intermittent-prospects-undefined-length`, le
stack trace utilisateur était :

```
TypeError: Cannot read properties of undefined (reading 'length')
   at <chunk>/app/prospects/page-XXX.js (LR fn)
```

`page-XXX.js` est un chunk Next.js minifié. **Impossible de remonter à
la ligne source exacte** sans source map, donc on a dû procéder par
audit grep large et fix défensif sur tous les suspects au lieu d'un fix
ciblé. Travail correct mais inutilement large.

## Fix

`next.config.ts` :

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  productionBrowserSourceMaps: true,  // ← ajouter
  // ...
};
```

## Trade-offs

### Pour

- Stack traces lisibles dans `/api/errors` (`ClientErrorBoundary` POST déjà
  en place avec stack), Sentry/futur, devtools utilisateur si on demande
  un screenshot.
- Coût bundle utilisateur : 0 (les `.map` sont servis séparément, browser
  les fetch uniquement si devtools ouvert).
- Coût build : ~10-15% en plus de durée + ~30% de taille du dossier
  `.next/static/` (acceptable, on n'est pas au quota).
- Coût hosting Dokploy : OK, on a la place.

### Contre

- Les `.map` sont publics → quiconque peut lire le code source frontend
  démappé. Pour Prospection c'est OK (logique métier sensible côté API
  protégée, frontend = pure présentation). Si demain on bouge des
  secrets côté client (à NE PAS faire de toute façon), c'est risqué.
- Alternative : `hidden-source-map` (`webpack` config) qui génère les
  .map sans les exposer publiquement, à upload vers Sentry/équivalent.
  Plus propre mais nécessite un service externe.

## Reco

**Phase 1 (this ticket)** : activer `productionBrowserSourceMaps: true` en
staging d'abord, vérifier qu'aucun secret leak (grep `process.env` dans
`.next/static/`), puis prod.

**Phase 2 (futur ticket si on prend Sentry)** : passer en mode hidden +
upload Sentry pour avoir l'observabilité agrégée sans exposer publiquement.

## Lien

- Bug original : `todo/done/2026-05-23-bug-intermittent-prospects-undefined-length.md`
- Cousine : `client-error-boundary.tsx` qui POST stacks sur `/api/errors`
  (actuellement logged en stdout container, cf ticket
  `2026-05-23-persist-client-errors-db.md`).
