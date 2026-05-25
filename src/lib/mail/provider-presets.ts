/**
 * Presets fournisseurs mail BYO (IMAP + SMTP).
 *
 * Permet d'auto-remplir host/port/TLS dans les formulaires settings/mail
 * et de guider l'utilisateur vers la page App Password de son fournisseur
 * (Gmail, Microsoft, Yahoo, iCloud exigent un mot de passe applicatif
 * dédié depuis 2022). OVH / Free / FAI utilisent le password de boîte
 * direct.
 *
 * Source de vérité pour les domaines détectés depuis l'email saisi.
 * Pas de stockage en DB — `detectProvider(email)` est dérivable à tout
 * moment.
 */

export type MailProviderId =
  | "gmail"
  | "outlook"
  | "yahoo"
  | "icloud"
  | "ovh"
  | "free"
  | "custom";

export type MailProviderPreset = {
  id: MailProviderId;
  label: string;
  domains: string[];
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; tls: boolean };
  requiresAppPassword: boolean;
  appPasswordUrl?: string;
  appPasswordGuide?: {
    title: string;
    steps: Array<{ text: string }>;
  };
};

export const MAIL_PROVIDERS: MailProviderPreset[] = [
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    domains: ["gmail.com", "googlemail.com"],
    imap: { host: "imap.gmail.com", port: 993, tls: true },
    smtp: { host: "smtp.gmail.com", port: 465, tls: true },
    requiresAppPassword: true,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    appPasswordGuide: {
      title: "Créer un App Password Google",
      steps: [
        {
          text: "Active la double authentification si pas encore fait (myaccount.google.com/security)",
        },
        {
          text: 'Sur la page App Passwords, choisis "Autre (nom personnalisé)" dans le menu déroulant',
        },
        { text: 'Nomme-le "Veridian Prospection" puis clique "Générer"' },
        {
          text: "Copie les 16 caractères affichés (sans espaces) et colle ici",
        },
      ],
    },
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    domains: ["outlook.com", "hotmail.com", "live.fr", "live.com"],
    imap: { host: "outlook.office365.com", port: 993, tls: true },
    smtp: { host: "smtp.office365.com", port: 587, tls: true },
    requiresAppPassword: true,
    appPasswordUrl: "https://account.microsoft.com/security",
    appPasswordGuide: {
      title: "Créer un App Password Microsoft",
      steps: [
        { text: "Va sur account.microsoft.com/security" },
        {
          text: 'Section "Advanced security options" → "App passwords" → "Create a new app password"',
        },
        { text: 'Nomme-le "Veridian Prospection"' },
        { text: "Copie le mot de passe généré et colle ici" },
      ],
    },
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    domains: ["yahoo.com", "yahoo.fr", "ymail.com"],
    imap: { host: "imap.mail.yahoo.com", port: 993, tls: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, tls: true },
    requiresAppPassword: true,
    appPasswordUrl:
      "https://login.yahoo.com/account/security/app-passwords",
    appPasswordGuide: {
      title: "Créer un App Password Yahoo",
      steps: [
        { text: 'Yahoo Account Security → "Generate app password"' },
        { text: 'Nomme-le "Veridian Prospection"' },
        { text: "Copie le mot de passe et colle ici" },
      ],
    },
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    domains: ["icloud.com", "me.com", "mac.com"],
    imap: { host: "imap.mail.me.com", port: 993, tls: true },
    smtp: { host: "smtp.mail.me.com", port: 587, tls: true },
    requiresAppPassword: true,
    appPasswordUrl: "https://appleid.apple.com/account/manage",
    appPasswordGuide: {
      title: "Créer un App Password Apple ID",
      steps: [
        {
          text: "appleid.apple.com → Sign-In and Security → App-Specific Passwords",
        },
        { text: 'Génère un nouveau password nommé "Veridian Prospection"' },
        { text: "Copie et colle ici" },
      ],
    },
  },
  {
    id: "ovh",
    label: "OVH Mail",
    domains: ["ovh.fr", "ovh.net"],
    imap: { host: "ssl0.ovh.net", port: 993, tls: true },
    smtp: { host: "ssl0.ovh.net", port: 465, tls: true },
    requiresAppPassword: false,
  },
  {
    id: "free",
    label: "Free / Proxad",
    domains: ["free.fr"],
    imap: { host: "imap.free.fr", port: 993, tls: true },
    smtp: { host: "smtp.free.fr", port: 465, tls: true },
    requiresAppPassword: false,
  },
];

export function detectProvider(email: string): MailProviderPreset | null {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;
  return MAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}
