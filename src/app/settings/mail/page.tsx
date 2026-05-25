import { MailConfigForm } from "@/components/mail/mail-config-form";
import { AiConfigForm } from "@/components/mail/ai-config-form";
import { ImapConfigForm } from "@/components/mail/imap-config-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const dynamic = "force-dynamic";

export default function MailSettingsPage() {
  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Mail</h1>
        <p className="text-sm text-muted-foreground">
          Envoyez vos mails commerciaux depuis Veridian — SMTP + génération IA
          (BYO clé API) + réception IMAP.
        </p>
      </header>

      <Tabs defaultValue="smtp" className="space-y-4">
        <TabsList>
          <TabsTrigger value="smtp">SMTP</TabsTrigger>
          <TabsTrigger value="imap">IMAP (réception)</TabsTrigger>
          <TabsTrigger value="ia">IA</TabsTrigger>
        </TabsList>
        <TabsContent value="smtp">
          <MailConfigForm />
        </TabsContent>
        <TabsContent value="imap">
          <ImapConfigForm />
        </TabsContent>
        <TabsContent value="ia">
          <AiConfigForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
