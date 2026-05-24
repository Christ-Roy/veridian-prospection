# [PROSPECTION] Audit — aucun résidu trial / freemium après paiement (cross-app)

> **Sévérité** : 🟡 P1
> **Owner** : agent Prospection
> **Créé** : 2026-05-24
> **Demandeur** : agent Hub (audit cross-app trial)
> **Référence Hub** : `veridian-hub/docs/AUDIT-TRIAL-RESIDUS-2026-05-24.md`
> **Ticket origine** : `veridian-hub/todo/2026-05-23-audit-trial-residus-apres-paiement.md`

---

## Contexte

Promesse Robert : "client paie = plus aucune limite, plus aucun bandeau,
plus aucun mail trial, plus AUCUN cap visible". Côté Hub, l'agent Hub a
livré 2 fixes aujourd'hui (2026-05-24) pour purger `tenant_trials` au
webhook Stripe et durcir le cron `processEndingSoon`.

**Côté Hub c'est verrouillé**. Maintenant Prospection doit être audité
pour garantir qu'après le passage d'un tenant à `prospection_plan=pro`
(ou `business`), **aucun cap, compteur, freemium-banner ne subsiste**.

---

## À auditer côté Prospection

### A. `veridian_plan` / table workspace_plan

À la réception de `update-plan plan=pro plan_source=stripe` du Hub :
- Row plan mise à jour
- Aucun timer/quota trial ne continue à tourner
- L'invariant "plan courant = lecture DB" est respecté à chaque request

### B. Limite quotidienne / hebdo / "pack permanent" prospects

Le freemium Prospection limite à 100 prospects "welcome pack permanent".
**Au passage paid, ces limites doivent disparaître** :
- Compteur d'usage ne s'arrête plus à 100/100 — soit illimité, soit
  juste un compteur informatif sans cap
- L'UI ne doit jamais afficher "98/100 prospects, upgrade pour
  continuer" à un user `plan=pro`
- Aucun job/cron Prospection ne refuse une action en checkant un cap
  obsolète

### C. Middleware caps

Le middleware Prospection qui applique les caps freemium doit :
- Lire le plan COURANT du tenant, pas un cache stale d'avant conversion
- TTL court (≤30s) ou invalidation explicite à la réception du
  webhook update-plan
- Endpoint POLL `GET /api/billing-state/<tenantId>` côté Hub renvoie
  `plan_source=stripe` immédiatement (Hub purge `tenant_trials` au
  webhook depuis 2026-05-24)

### D. Welcome leads au passage trial→paid

Côté Hub (cf `utils/stripe/prisma-sync.ts:310`), un upgrade Prospection
free→pro / pro→business déclenche un `grantWelcomeLeadsBestEffort` qui
appelle `POST /api/tenants/{id}/credit-leads` côté Prospection avec
`source='welcome_upgrade'` et le delta calculé via
`computeWelcomeLeadsDelta(oldPlan, newPlan)`.

**À confirmer côté Prospection** :
- L'endpoint `credit-leads` accepte bien cet appel (HMAC ok, payload ok)
- L'invariant "1 welcome par palier lifetime" est respecté
  (idempotency_key déterministe = tenant + welcome_plan)
- Le crédit apparaît bien dans le compteur leads du user

### E. UI Prospection — bandeaux, badges, modals freemium

Grep dans le dashboard Prospection :
- Bandeau "essai gratuit" / "freemium" disparaît dès `plan=pro`
- Modals "upgrade pour débloquer X" ne s'affichent plus
- Badge "Free" → "Pro" dans le header / sidebar
- Pas de tooltip "Cette fonctionnalité nécessite Pro" sur menu items

### F. Crons / emails trial / marketing Prospection

Si Prospection a ses propres mails trial / marketing :
- Skip les users `plan != 'freemium'`
- Annuler les mails programmés à la réception update-plan

---

## Demande précise à l'agent Prospection

1. **Audit** : produire un rapport similaire à
   `veridian-hub/docs/AUDIT-TRIAL-RESIDUS-2026-05-24.md` listant les
   call sites Prospection qui touchent au plan / freemium / caps, et
   leur comportement post-upgrade
2. **Fix(s)** : pour chaque gap, livrer le fix côté Prospection (ne PAS
   toucher au Hub)
3. **Tests** : ajouter tests anti-régression
4. **Rapport** : déposer dans `veridian-prospection/docs/AUDIT-TRIAL-RESIDUS-PROSPECTION.md`
   et notifier l'agent Hub via un `## Réponse` dans ce fichier

---

## Hors scope

- Ne pas toucher au code Hub (responsabilité Hub)
- Ne pas changer le contrat `update-plan` ou `credit-leads`

## DoD

- [ ] Rapport audit Prospection livré
- [ ] Fix(s) Prospection livré(s)
- [ ] Tests anti-régression côté Prospection
- [ ] Ce fichier mis à jour avec un `## Réponse — YYYY-MM-DD` quand terminé
