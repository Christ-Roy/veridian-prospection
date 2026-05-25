import { SendingAccountCard } from "@/components/settings/SendingAccountCard";

export const dynamic = "force-dynamic";

export default function SendingAccountSettingsPage() {
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <header>
        <h1 className="text-2xl font-bold">Compte d&apos;envoi</h1>
        <p className="text-sm text-muted-foreground">
          Envoyez vos campagnes outreach depuis votre propre Gmail. Meilleure
          délivrabilité que via un sender Veridian — votre domaine, votre
          réputation.
        </p>
      </header>

      <SendingAccountCard />
    </div>
  );
}
