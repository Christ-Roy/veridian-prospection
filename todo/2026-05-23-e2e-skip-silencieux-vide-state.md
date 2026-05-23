# [PROSPECTION] Skip silencieux sur "DB vide" dans 5 specs E2E

> **Sévérité** : 🟡 P1 — pattern anti-régression manqué. Mêmes maux que le ticket Supabase inline (couverture surévaluée), plus subtil.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Découvert par** : agent e2e-17-specs (audit post-migration Supabase)

## Le problème

Plusieurs specs `e2e/extended/` et `e2e/core/` skip leur assertion
quand la DB du tenant n'a pas de leads / pas de membres / pas
d'historique — au lieu d'**ensurer** qu'il y a de la data avant de
tester.

Conséquence : tant que le compte canonique `e2e-persistent` a pas de
leads / pas de prospects activés / pas de membres invités, ces specs
passent SILENCIEUSEMENT (vert au reporter, 0 assertion exécutée).

## Fichiers concernés

```
e2e/extended/admin-members.spec.ts:114 → test.skip "No members in this tenant"
e2e/extended/admin-members.spec.ts:148 → test.skip "No member with a workspace membership"
e2e/extended/lead-detail-interactions.spec.ts:?? → test.skip "No rows for fresh user" (×3)
e2e/extended/search-prospects.spec.ts:?? → test.skip "Search input not visible" / "CA column header not visible"
e2e/extended/keyboard-shortcuts-help.spec.ts:?? → test.skip "No input visible on /prospects"
e2e/core/invited-member-flow.spec.ts → console.log "SKIP — login failed" + return (silent)
```

Note : la spec `e2e/extended/multi-tenant-data-integrity.spec.ts` skip
parce qu'une fixture manque (`fixtures/tenants-prod.json`) — c'est un
cas DIFFÉRENT (fixture explicite, skip légitime tant que la fixture
n'est pas générée). Pas dans le scope de ce ticket.

## Pourquoi c'est gênant

Identique au ticket Supabase :
- En CI : compte canonique partagé entre runs, l'état dérive. Un jour
  le test passe en vert sans rien tester parce que le tenant a été
  vidé. Personne ne remarque.
- En vrai bug : si la régression touche le rendu d'une row (CSS, JS),
  on ne le voit pas — le test skip avant d'évaluer.
- Anti-pattern du sabotage-test : on ne peut pas casser le code et
  voir le test rougir, donc il "n'observe rien" au sens strict.

## Fix proposé — 2 stratégies au choix

### Stratégie A — Seed minimal côté helper canonique (recommandée)

Étendre `e2e/helpers/auth.ts` `ensureCanonicalUser()` pour seeder en
plus 1-2 leads de test dans le tenant canonique :

```ts
// Dans ensureCanonicalUser(), après le WorkspaceMember:
await prisma.lead.upsert({
  where: { /* identifiant stable */ },
  update: {},
  create: {
    tenantId: tenant.id,
    nom_entreprise: "E2E Test Lead",
    domain: "e2e-test-lead.example.fr",
    siren: "999999999",
    // ... champs requis du modèle Lead Prosp
  },
});
```

Puis remplacer dans chaque spec :

```ts
// Avant:
if (rowCount === 0) {
  test.skip(true, "No rows for fresh user");
  return;
}

// Après:
expect(rowCount, "compte canonique doit avoir au moins 1 lead seedé").toBeGreaterThan(0);
```

### Stratégie B — Helper ensureLeads() séparé

Si on veut garder le seed lead optionnel (pas tous les tests en ont
besoin) :

```ts
// e2e/helpers/seed.ts
export async function ensureCanonicalLeads(count = 1) { ... }

// Dans la spec :
test.beforeAll(async () => {
  await ensureCanonicalLeads(1);
});
```

→ Plus modulaire mais plus de code à maintenir.

**Recommandation** : Stratégie A. Le compte canonique EST le compte
de test E2E — il doit avoir le minimum vital pour que les tests
fassent leur boulot. C'est cohérent avec la philosophie helpers/auth.ts.

## Cas `invited-member-flow.spec.ts`

Spec différente : elle teste un membre INVITÉ (pas le owner). Skip
silencieux par `console.log + return` si le compte invité n'existe pas
en DB. À traiter à part :
- Soit créer un 2e compte canonique "invited member" dans le helper,
- Soit transformer le skip en `expect.fail` avec un message clair
  ("compte invité absent, seed manquant").

## Validation post-fix

```bash
# Sabotage : delete le lead canonique, relancer admin-members + lead-detail
# → DOIT être ROUGE explicite, pas skip.
ssh dev-pub 'docker exec postgres-staging psql -U app prospection \
  -c "DELETE FROM leads WHERE domain = '\''e2e-test-lead.example.fr'\''"'

ssh dev-pub 'docker run --rm --network staging-edge -v /tmp/e2e:/work -w /work \
  -e DATABASE_URL="..." -e PROSPECTION_URL="..." \
  mcr.microsoft.com/playwright:v1.60.0-jammy \
  npx playwright test e2e/extended/lead-detail-interactions.spec.ts \
    --project=chromium --reporter=list'

# Doit échouer ROUGE "compte canonique doit avoir au moins 1 lead seedé"
# avant le fix du helper. Si on relance ensuite, ensureCanonicalLeads
# le ré-upsert et le test passe.
```

## Périmètre

- `e2e/helpers/auth.ts` : extension (stratégie A) ou helper séparé (B)
- `e2e/extended/admin-members.spec.ts` : remplacer 2 skip par assert
- `e2e/extended/lead-detail-interactions.spec.ts` : remplacer 3 skip
- `e2e/extended/search-prospects.spec.ts` : remplacer 2 skip
- `e2e/extended/keyboard-shortcuts-help.spec.ts` : remplacer 1 skip
- `e2e/core/invited-member-flow.spec.ts` : transformer skip silencieux
  en `expect.fail` + créer 2e compte canonique si besoin

**Ne pas toucher** au code `src/`, aux workflows CI.

## Effort

~2h. Stratégie A est petite (1 seed Prisma idempotent + 8 `test.skip`
→ `expect`). Le validation sabotage-test prend 30 min de plus.
