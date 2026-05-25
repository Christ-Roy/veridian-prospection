# [PROSPECTION] IMAP/SMTP — presets providers + flow App Password guidé

> **Type** : UX amélioration onboarding mail BYO
> **Sévérité** : 🟡 P1 — friction onboarding mail v2 IMAP/SMTP. Les users vont se planter sur "App Password" Google/MS si on ne guide pas.
> **Owner** : agent Prospection
> **Créé** : 2026-05-25 par team-lead (décision Robert)
> **Dépend de** : W8b IMAP réception livré (✓ commits b2faf67 + c6ba5c3 sur staging)

## Vision

Le commercial qui configure son IMAP (réception) ou son SMTP (envoi via BYO password, hors Hub Gateway Gmail OAuth) doit pouvoir **arriver à la page Google App Password en 1 clic, avec le minimum d'allers-retours**. Aujourd'hui :

1. User entre son email `xxx@gmail.com`
2. Doit deviner que Gmail bloque les passwords normaux depuis 2022
3. Doit chercher la page App Password Google (planquée dans Compte > Sécurité > 2FA)
4. Doit créer un app password "Other" → coller dans Veridian
5. Mêmes étapes pour Outlook (encore plus planqué)

Cible :

1. User entre son email `xxx@gmail.com`
2. **Détection auto-domaine** → preset host/port/TLS Gmail + warning "Gmail exige un App Password"
3. **Bouton "Créer un App Password Google"** → ouvre `https://myaccount.google.com/apppasswords` dans un nouvel onglet
4. Guide visuel inline (3 étapes screenshot) "Choisir 'Autre' > nommer 'Veridian Prospection' > copier les 16 caractères"
5. User colle → "Tester la connexion" → green light

## Périmètre

### 1. Lib `src/lib/mail/provider-presets.ts`

```ts
export type MailProviderPreset = {
  id: 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'ovh' | 'free' | 'custom';
  label: string;
  domains: string[];  // ['gmail.com', 'googlemail.com'] etc.
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; tls: boolean };
  requiresAppPassword: boolean;
  appPasswordUrl?: string;
  appPasswordGuide?: {
    title: string;
    steps: Array<{ text: string; screenshot?: string }>;
  };
};

export const MAIL_PROVIDERS: MailProviderPreset[] = [
  {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    domains: ['gmail.com', 'googlemail.com'],
    imap: { host: 'imap.gmail.com', port: 993, tls: true },
    smtp: { host: 'smtp.gmail.com', port: 465, tls: true },
    requiresAppPassword: true,
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    appPasswordGuide: {
      title: 'Créer un App Password Google',
      steps: [
        { text: 'Active la double authentification si pas encore fait (myaccount.google.com/security)' },
        { text: 'Sur la page App Passwords, choisis "Autre (Custom Name)" dans le menu déroulant' },
        { text: 'Nomme-le "Veridian Prospection" puis clique "Générer"' },
        { text: 'Copie les 16 caractères affichés (sans espaces) et colle ici' },
      ],
    },
  },
  {
    id: 'outlook',
    label: 'Outlook / Microsoft 365',
    domains: ['outlook.com', 'hotmail.com', 'live.fr', 'live.com'],
    imap: { host: 'outlook.office365.com', port: 993, tls: true },
    smtp: { host: 'smtp.office365.com', port: 587, tls: true },  // STARTTLS
    requiresAppPassword: true,
    appPasswordUrl: 'https://account.microsoft.com/security',
    appPasswordGuide: {
      title: 'Créer un App Password Microsoft',
      steps: [
        { text: 'Va sur account.microsoft.com/security' },
        { text: 'Section "Advanced security options" → "App passwords" → "Create a new app password"' },
        { text: 'Nomme-le "Veridian Prospection"' },
        { text: 'Copie le mot de passe généré et colle ici' },
      ],
    },
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    domains: ['yahoo.com', 'yahoo.fr', 'ymail.com'],
    imap: { host: 'imap.mail.yahoo.com', port: 993, tls: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, tls: true },
    requiresAppPassword: true,
    appPasswordUrl: 'https://login.yahoo.com/account/security/app-passwords',
    appPasswordGuide: {
      title: 'Créer un App Password Yahoo',
      steps: [
        { text: 'Yahoo Account Security → "Generate app password"' },
        { text: 'Nomme-le "Veridian Prospection"' },
        { text: 'Copie le mot de passe et colle ici' },
      ],
    },
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imap: { host: 'imap.mail.me.com', port: 993, tls: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, tls: true },
    requiresAppPassword: true,
    appPasswordUrl: 'https://appleid.apple.com/account/manage',
    appPasswordGuide: {
      title: 'Créer un App Password Apple ID',
      steps: [
        { text: 'appleid.apple.com → Sign-In and Security → App-Specific Passwords' },
        { text: 'Génère un nouveau password nommé "Veridian Prospection"' },
        { text: 'Copie et colle ici' },
      ],
    },
  },
  {
    id: 'ovh',
    label: 'OVH Mail',
    domains: ['ovh.fr', 'ovh.net'],  // détection partielle (les users ovh ont leur propre domain)
    imap: { host: 'ssl0.ovh.net', port: 993, tls: true },
    smtp: { host: 'ssl0.ovh.net', port: 465, tls: true },
    requiresAppPassword: false,  // password de boîte direct
  },
  {
    id: 'free',
    label: 'Free / Proxad',
    domains: ['free.fr'],
    imap: { host: 'imap.free.fr', port: 993, tls: true },
    smtp: { host: 'smtp.free.fr', port: 465, tls: true },
    requiresAppPassword: false,
  },
];

export function detectProvider(email: string): MailProviderPreset | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return MAIL_PROVIDERS.find(p => p.domains.includes(domain)) ?? null;
}
```

