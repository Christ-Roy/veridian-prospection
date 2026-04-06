"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Brain, HardDrive, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { AllSettings } from "./settings-tabs";

interface Props {
  settings: AllSettings;
  update: <K extends keyof AllSettings>(key: K, value: AllSettings[K]) => void;
}

export function SettingsAiStorage({ settings, update }: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  async function handleTestLlm() {
    setTesting(true);
    setTestResult(null);
    try {
      const baseUrl = settings.llm_base_url || undefined;
      const apiKey = settings.llm_api_key || undefined;
      const model = settings.llm_model || "glm-4.7-flash";

      // Try calling the LLM with a simple test prompt
      const url = baseUrl
        ? `${baseUrl.replace(/\/$/, "")}/chat/completions`
        : undefined;

      if (!url && !apiKey) {
        // Use env vars — test via our own API
        const res = await fetch("/api/settings/test-llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        });
        if (res.ok) {
          const data = await res.json();
          setTestResult({
            ok: true,
            message: `OK — ${data.model || model} repond correctement`,
          });
        } else {
          setTestResult({
            ok: false,
            message: "Erreur : le serveur n'a pas pu joindre le LLM",
          });
        }
      } else if (url && apiKey) {
        // Direct test from client
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Reponds juste: OK" }],
            max_tokens: 5,
          }),
        });
        if (res.ok) {
          setTestResult({ ok: true, message: `OK — ${model} repond correctement` });
        } else {
          const text = await res.text();
          setTestResult({
            ok: false,
            message: `Erreur ${res.status}: ${text.slice(0, 100)}`,
          });
        }
      } else {
        setTestResult({
          ok: false,
          message: "Renseigne l'URL et la cle API, ou laisse vide pour utiliser les env vars",
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `Erreur reseau : ${err instanceof Error ? err.message : "inconnue"}`,
      });
    }
    setTesting(false);
  }

  return (
    <div className="space-y-6">
      {/* LLM */}
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">LLM pour resumes d&apos;appels</h2>
        </div>

        <p className="text-sm text-muted-foreground">
          Utilise l&apos;API ZAI (glm-4.7-flash) pour generer des resumes d&apos;appels.
          Les cles en .env ont priorite sur les valeurs ici.
        </p>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">URL API LLM</Label>
            <Input
              placeholder="Vide = utilise ZAI_BASE_URL (.env)"
              value={settings.llm_base_url}
              onChange={(e) => update("llm_base_url", e.target.value)}
              className="h-8 text-sm font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Cle API LLM</Label>
            <Input
              type="password"
              placeholder="Vide = utilise ZAI_API_KEY (.env)"
              value={settings.llm_api_key}
              onChange={(e) => update("llm_api_key", e.target.value)}
              className="h-8 text-sm font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Modele</Label>
            <Input
              placeholder="glm-4.7-flash"
              value={settings.llm_model}
              onChange={(e) => update("llm_model", e.target.value)}
              className="h-8 text-sm font-mono w-64"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestLlm}
              disabled={testing}
              className="gap-1.5"
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Brain className="h-3.5 w-3.5" />
              )}
              Tester la connexion
            </Button>

            {testResult && (
              <div
                className={`flex items-center gap-1.5 text-xs ${
                  testResult.ok ? "text-green-600" : "text-red-600"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {testResult.message}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Stockage enregistrements */}
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Stockage des enregistrements</h2>
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          <p>Les enregistrements sont stockes chez Telnyx gratuitement pendant 1 an.</p>
          <p>Taille estimee : ~1 Mo/min en MP3.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="download_recordings"
              checked={settings.download_recordings === "true"}
              onCheckedChange={(checked) =>
                update("download_recordings", checked ? "true" : "false")
              }
              className="mt-0.5"
            />
            <div>
              <Label
                htmlFor="download_recordings"
                className="text-sm font-medium cursor-pointer"
              >
                Telecharger les enregistrements en local
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sauvegarde une copie locale en plus du stockage Telnyx.
              </p>
            </div>
          </div>

          {settings.download_recordings === "true" && (
            <div className="space-y-1.5 pl-7">
              <Label className="text-sm">Dossier local</Label>
              <Input
                value={settings.recordings_path}
                onChange={(e) => update("recordings_path", e.target.value)}
                className="h-8 text-sm font-mono"
                placeholder="/data/recordings"
              />
              <p className="text-xs text-muted-foreground">
                Chemin absolu vers le dossier de stockage des enregistrements.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
