"use client";

/**
 * Formulaire IMAP — page /settings/mail onglet "IMAP (réception)".
 *
 * Charge la config existante au mount, propose Save + "Tester la connexion"
 * + "Désactiver IMAP". Password jamais retourné par l'API — vide par défaut
 * mais l'UI indique "✓ configuré" si la DB en a un.
 *
 * Affiche le statut du dernier sync cron (imap_last_sync_at/status/error).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Plug, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface ImapConfigState {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  folder: string;
  passwordConfigured: boolean;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncAt: string | null;
  lastUidSeen: number | null;
}

const DEFAULT: ImapConfigState = {
  host: "",
  port: 993,
  username: "",
  password: "",
  tls: true,
  folder: "INBOX",
  passwordConfigured: false,
  lastSyncStatus: null,
  lastSyncError: null,
  lastSyncAt: null,
  lastUidSeen: null,
};

export function ImapConfigForm() {
  const [config, setConfig] = useState<ImapConfigState>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    fetch("/api/mail/imap-config")
      .then((r) => r.json())
      .then((data: Partial<ImapConfigState>) => {
        setConfig({
          host: data.host ?? "",
          port: data.port ?? 993,
          username: data.username ?? "",
          password: "",
          tls: data.tls ?? true,
          folder: data.folder ?? "INBOX",
          passwordConfigured: data.passwordConfigured ?? false,
          lastSyncStatus: data.lastSyncStatus ?? null,
          lastSyncError: data.lastSyncError ?? null,
          lastSyncAt: data.lastSyncAt ?? null,
          lastUidSeen: data.lastUidSeen ?? null,
        });
        setLoading(false);
      })
      .catch(() => {
        toast.error("Erreur de chargement de la config IMAP");
        setLoading(false);
      });
  }, []);

  function update<K extends keyof ImapConfigState>(key: K, value: ImapConfigState[K]) {
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
        folder: config.folder,
      };
      if (config.password) payload.password = config.password;
      const res = await fetch("/api/mail/imap-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Configuration IMAP sauvegardée");
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
        folder: config.folder,
      };
      if (config.password) payload.password = config.password;
      const res = await fetch("/api/mail/test-imap-connection", {
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
        toast.success("Connexion IMAP réussie", {
          icon: <CheckCircle2 className="h-4 w-4" />,
        });
        update("lastSyncStatus", "ok");
        update("lastSyncError", null);
      } else {
        toast.error(`Échec : ${data.reason ?? "unknown"}`, {
          description: data.errorMessage?.slice(0, 200),
        });
        update("lastSyncStatus", data.reason ?? "unknown");
        update("lastSyncError", data.errorMessage ?? null);
      }
    } catch (err) {
      toast.error(`Erreur réseau: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTesting(false);
  }

  async function handleClear() {
    if (!confirm("Désactiver la réception IMAP ? Les credentials seront effacés et le cron arrêtera de fetcher.")) {
      return;
    }
    setClearing(true);
    try {
      const res = await fetch("/api/mail/imap-config", { method: "DELETE" });
      if (res.ok) {
        toast.success("Réception IMAP désactivée");
        setConfig(DEFAULT);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Erreur");
      }
    } catch (err) {
      toast.error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
    setClearing(false);
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
        <h2 className="text-lg font-semibold mb-1">Réception IMAP (cron 5 min)</h2>
        <p className="text-sm text-muted-foreground">
          Veridian récupère vos mails entrants toutes les 5 minutes via votre
          serveur IMAP. Les mails matchant un prospect (par email) apparaissent
          dans sa timeline 360°. Mot de passe chiffré AES-256-GCM, jamais relu.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="imap-host">Hôte IMAP</Label>
          <Input
            id="imap-host"
            placeholder="imap.example.com"
            value={config.host}
            onChange={(e) => update("host", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="imap-port">Port</Label>
          <Input
            id="imap-port"
            type="number"
            placeholder="993"
            value={config.port}
            onChange={(e) => update("port", Number(e.target.value) || 0)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            993 (TLS direct) ou 143 (STARTTLS)
          </p>
        </div>

        <div className="flex items-center gap-2 pt-6">
          <Checkbox
            id="imap-tls"
            checked={config.tls}
            onCheckedChange={(v) => update("tls", v === true)}
          />
          <Label htmlFor="imap-tls" className="cursor-pointer">
            Activer TLS (recommandé)
          </Label>
        </div>

        <div>
          <Label htmlFor="imap-username">Nom d&apos;utilisateur</Label>
          <Input
            id="imap-username"
            placeholder="user@example.com"
            value={config.username}
            onChange={(e) => update("username", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="imap-password">
            Mot de passe
            {config.passwordConfigured && !config.password && (
              <span className="ml-2 text-xs text-green-600">✓ configuré</span>
            )}
          </Label>
          <Input
            id="imap-password"
            type="password"
            placeholder={
              config.passwordConfigured ? "••••••••" : "Mot de passe IMAP"
            }
            value={config.password}
            onChange={(e) => update("password", e.target.value)}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Laissez vide pour conserver l&apos;actuel
          </p>
        </div>

        <div className="col-span-2">
          <Label htmlFor="imap-folder">Dossier à scanner</Label>
          <Input
            id="imap-folder"
            placeholder="INBOX"
            value={config.folder}
            onChange={(e) => update("folder", e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Par défaut INBOX. Utiliser un dossier dédié si vous voulez scoper la lecture.
          </p>
        </div>
      </div>

      {config.lastSyncStatus && (
        <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm">
          {config.lastSyncStatus === "ok" ? (
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Dernier sync : OK
              {config.lastSyncAt && (
                <span className="text-muted-foreground ml-1">
                  ({new Date(config.lastSyncAt).toLocaleString("fr-FR")})
                </span>
              )}
              {config.lastUidSeen !== null && (
                <span className="text-muted-foreground ml-1">
                  · dernier UID : {config.lastUidSeen}
                </span>
              )}
            </span>
          ) : (
            <div>
              <span className="flex items-center gap-1 text-red-700">
                <XCircle className="h-4 w-4" /> Dernier sync : {config.lastSyncStatus}
              </span>
              {config.lastSyncError && (
                <p className="text-xs text-muted-foreground mt-1">
                  {config.lastSyncError.slice(0, 300)}
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
        {config.passwordConfigured && (
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={clearing}
            className="gap-2 ml-auto text-red-700 hover:text-red-800"
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Désactiver IMAP
          </Button>
        )}
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        <strong>Latence</strong> — les mails entrants apparaissent dans Veridian
        avec un délai max de 5 minutes (polling cron). Le match au prospect
        utilise l&apos;adresse email de la fiche entreprise.
      </div>
    </div>
  );
}
