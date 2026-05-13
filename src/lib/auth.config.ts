// Auth.js v5 — config EDGE-SAFE (sans adapter Prisma).
// Utilisée par le middleware qui tourne en edge runtime. Les callbacks ici ne
// peuvent PAS utiliser Prisma.
//
// La config "complète" (avec adapter Prisma + providers Node-only) vit dans
// ./auth.ts et reprend ce fichier en base.

import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export const authConfig = {
  // En self-hosted (Dokploy + Traefik), Auth.js doit faire confiance au host
  // derrière le reverse proxy. Sinon erreur UntrustedHost sur /api/auth/session.
  trustHost: true,
  // Cookies session : 90 jours (3 mois) — cohérent avec Hub.
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 90, // 90 jours
    updateAge: 60 * 60 * 24, // 1 jour
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile",
          prompt: "select_account",
        },
      },
    }),
    // Le CredentialsProvider (email/password legacy) est branché uniquement
    // dans auth.ts (Node runtime) parce qu'il a besoin de Prisma + bcrypt.
  ],
  callbacks: {
    // Gate d'autorisation edge-safe — utilisé par le middleware Auth.js pour
    // décider si la requête passe. Pas de Prisma ici.
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      // Routes publiques Prospection (pas de marketing pages — c'est un
      // dashboard, pas un site marketing).
      const publicPrefixes = [
        "/login",
        "/signup",
        "/auth/",
        "/api/auth/",
        "/api/health",
        "/api/status",
        "/api/errors",
        "/invite/",
        "/api/invitations/",
        "/api/tenants/provision",
        "/api/auth/token",
      ];

      if (publicPrefixes.some((p) => pathname.startsWith(p))) {
        return true;
      }

      // Routes protégées : tout le reste nécessite une session.
      // Couvre /, /dashboard, /admin, /prospects, /pipeline, /historique,
      // /settings, et /api/* (sauf publiques ci-dessus).
      return !!auth;
    },
  },
} satisfies NextAuthConfig;
