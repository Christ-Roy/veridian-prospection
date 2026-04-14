import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SipShell } from "@/components/softphone/sip-shell";
import { AppNav } from "@/components/layout/app-nav";
import { TrialProvider } from "@/lib/trial-context";
import { ClientErrorBoundary } from "@/components/client-error-boundary";
import { KeyboardShortcutsHelp } from "@/components/keyboard-shortcuts-help";
import { CommandPalette } from "@/components/command-palette";
import { PwaManager } from "@/components/pwa-manager";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prospection .fr",
  description: "Dashboard de prospection commerciale",
  manifest: "/manifest.json",
  themeColor: "#2563eb",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Prospection",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${geistSans.variable} font-sans antialiased bg-gray-50 dark:bg-gray-950`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <ClientErrorBoundary />
        <KeyboardShortcutsHelp />
        <CommandPalette />
        <TrialProvider>
          <SipShell>
            <Suspense><AppNav /></Suspense>
            <main className="flex-1">
              {children}
            </main>
          </SipShell>
        </TrialProvider>
        <PwaManager />
        <Toaster richColors position="bottom-left" />
        </ThemeProvider>
      </body>
    </html>
  );
}
