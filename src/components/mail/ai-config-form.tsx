"use client";

/**
 * Formulaire IA — page /settings/mail onglet "IA".
 *
 * Admin only (l'API GET retourne 403 sinon). BYO clé API par tenant.
 * La clé n'est JAMAIS retournée par /api/mail/ai-config — le champ est
 * vide par défaut, l'UI affiche "✓ configurée" si la DB en a une.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Plug,
  Trash2,
  Sparkles,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_MODELS,
  AI_PROVIDERS,
  type AiProvider,
} from "@/lib/ai/models";

interface AiConfigState {
  provider: AiProvider | "";
  model: string;
  apiKey: string;
  defaultLocale: "fr" | "en";
  apiKeyConfigured: boolean;
  lastUsedAt: string | null;
  totalTokensIn: number;
  totalTokensOut: number;
}

const DEFAULT: AiConfigState = {
  provider: "",
  model: "",
  apiKey: "",
  defaultLocale: "fr",
  apiKeyConfigured: false,
  lastUsedAt: null,
  totalTokensIn: 0,
  totalTokensOut: 0,
};

export function AiConfigForm() {
  const [config, setConfig] = useState<AiConfigState>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Models disponibles selon le provider choisi.
  const modelChoices = useMemo(() => {
    if (!config.provider) return [];
    return AI_MODELS[config.provider as AiProvider] ?? [];
  }, [config.provider]);

  useEffect(() => {
    fetch("/api/mail/ai-config")
      .then(async (r) => {
        if (r.status === 403) {
          setForbidden(true);
          setLoading(false);
          return null;
        }
        return r.json();
      })
      .then((data: Partial<AiConfigState> | null) => {
        if (!data) return;
        setConfig({
          provider: (data.provider as AiProvider) ?? "",
          model: data.model ?? "",
          apiKey: "",
          defaultLocale: (data.defaultLocale as "fr" | "en") ?? "fr",
          apiKeyConfigured: data.apiKeyConfigured ?? false,
          lastUsedAt: data.lastUsedAt ?? null,
          totalTokensIn: data.totalTokensIn ?? 0,
          totalTokensOut: data.totalTokensOut ?? 0,
        });
        setLoading(false);
      })
      .catch(() => {
        toast.error("Erreur de chargement de la config IA");
        setLoading(false);
      });
  }, []);

  function update<K extends keyof AiConfigState>(key: K, value: AiConfigState[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function handleProviderChange(p: string) {
    update("provider", p as AiProvider);
    // Reset model — pas garanti que l'ancien soit valide pour le nouveau provider.
    const first = AI_MODELS[p as AiProvider]?.[0]?.id ?? "";
    update("model", first);
  }

  async function handleSave() {
    if (!config.provider || !config.model) {
      toast.error("Choisis un provider et un modèle");
      return;
    }
    if (!config.apiKey && !config.apiKeyConfigured) {
      toast.error("Une clé API est requise pour activer l'IA");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        provider: config.provider,
        model: config.model,
        defaultLocale: config.defaultLocale,
      };
      if (config.apiKey) payload.apiKey = config.apiKey;
      const res = await fetch("/api/mail/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Configuration IA sauvegardée");
        update("apiKey", "");
        update("apiKeyConfigured", true);
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
    if (!config.apiKeyConfigured) {
      toast.error("Sauvegarde d'abord la config (Save) avant de tester");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/mail/ai-config/test", { method: "POST" });
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean;
        message?: string;
        error?: string;
        reason?: string;
      };
      if (res.ok && data.ok) {
        setTestResult({ ok: true, message: data.message ?? "Test OK" });
        toast.success("Connexion IA validée");
      } else {
        const msg = `${data.reason ?? "error"}: ${data.error ?? "unknown"}`;
        setTestResult({ ok: false, message: msg });
        toast.error(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, message: msg });
      toast.error(`Erreur: ${msg}`);
    }
    setTesting(false);
  }

  async function handleDelete() {
    if (!confirm("Supprimer la configuration IA ? Le bouton ✨ Rédige avec IA ne marchera plus tant que tu n'auras pas reconfiguré.")) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/mail/ai-config", { method: "DELETE" });
      if (res.ok) {
        toast.success("Configuration IA supprimée");
        setConfig(DEFAULT);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Erreur de suppression");
      }
    } catch (err) {
      toast.error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
    setDeleting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Réservé aux admins du tenant. Demande à l&apos;owner de configurer
        la clé API IA depuis cette page.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
        <Sparkles className="inline h-4 w-4 mr-1" />
        BYO : tu fournis ta propre clé API. Veridian ne facture pas
        l&apos;usage IA — le coût est porté par ton compte Anthropic /
        OpenAI / Mistral / OpenRouter. La clé est chiffrée AES-256-GCM
        en base et n&apos;est JAMAIS renvoyée par l&apos;API.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ai-provider">Provider</Label>
          <Select value={config.provider} onValueChange={handleProviderChange}>
            <SelectTrigger id="ai-provider">
              <SelectValue placeholder="Choisir un provider" />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="ai-model">Modèle</Label>
          <Select
            value={config.model}
            onValueChange={(v) => update("model", v)}
            disabled={!config.provider}
          >
            <SelectTrigger id="ai-model">
              <SelectValue placeholder="Choisir un modèle" />
            </SelectTrigger>
            <SelectContent>
              {modelChoices.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {config.model && modelChoices.find((m) => m.id === config.model)?.hint && (
            <p className="text-xs text-muted-foreground mt-1">
              {modelChoices.find((m) => m.id === config.model)?.hint}
            </p>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="ai-api-key">
          Clé API{" "}
          {config.apiKeyConfigured && (
            <span className="text-xs text-emerald-600 font-medium">
              ✓ configurée (laisser vide pour conserver)
            </span>
          )}
        </Label>
        <Input
          id="ai-api-key"
          type="password"
          value={config.apiKey}
          onChange={(e) => update("apiKey", e.target.value)}
          placeholder={config.apiKeyConfigured ? "•••••••••••••• (déjà stockée)" : "sk-..."}
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ai-locale">Langue par défaut</Label>
          <Select
            value={config.defaultLocale}
            onValueChange={(v) => update("defaultLocale", v as "fr" | "en")}
          >
            <SelectTrigger id="ai-locale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fr">Français</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(config.lastUsedAt || config.totalTokensIn > 0) && (
          <div className="text-xs text-muted-foreground self-end pb-2">
            <div>Dernier appel : {config.lastUsedAt ? new Date(config.lastUsedAt).toLocaleString() : "jamais"}</div>
            <div>Tokens cumulés : {config.totalTokensIn} in / {config.totalTokensOut} out</div>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Sauvegarder
        </Button>
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !config.apiKeyConfigured}
          className="gap-2"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          Tester
        </Button>
        {config.apiKeyConfigured && (
          <Button
            variant="ghost"
            onClick={handleDelete}
            disabled={deleting}
            className="gap-2 text-destructive ml-auto"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Supprimer
          </Button>
        )}
      </div>

      {testResult && (
        <div
          className={
            testResult.ok
              ? "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              : "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
          }
        >
          {testResult.ok ? (
            <CheckCircle2 className="inline h-4 w-4 mr-1" />
          ) : (
            <XCircle className="inline h-4 w-4 mr-1" />
          )}
          <strong>{testResult.ok ? "Réponse LLM :" : "Erreur :"}</strong>{" "}
          {testResult.message}
        </div>
      )}
    </div>
  );
}
