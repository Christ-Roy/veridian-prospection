import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";
import { ClientErrorBoundary } from "@/components/client-error-boundary";
import { SessionProviderClient } from "@/components/auth/session-provider-client";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Atlas", template: "%s · Atlas" },
  description: "Analyser un marché, définir ses cibles, les classer par priorité.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Atlas",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
};

/**
 * Cadre technique seulement : session, thème clair, remontée des erreurs client, notifications.
 * Atlas porte sa propre navigation (rail) ; l'ancienne barre de l'app n'est plus montée.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Lire les en-têtes rend chaque page dynamique : Next pose alors le nonce de la CSP (VER-265) sur ses scripts,
  // et next-themes le reçoit pour son script de thème.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="fr">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-white`}>
        <SessionProviderClient>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} nonce={nonce}>
            <ClientErrorBoundary />
            {children}
            <Toaster richColors position="bottom-left" />
          </ThemeProvider>
        </SessionProviderClient>
      </body>
    </html>
  );
}
