"use client";

/**
 * Formulaire signature commerciale — onglet "Signature" de /settings/mail.
 *
 * Cf ticket follow-ups §J + migration 0030.
 *
 * Textarea HTML simple (pas de WYSIWYG en v1 — éditeur visuel arrive si la
 * demande monte). Aperçu live dans une div à droite du textarea.
 * Checkbox "Activer la signature" pour toggle on/off sans perdre le contenu.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Signature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface SignatureState {
  html: string;
  enabled: boolean;
}

const DEFAULT: SignatureState = { html: "", enabled: true };

export function MailSignatureForm() {
  const [state, setState] = useState<SignatureState>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/mail/signature")
      .then((r) => r.json())
      .then((data: { mailSignatureHtml: string | null; mailSignatureEnabled: boolean }) => {
        setState({
          html: data.mailSignatureHtml ?? "",
          enabled: data.mailSignatureEnabled ?? true,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/mail/signature", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailSignatureHtml: state.html.trim() || null,
          mailSignatureEnabled: state.enabled,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec sauvegarde signature");
      } else {
        toast.success("Signature sauvegardée");
      }
    } catch (err) {
      toast.error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <header className="flex items-center gap-2">
        <Signature className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">Signature commerciale</h2>
          <p className="text-xs text-muted-foreground">
            Appendée automatiquement à chaque mail sortant si activée.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <Checkbox
          id="signature-enabled"
          checked={state.enabled}
          onCheckedChange={(v) => setState((s) => ({ ...s, enabled: !!v }))}
        />
        <Label htmlFor="signature-enabled" className="cursor-pointer">
          Activer la signature pour mes mails sortants
        </Label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="signature-html">HTML</Label>
          <Textarea
            id="signature-html"
            value={state.html}
            onChange={(e) => setState((s) => ({ ...s, html: e.target.value }))}
            rows={10}
            placeholder={`<p><strong>Robert Brunon</strong><br>Veridian — Prospection commerciale</p>\n<p><a href="https://veridian.site">veridian.site</a> · +33 6 ...</p>`}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground mt-1">
            HTML basique : &lt;p&gt;, &lt;br&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;a&gt;, &lt;img&gt;.
          </p>
        </div>
        <div>
          <Label>Aperçu</Label>
          <div
            className="border rounded-md p-3 min-h-[12rem] text-sm bg-background"
            data-testid="signature-preview"
            dangerouslySetInnerHTML={{
              __html: state.html || "<em class='text-muted-foreground'>(signature vide)</em>",
            }}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="gap-2"
          data-testid="signature-save"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Sauvegarder
        </Button>
      </div>
    </div>
  );
}