### 2. Extension UI `src/components/settings/ImapConfigTab.tsx` (W8b) + `SmtpConfigTab.tsx` (v1)

À côté du champ Email/Username :
- Si `detectProvider(email)` retourne un preset → **auto-fill** les champs host/port/TLS au blur de l'input email (avec un toast discret "Détection Gmail, paramètres pré-remplis")
- Si `requiresAppPassword === true` → bandeau d'alerte amber avec :
  - Texte explicatif "Ton fournisseur exige un App Password (un mot de passe dédié à Veridian, pas ton password Gmail principal)"
  - Bouton primary "Créer un App Password" (target `_blank`, ouvre `appPasswordUrl`)
  - Section accordéon "Guide étape par étape" qui déroule les `appPasswordGuide.steps`

### 3. Tests Nuclear
- `src/__tests__/lib/mail-provider-presets.test.ts` :
  - `detectProvider('john@gmail.com')` → gmail
  - `detectProvider('jane@googlemail.com')` → gmail
  - `detectProvider('bob@OUTLOOK.COM')` → outlook (case insensitive)
  - `detectProvider('alice@boulanger.fr')` → null
  - 6 providers couverts ; preset valide (host non-vide, port > 0)
- `src/__tests__/components/MailProviderHint.test.tsx` :
  - Auto-fill au blur si gmail détecté
  - Bandeau amber visible si requiresAppPassword
  - Bouton "Créer App Password" target=_blank avec bonne URL
  - Pas de bandeau si OVH/Free (no app password)

### 4. E2E hard-core ≥ 8 specs
`e2e/staging-full/imap-provider-presets.spec.ts` :
- Happy : user tape `xxx@gmail.com` → host/port auto-remplis, bandeau app password visible, bouton ouvre nouvelle URL Google
- Edge : user tape email malformé → pas de detect, pas de bandeau
- Edge : domaine inconnu → pas de detect, no preset, mais user peut toujours saisir manuellement
- RBAC : non-auth, autre tenant ne voit pas ses presets (page protected)
- Pollution : user efface champ email après auto-fill → host/port restent (pas reset)
- Concurrence : 2 onglets ouverts, 1 change email → autre onglet pas affecté (state local)
- Cross-app : preset gmail respecte le contrat (port 993 SSL, pas 143 STARTTLS) — sinon imapflow plante

## Décision design

- **Pas de stockage du provider détecté en DB** : c'est dérivable de l'email à tout moment, on évite la dénormalisation
- **Pas de scraping des screenshots App Password Google** : on met le texte du guide, screenshot optionnel pour Vague 10+ si Robert veut
- **Pas de bypass auto-OAuth Google si gmail détecté** : on garde la distinction "BYO IMAP password" vs "OAuth via Hub Gateway W7a". L'user choisit explicitement entre les 2 (onglets séparés `/settings/sending-account` = OAuth Gmail send-only, `/settings/mail` IMAP tab = BYO read+write)

## Estimation

~3-4h dev cumulé : lib + 2 composants UI + tests + E2E.

## Definition of done

- [ ] Lib `provider-presets.ts` avec 6 providers minimum
- [ ] Auto-fill host/port/TLS au blur email dans ImapConfigTab + SmtpConfigTab
- [ ] Bandeau "App Password requis" avec CTA + guide steps
- [ ] Tests Nuclear (lib + 2 composants)
- [ ] ≥ 8 specs E2E hard-core
- [ ] CI staging verte + smoke
