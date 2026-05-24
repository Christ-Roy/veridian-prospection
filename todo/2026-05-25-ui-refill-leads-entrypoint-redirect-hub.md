# [PROSPECTION] UI — bouton "Acheter des leads" → redirect Hub refill-leads

> **Type** : UI/UX entrée billing
> **Sévérité** : 🟡 P1 — friction zéro pour le user à court de leads
> **Owner** : agent Prospection (UI)
> **Créé** : 2026-05-25 par team-lead Hub
> **Demandeur** : Robert
> **Refs cross-app** :
> - Page Hub livrée : `https://app.veridian.site/dashboard/refill-leads` (BUILD #9 commit `b71c83a`)
> - Contrat : `veridian-hub/docs/CONTRAT-BILLING.md` §8.4 (Hub seul interlocuteur Stripe)
> - Pattern : OAuth bounce Couche 4 (`veridian-hub/docs/CONTRAT-HUB.md` §6bis.8)

---

## 0. Contexte

Le Hub a livré la page d'achat refill leads sur `https://app.veridian.site/dashboard/refill-leads` (slider quantité 1-100k, prix live via grille dégressive `shared/pricing/refill.ts`, Stripe Checkout one-shot, dispatch HMAC `credit-leads` post-paiement). **Robert demande qu'on ajoute aussi un point d'entrée côté Prospection** pour les users à court de leads qui sont déjà dans l'app.

Pattern : exactement comme OAuth bounce — **PAS de duplication code Stripe**, juste un bouton qui redirige vers la page Hub.

## 1. Périmètre — ce qu'on fait / ne fait pas

### On fait

- Un ou plusieurs points d'entrée UI dans Prospection qui redirigent vers `https://app.veridian.site/dashboard/refill-leads?from=prospection&tenant=<id>`
- Un état empty quand `leadsRemaining === 0` qui CTA "Acheter des leads"
- Un bouton "Acheter des leads" dans le header / sidebar (à arbitrer par l'agent Prospection selon la grammaire UX existante)

### On NE FAIT PAS (interdit par CONTRAT-BILLING §8.4)

- ❌ Créer un endpoint `POST /api/billing/refill-leads/checkout` côté Prospection
- ❌ Appeler Stripe SDK depuis Prospection
- ❌ Recevoir des webhooks Stripe `checkout.session.completed` côté Prospection
- ❌ Stocker `stripe_customer_id` côté Prospection (sauf cache pour discovery, jamais source de vérité)

**Justification** : §8.1 — "1 stripe_customer_id = 1 user Hub = 1 humain". §8.4 — "Le Hub reste seul interlocuteur Stripe". L'app reçoit le crédit via le signal HMAC `credit-leads` (déjà livré côté Prospection, cf `POST /api/tenants/{id}/credit-leads`).

## 2. Implémentation suggérée

### 2.1 Bouton "Acheter des leads"

Composant React partagé Prospection :

```tsx
// src/components/billing/BuyLeadsButton.tsx
'use client';
import { useSession } from 'next-auth/react';

export function BuyLeadsButton({
  variant = 'default',
  className,
}: { variant?: 'default' | 'cta-empty'; className?: string }) {
  const { data: session } = useSession();
  const url = new URL('https://app.veridian.site/dashboard/refill-leads');
  url.searchParams.set('from', 'prospection');
  if (session?.user?.tenantId) url.searchParams.set('tenant', session.user.tenantId);
  return (
    <a href={url.toString()} className={className}>
      {variant === 'cta-empty' ? 'Acheter des leads' : '+ Leads'}
    </a>
  );
}
```

### 2.2 Empty state quand leadsRemaining === 0

Là où l'UI Prospection affiche "0 leads restants" / paywall search :

```tsx
{leadsRemaining === 0 && (
  <EmptyState
    title="Tu n'as plus de leads disponibles"
    description="Achète un lot de leads, crédité à vie sur ton workspace."
  >
    <BuyLeadsButton variant="cta-empty" />
  </EmptyState>
)}
```

### 2.3 Bouton header / sidebar (optionnel selon grammaire UX Prospection)

Dans le layout dashboard Prospection, à côté du compteur "X leads restants" :

```tsx
<div className="flex items-center gap-2">
  <span>{leadsRemaining} leads</span>
  <BuyLeadsButton variant="default" className="text-xs underline" />
</div>
```

### 2.4 (Bonus) Param `?from=prospection` côté Hub

Le Hub peut tracer la source du checkout (analytics, optim onboarding) — le param est déjà accepté par la route Hub (`searchParams.get('from')`), juste utilisé pour metadata Stripe. Pas d'action requise côté Prospection au-delà de poser le param.

## 3. Définition of done

- [ ] Composant `BuyLeadsButton` créé + tests Nuclear
- [ ] Empty state câblé sur les écrans Prospection où `leadsRemaining === 0`
- [ ] Bouton CTA visible dans le header/sidebar (à arbitrer)
- [ ] Pas d'appel Stripe direct depuis Prospection (audit grep `stripe` doit retourner uniquement les imports `lib/stripe/customer-cache` legacy s'il en existe)
- [ ] Pas de nouvelle route `/api/billing/*` côté Prospection
- [ ] Doc UX update dans `prospection/docs/UX-BILLING.md` si pertinent
- [ ] Push staging Prospection

## 4. Contraintes

- Marker commit `[risk:low]` (UI pure + tests)
- DEPLOY_ENV (jamais NODE_ENV)
- Tests Nuclear si lib/hooks créés
- Pas de touche au flow paiement (juste un lien)

## 5. Coordination cross-app

Si tu as besoin d'un signal côté Hub (ex: deeplink return après paiement réussi avec balance updated), ouvre un ticket dans `veridian-hub/todo/`. Pour l'instant : redirect simple suffit, le user retourne dans Prospection via le navigateur (back button) ou success_url Hub qui pourrait pointer sur Prospection avec un toast "X leads crédités".

À discuter : `success_url=https://prospection.app.veridian.site/?refilled=N` côté Hub pour fermer la boucle UX. Si oui, ticket Hub à part.
