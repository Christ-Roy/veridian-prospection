# [PROSPECTION] Ajouter boutons "Continuer avec Google + Microsoft" sur page login fallback

> **Type** : UX login fallback Prospection
> **Sévérité** : 🟡 P2
> **Owner** : agent Prospection
> **Spec parent** : `veridian-hub/todo/2026-05-20-fallback-login-apps-redirect-hub.md`
> **Créé** : 2026-05-20

## Demande

Sur `prospection.app.veridian.site/login` (page login fallback), ajouter
2 boutons "Continuer avec Google" + "Continuer avec Microsoft" en plus du
form magic link existant.

**Pas d'implémentation OAuth côté Prospection** — les boutons redirigent
simplement vers `app.veridian.site/login?next=<current_url>` et le Hub gère
le flow OAuth puis renvoie un magic link Prospection via le contrat HMAC.

## Pré-requis

- Hub doit avoir livré le support `?next=` (Phase 2 ticket OAuth)

## Effort estimé

- 0.5j (UI + redirect, pas d'API)

## Référence

- Spec complète : `veridian-hub/todo/2026-05-20-fallback-login-apps-redirect-hub.md`

## État — 2026-05-20

🛑 **BLOQUÉ — Hub n'a pas livré le support `?next=`.**

Audit fait sur `veridian-hub` :
- `components/auth/LoginForm.tsx` utilise `callbackUrl` (next-auth standard), **pas `next`**
- Aucune whitelist `*.veridian.site` côté serveur
- Aucun code de relay `next → generateMagicLink → redirect` côté Hub
- Checklist du ticket parent Hub : 0/3 cases cochées

→ Ticket ré-ouvrable dès que `2026-05-20-fallback-login-apps-redirect-hub.md`
côté Hub est livré + déployé. Robert doit router la livraison côté
agent Hub avant que cet agent puisse implémenter les boutons.
