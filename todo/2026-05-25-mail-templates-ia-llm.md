# [PROSPECTION] Mail templates — génération IA avec clés API configurables

> **Type** : Feature majeure — différenciateur commercial
> **Sévérité** : 🟡 P1 — argument de vente cœur ("templates écrits par IA selon le contexte du prospect")
> **Owner** : agent Prospection
> **Créé** : 2026-05-25
> **Demandeur** : Robert ("si il faut intégrer de l'IA fait le avec des clés api configurables pour écrire les template de manière intelligente")

## Vision

Le commercial ouvre la fiche d'un prospect et clique "Rédige-moi un mail". Une IA (Claude, GPT, Mistral…) génère un mail personnalisé selon :
- Le contexte du prospect (secteur, dette tech, taille, signaux business)
- L'objectif du mail (prise de contact, relance, présentation démo, suite RDV)
- Le ton choisi (formel, friendly, expert)
- L'historique des échanges précédents (timeline 360°)

Le commercial peut réécrire avant envoi (l'IA est un assistant, pas un sender automatique).

## Architecture — clés API configurables par tenant

**Décision Robert** : "clés API configurables". Donc :
- Le commercial fournit SA clé API (BYO) — pas de coût IA porté par Veridian
- Stockée chiffrée AES-256-GCM (réutilise lib/crypto/encrypt-password.ts)
- Provider configurable (dropdown) : Claude (Anthropic), GPT (OpenAI), Mistral, OpenRouter
- 1 config par tenant (admin only)

### Modèle DB — `tenant_ai_config`

```prisma
model TenantAiConfig {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String   @unique @map("tenant_id") @db.Uuid
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  /// "anthropic" | "openai" | "mistral" | "openrouter"
  provider      String   @db.VarChar(32)
  /// "claude-opus-4-7" | "gpt-4o" | "mistral-large" | ...
  model         String   @db.VarChar(64)
  /// AES-256-GCM via AUTH_SECRET, format "iv_b64:tag_b64:cipher_b64"
  apiKeyEnc     String   @map("api_key_enc")
  /// "fr" | "en"
  defaultLocale String   @default("fr") @map("default_locale") @db.VarChar(8)

  /// Métriques d'usage (souple, pas critique)
  lastUsedAt    DateTime? @map("last_used_at") @db.Timestamptz
  totalTokensIn  Int      @default(0) @map("total_tokens_in")
  totalTokensOut Int      @default(0) @map("total_tokens_out")

  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@map("tenant_ai_config")
}
```

### Adapter pattern — `src/lib/ai/`

Façade unique pour les 4 providers :
```ts
// src/lib/ai/adapter.ts
export interface AiAdapter {
  generateText(prompt: string, opts: { maxTokens?: number; temperature?: number }): Promise<{
    text: string;
    tokensIn: number;
    tokensOut: number;
  }>;
}

export function getAdapter(config: TenantAiConfig): AiAdapter {
  switch (config.provider) {
    case "anthropic": return new AnthropicAdapter(decryptApiKey(config.apiKeyEnc), config.model);
    case "openai":    return new OpenAiAdapter(decryptApiKey(config.apiKeyEnc), config.model);
    case "mistral":   return new MistralAdapter(decryptApiKey(config.apiKeyEnc), config.model);
    case "openrouter": return new OpenRouterAdapter(decryptApiKey(config.apiKeyEnc), config.model);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

Implémentations minimales par provider (50-80 lignes chacune), avec catch des erreurs API (401, 429, 500) → retour structuré au client.

### Endpoint — `POST /api/mail/generate`

```ts
// Body Zod : { siren, objective: "intro"|"relance"|"demo"|"follow_rdv", tone: "formel"|"friendly"|"expert" }
// Auth : requireAuth + ownership prospect (workspace filter)
// Process :
//   1. Charge TenantAiConfig (404 si pas configuré → UI invite admin)
//   2. Charge prospect + contacts + timeline 360° (helpers existants)
//   3. Build prompt avec context structuré
//   4. Appelle adapter.generateText
//   5. Retourne { subject, body_html, body_text, tokens_used }
//   6. Update TenantAiConfig.lastUsedAt + totalTokens (non bloquant, fire-and-forget)
// Rate limit : 30/min/user (LLM call = pas du gratuit)
```

### UI — bouton "✨ Rédige avec IA" dans modal compose mail

À côté du dropdown templates existants, un nouveau bouton "✨ Rédige avec IA" qui ouvre une modal :
- Objectif (radio : intro / relance / demo / follow_rdv)
- Ton (radio : formel / friendly / expert)
- Bouton "Générer" → loading 3-8s → remplit subject + body de la compose modal
- Le commercial peut éditer avant envoi (toujours)

### Page settings — `/settings/mail` onglet "IA"

Nouvel onglet :
- Dropdown provider (Anthropic / OpenAI / Mistral / OpenRouter)
- Dropdown model (filtré par provider)
- Input API key (password type, masquée)
- Locale par défaut (fr / en)
- Bouton "Tester" : envoie un prompt court ("Dis bonjour") → affiche la réponse → preuve que la clé marche
- Save

## Sécurité

- API key chiffrée AES-256-GCM (réutilise lib/crypto/encrypt-password.ts — pas de duplication)
- JAMAIS retournée par le GET /api/mail/ai-config (masquée en `***`)
- requireAdmin pour PUT/DELETE
- Logs JAMAIS la clé (vérifier rate limit logger n'inclut pas la clé)
- Compteur tokens en DB pour anti-abus (alerte admin si > X par jour)

## Tests obligatoires

### Unit
- Adapter Anthropic / OpenAI / Mistral / OpenRouter : mock fetch → assert le shape de payload envoyé
- Crypto API key round-trip
- Endpoint /api/mail/generate : RBAC + 404 si pas de config + 401 si auth invalide
- Builder de prompt : assert que les variables contexte sont bien injectées

### Source-level
- UI bouton "✨ Rédige avec IA" présent dans compose modal
- UI onglet IA dans /settings/mail
- Dropdown provider + model affiche les bonnes options

### E2E (suite vague 6.1 mail-batteries-tests)
- Admin configure provider mock → "Tester" → ✓
- Commercial sur fiche prospect → ✨ Rédige → modal IA → choix objectif → résultat injecté

## Effort

- Migration Prisma + schéma : 1h
- Lib adapter (4 providers) : 6h (1.5h × 4)
- Lib crypto API key (réutilise existant) : 30 min
- Lib builder prompt + context : 2h
- Endpoint /api/mail/generate + tests : 3h
- UI onglet settings IA + tests : 3h
- UI bouton compose + tests : 2h
- Tests E2E : 2h
- **Total : ~3 jours**

Tier 🔴 HAUT (migration DB + crypto + nouveau provider externe + UI client-facing).

## Coordination

Pas de dépendance Hub. 100% Prospection. Mais cohérent avec la stratégie "BYO crédentiels" du mail SMTP — le client garde la main et le coût.

## Pourquoi P1 différenciateur

Apollo, Lemlist, Outreach proposent des templates standardisés. **Personne** ne propose "IA qui rédige spécifiquement pour CE prospect en se basant sur son scoring tech + son secteur + son historique". C'est exactement le différenciateur Veridian (la base SIREN + scoring).

Cf vision Robert : produit nichable, n'importe quel agence web peut envoyer 50 mails ultra-personnalisés en 1h au lieu d'en envoyer 5 péniblement.

## Référence

- Mail v1 SMTP : `src/lib/mail/` + `src/app/api/mail/`
- Crypto pattern : `src/lib/crypto/encrypt-password.ts`
- Timeline 360° (source contexte) : `src/lib/queries/timeline.ts`
- Memory : [[feedback_promo_prod_gate_mega_battery]] (gate inviolable)
