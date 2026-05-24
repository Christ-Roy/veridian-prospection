import { MailConfigForm } from "@/components/mail/mail-config-form";

export const dynamic = "force-dynamic";

export default function MailSettingsPage() {
  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Mail SMTP</h1>
        <p className="text-sm text-muted-foreground">
          Envoyez vos mails commerciaux depuis Veridian avec votre propre SMTP.
        </p>
      </header>
      <MailConfigForm />
    </div>
  );
}
