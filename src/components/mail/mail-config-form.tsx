"use client";

/**
 * Formulaire SMTP — page /settings/mail.
 *
 * Charge la config existante au mount, propose Save + "Tester la connexion".
 * Le password est jamais retourné par l'API — le champ est vide par défaut
 * mais l'UI indique "✓ configuré" si la DB en a un.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Plug, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MailProviderHint } from "./mail-provider-hint";
import {
  detectProvider,
  type MailProviderPreset,
} from "@/lib/mail/provider-presets";

interface MailConfigState {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  fromEmail: string;
  fromName: string;
  passwordConfigured: boolean;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestAt: string | null;
}

const DEFAULT: MailConfigState = {
  host: "",
  port: 587,
  username: "",
  password: "",
  tls: true,
  fromEmail: "",
  fromName: "",
  passwordConfigured: false,
  lastTestStatus: null,
  lastTestError: null,
  lastTestAt: null,
};

export function MailConfigForm() {
  const [config, setConfig] = useState<MailConfigState>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [provider, setProvider] = useState<MailProviderPreset | null>(null);

  // Détection au blur du champ username : auto-fill SMTP host/port/TLS
  // si domaine connu et que les champs sont vides (ou aux defaults 587).
  function handleEmailBlur() {
    const detected = detectProvider(config.username);
    setProvider(detected);
    if (!detected) return;
    setConfig((prev) => {
      const next = { ...prev };
      if (!prev.host) next.host = detected.smtp.host;
      if (!prev.port || prev.port === 587) next.port = detected.smtp.port;
      if (prev.tls !== detected.smtp.tls) next.tls = detected.smtp.tls;
      if (!prev.fromEmail) next.fromEmail = prev.username;
      return next;
    });
    toast.info(`Détection ${detected.label}, paramètres pré-remplis`);
  }

  // Reflet initial du preset si username déjà saisi (sans toast).
  useEffect(() => {
    if (!loading && config.username) {
      setProvider(detectProvider(config.username));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    fetch("/api/mail/config")
      .then((r) => r.json())
      .then((data: Partial<MailConfigState> & { fromName: string | null }) => {
        setConfig({
          host: data.host ?? "",
          port: data.port ?? 587,
          username: data.username ?? "",
          password: "",
          tls: data.tls ?? true,
          fromEmail: data.fromEmail ?? "",
          fromName: data.fromName ?? "",
          passwordConfigured: data.passwordConfigured ?? false,
          lastTestStatus: data.lastTestStatus ?? null,
          lastTestError: data.lastTestError ?? null,
          lastTestAt: data.lastTestAt ?? null,
        });
        setLoading(false);
      })
      .catch(() => {
        toast.error("Erreur de chargement de la config mail");
        setLoading(false);
      });
  }, []);

  function update<K extends keyof MailConfigState>(key: K, value: MailConfigState[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        host: config.host,
        port: Number(config.port),
        username: config.username,
        tls: config.tls,
        fromEmail: config.fromEmail,
        fromName: config.fromName || null,
      };
      if (config.password) {
        payload.password = config.password;
      }
      const res = await fetch("/api/mail/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Configuration SMTP sauvegardée");
        update("password", "");
        update("passwordConfigured", true);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Erreur de sauvegarde");
      }
    } catch (err) {
      toast.error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
    setSaving(false);
  }

  async function handleTest() {
    setTesting(true);
    try {
      const payload: Record<string, unknown> = {
        host: config.host,
        port: Number(config.port),
        username: config.username,
        tls: config.tls,
        fromEmail: config.fromEmail,
      };
      if (config.password) {
        payload.password = config.password;
      }
      const res = await fetch("/api/mail/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok: boolean;
        reason?: string;
        errorMessage?: string;
      };
      if (data.ok) {
        toast.success("Connexion SMTP réussie", {
          icon: <CheckCircle2 className="h-4 w-4" />,
        });
        update("lastTestStatus", "ok");
        update("lastTestError", null);
      } else {
        toast.error(`Échec : ${data.reason ?? "unknown"}`, {
          description: data.errorMessage?.slice(0, 200),
        });
        update("lastTestStatus", data.reason ?? "unknown");
        update("lastTestError", data.errorMessage ?? null);
      }
    } catch (err) {
      toast.error(`Erreur réseau: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTesting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold mb-1">Configuration SMTP</h2>
        <p className="text-sm text-muted-foreground">
          Envoyez vos mails depuis Veridian avec votre propre serveur SMTP.
          Votre mot de passe est chiffré (AES-256-GCM) et jamais relu.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="host">Hôte SMTP</Label>
          <Input
            id="host"
            placeholder="smtp.example.com"
            value={config.host}
            onChange={(e) => update("host", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            type="number"
            placeholder="587"
            value={config.port}
            onChange={(e) => update("port", Number(e.target.value) || 0)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            587 (STARTTLS) ou 465 (TLS direct)
          </p>
        </div>

        <div className="flex items-center gap-2 pt-6">
          <Checkbox
            id="tls"
            checked={config.tls}
            onCheckedChange={(v) => update("tls", v === true)}
          />
          <Label htmlFor="tls" className="cursor-pointer">
            Activer TLS (recommandé)
          </Label>
        </div>

        <div>
          <Label htmlFor="username">Nom d&apos;utilisateur</Label>
          <Input
            id="username"
            placeholder="user@example.com"
            value={config.username}
            onChange={(e) => update("username", e.target.value)}
            onBlur={handleEmailBlur}
            data-testid="smtp-username-input"
          />
        </div>

        <div>
          <Label htmlFor="password">
            Mot de passe
            {config.passwordConfigured && !config.password && (
              <span className="ml-2 text-xs text-green-600">✓ configuré</span>
            )}
          </Label>
          <Input
            id="password"
            type="password"
            placeholder={
              config.passwordConfigured ? "••••••••" : "Mot de passe SMTP"
            }
            value={config.password}
            onChange={(e) => update("password", e.target.value)}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Laissez vide pour conserver l&apos;actuel
          </p>
        </div>

        <div>
          <Label htmlFor="fromEmail">Adresse d&apos;expédition</Label>
          <Input
            id="fromEmail"
            type="email"
            placeholder="commercial@votresociete.fr"
            value={config.fromEmail}
            onChange={(e) => update("fromEmail", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="fromName">Nom d&apos;expéditeur</Label>
          <Input
            id="fromName"
            placeholder="Robert Brunon"
            value={config.fromName}
            onChange={(e) => update("fromName", e.target.value)}
          />
        </div>
      </div>

      <MailProviderHint provider={provider} />

      {config.lastTestStatus && (
        <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm">
          {config.lastTestStatus === "ok" ? (
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Dernier test : OK
              {config.lastTestAt && (
                <span className="text-muted-foreground ml-1">
                  ({new Date(config.lastTestAt).toLocaleString("fr-FR")})
                </span>
              )}
            </span>
          ) : (
            <div>
              <span className="flex items-center gap-1 text-red-700">
                <XCircle className="h-4 w-4" /> Dernier test : {config.lastTestStatus}
              </span>
              {config.lastTestError && (
                <p className="text-xs text-muted-foreground mt-1">
                  {config.lastTestError.slice(0, 300)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Sauvegarder
        </Button>
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !config.host}
          className="gap-2"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          Tester la connexion
        </Button>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>Anti-spam (DKIM/SPF)</strong> — pour que vos mails atterrissent
        dans les inbox plutôt que dans les spams, configurez les enregistrements
        DNS SPF et DKIM de votre domaine côté votre hébergeur. Sinon les
        serveurs Gmail/Outlook rejetteront vos envois.
      </div>
    </div>
  );
}
