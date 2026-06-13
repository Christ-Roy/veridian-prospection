# [PROSPECTION] Bouton "Importer ces leads dans le CRM Veridian"

> **Sévérité** : 🟡 P1 — vague 5 (UX cross-app après livraison CRM v1)
> **Owner** : agent veridian-prospection
> **Créé** : 2026-05-27 par team-lead Hub
> **Demandeur** : team-lead veridian-hub (suite audit-crm-needs + plan-crm-reimpl)

## Contexte

CRM Veridian (fork Twenty) déployé en staging 2026-05-27 (`crm.staging.veridian.site`). Le Hub orchestre :
- Provisioning tenant CRM (route admin `/api/admin/crm/create-tenant` en cours, cf `veridian-hub/todo/2026-05-27-route-admin-create-crm-tenant.md`)
- Bearer API key Twenty stockée chiffrée par tenant Hub
- Endpoint `POST /api/admin/crm/{tenantId}/push-leads` (à câbler vague 2 Hub)

**Use case business** :
> "Le user qualifie des leads via Prospection (séquences mail / cold call), puis veut les exporter dans son CRM Veridian (Twenty) pour suivi pipeline / opportunités / contacts détaillés."

## Action attendue (côté Prospection)

1. Sur la page liste leads (ou détail séquence), ajouter un bouton **"Importer dans le CRM Veridian"** visible UNIQUEMENT si le tenant a un CRM provisionné
   - Check de disponibilité via API Hub (à spécifier — probablement `GET /api/users/{userId}/apps` qui retourne la liste des apps avec leur status)
2. Au clic :
   - Sélecteur multiple (checkbox) sur les leads à importer (déjà géré côté UI ?)
   - POST vers Hub : `POST /api/admin/crm/{tenantId}/push-leads` avec body `{leads: [...]}` (mapping Prospection.Lead → Twenty.Person)
   - Hub appelle Twenty REST `/rest/people` en batch via Bearer du tenant
   - Réponse Hub : `{imported: N, skipped: M, errors: [...]}`
3. UI feedback : toast "N leads importés dans le CRM" + lien vers `https://crm.veridian.site/objects/people`

## Spec mapping Lead → Twenty.Person

À définir avec team-lead Hub :
- email → primaryEmail
- name → name.firstName + lastName (split)
- company → companies relation (créer si inexistant)
- enrichment fields → custom fields Twenty
- Idempotence : email primaire = clé unique côté Twenty (skip si existe déjà)

## Dépendances

- **Bloqué par** : Hub doit livrer `POST /api/admin/crm/{tenantId}/push-leads` (vague 2 backend Hub)
- **Pas urgent** : la fonctionnalité utilisateur peut attendre que CRM v1 dégradé soit en prod (toute la chaîne create-tenant + lifecycle + billing)

## Tests / DoD

- [ ] Bouton visible uniquement si user a tenant CRM
- [ ] Import 1 lead → vérifie présence dans CRM Twenty (via `/objects/people`)
- [ ] Import batch 10 leads → toast + count cohérent
- [ ] Idempotence : 2e import même leads → 0 doublon
- [ ] Erreur HMAC Hub → toast d'erreur clair (pas de fail silencieux)

## Ne PAS faire dans ce ticket

- Pas de UI custom dans le CRM Twenty (on consomme l'UI native Twenty)
- Pas de webhook Twenty→Prospection (le sens importe = pull-only Prospection→Hub→CRM)
- Pas de sync continue (one-shot import par clic, pas de cron)
