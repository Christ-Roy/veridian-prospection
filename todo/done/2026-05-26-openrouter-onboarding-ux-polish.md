# [PROSPECTION] OpenRouter onboarding UX — polish flow OAuth PKCE + BYOK fallback

> **Type** : UX polish + décision stratégique
> **Sévérité** : 🟡 P1 — bloque la commercialisation IA (sans onboarding clair, users vont planter)
> **Owner** : agent UI/UX à spawner OU action team-lead
> **Créé** : 2026-05-26 par team-lead après recherche complète "OpenRouter user-pays"

---

## Contexte

L'agent W9d a livré OAuth PKCE OpenRouter (`87e42ff`). Une recherche complémentaire 2026-05-26 confirme :
- **OAuth PKCE OpenRouter = state-of-the-art** du pattern "user paie sa propre conso"
- Anthropic a **fermé** son OAuth third-party (mai 2026)
- OpenAI/Together/Mistral/Groq : tous BYOK API key pur, aucun OAuth user-pays
- Il **n'y a pas mieux à câbler** sur le marché LLM en 2026

## Décision Robert 2026-05-26

**Pas de `OPENROUTER_VERIDIAN_KEY` posée dans nos ENV** (staging ni prod). Robert ne paie rien pour la conso IA des users. Chaque user gère sa propre balance OpenRouter.

## Actions à faire

### 1. UX onboarding OAuth PKCE (priorité haute)

Le composant `OpenRouterLinkCard.tsx` livré par W9d doit présenter le flow de façon **business-friendly**, pas comme "connecter une API key" :

- **Titre** : "Activer l'IA pour vos mails" (pas "Connecter OpenRouter")
- **Sous-texte** : "1 clic pour vous brancher sur OpenRouter, le service qui héberge les modèles IA. Vous payez votre consommation à vous, pas à Veridian."
- **Bouton primary** : "Activer l'IA" → déclenche le flow OAuth PKCE
- **Détails dépliables** : "Comment ça marche concrètement ?"
  - Étape 1 : Clic sur "Activer l'IA"
  - Étape 2 : OpenRouter vous demande de vous logger / créer un compte (gratuit, 30 secondes)
  - Étape 3 : OpenRouter vous demande de déposer 5-10$ pour activer l'IA (paiement Stripe sur leur plateforme, vous gardez votre balance)
  - Étape 4 : Vous revenez sur Veridian, l'IA est activée
- **Bandeau coût indicatif** : "1 mail IA = environ 0.001-0.01$ — vos 5$ déposés = des milliers de mails"

### 2. Fallback BYOK manuel (priorité moyenne)

Garder l'ancienne option "Coller votre clé Anthropic/OpenAI/Mistral/OpenRouter directe" comme fallback pour power users :

- Section "Mode avancé" en dépliant accordéon
- Texte : "Vous avez déjà une clé API d'un fournisseur (Anthropic Claude, OpenAI, Mistral...) ? Collez-la ici."
- 4 inputs (1 par provider) avec validation format clé
- ⚠️ Cette clé est **chiffrée AES-256-GCM** et stockée côté Veridian (cf migration 0024 tenant_ai_config)

### 3. Retirer le fallback `OPENROUTER_VERIDIAN_KEY` côté code

Le code IA (`src/lib/ai/resolver.ts` livré par W9d) a un fallback vers `process.env.OPENROUTER_VERIDIAN_KEY` si pas de clé user. Comme on ne paiera jamais pour les users, **ce fallback doit être retiré** OU **transformé en mode "demo limité"** :

**Option A — Retrait pur** : si pas de clé user (OAuth PKCE ou BYOK), l'IA est désactivée. UI affiche "Activez l'IA pour générer des mails".

**Option B — Mode demo 3 essais** : on garde `OPENROUTER_VERIDIAN_KEY` pour offrir 3 générations gratuites par user (rate-limit en DB), ensuite il doit activer OAuth PKCE pour continuer. Donne un goût avant de demander un dépôt.

**Reco** : Option B pour réduire la friction d'onboarding (un user clique "Générer IA", voit le résultat, comprend la valeur, ensuite accepte d'activer son compte OpenRouter). Coût estimé pour Robert : ~5$/mois si 100 users essaient.

### 4. Doc + FAQ

Créer `docs/OPENROUTER-USER-GUIDE.md` qui explique :
- Pourquoi OpenRouter (28 modèles unifiés, paiement à l'usage, pas d'abonnement)
- Comment activer (3 étapes screenshots)
- Comment recharger sa balance
- Comment voir sa consommation côté OpenRouter
- FAQ : "Et si je veux résilier ?", "Et si j'ai déjà un compte Claude ?", "Combien ça me coûte par mois ?"

## Definition of done

- [ ] Composant `OpenRouterLinkCard.tsx` reformulé business-friendly
- [ ] Fallback BYOK section accordéon dépliable
- [ ] Décision Robert : Option A (retrait) ou Option B (demo 3 essais) pour `OPENROUTER_VERIDIAN_KEY`
- [ ] Si Option B : implémentation rate-limit DB (mail_outbox count par user) + ENV `OPENROUTER_VERIDIAN_KEY` posée
- [ ] Doc `docs/OPENROUTER-USER-GUIDE.md` créée
- [ ] Spec E2E hard-core : full flow Activer IA → OAuth callback → premier mail généré

## Estimation

~2-4h dev (selon Option A vs B) + ~1h doc.

## Référence

- Agent recherche OpenRouter user-pays 2026-05-26 (verdict complet dans messages session)
- W9d livraison OAuth PKCE : commit `87e42ff` staging
- Sources OpenRouter : https://openrouter.ai/docs/guides/overview/auth/oauth
