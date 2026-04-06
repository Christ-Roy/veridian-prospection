"use client";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhoneForwarded, Voicemail, Clock } from "lucide-react";
import type { AllSettings } from "./settings-tabs";

interface Props {
  settings: AllSettings;
  update: <K extends keyof AllSettings>(key: K, value: AllSettings[K]) => void;
}

export function SettingsCallRouting({ settings, update }: Props) {
  return (
    <div className="space-y-6">
      {/* Renvoi d'appel */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <PhoneForwarded className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Renvoi d&apos;appel</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="call_forward_enabled"
              checked={settings.call_forward_enabled === "true"}
              onCheckedChange={(checked) =>
                update("call_forward_enabled", checked ? "true" : "false")
              }
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="call_forward_enabled" className="text-sm font-medium cursor-pointer">
                Activer le renvoi d&apos;appel
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quand le softphone est hors ligne, les appels sont renvoyes vers le mobile.
              </p>
            </div>
          </div>

          <div className="space-y-1.5 pl-7">
            <Label className="text-sm">Numero de renvoi</Label>
            <Input
              type="tel"
              placeholder="+33 6 12 34 56 78"
              value={settings.call_forward_number}
              onChange={(e) => update("call_forward_number", e.target.value)}
              className="h-8 text-sm w-56 font-mono"
              disabled={settings.call_forward_enabled !== "true"}
            />
          </div>

          <div className="space-y-1.5 pl-7">
            <Label className="text-sm">Delai avant renvoi (secondes)</Label>
            <Input
              type="number"
              min={5}
              max={60}
              value={settings.call_forward_timeout}
              onChange={(e) => update("call_forward_timeout", e.target.value)}
              className="h-8 text-sm w-24"
              disabled={settings.call_forward_enabled !== "true"}
            />
            <p className="text-xs text-muted-foreground">
              Temps d&apos;attente avant de renvoyer l&apos;appel.
            </p>
          </div>
        </div>
      </Card>

      {/* Messagerie vocale */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Voicemail className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Messagerie vocale</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="voicemail_enabled"
              checked={settings.voicemail_enabled === "true"}
              onCheckedChange={(checked) =>
                update("voicemail_enabled", checked ? "true" : "false")
              }
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="voicemail_enabled" className="text-sm font-medium cursor-pointer">
                Activer la messagerie vocale
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Si le renvoi echoue ou est desactive, les appelants peuvent laisser un message.
              </p>
            </div>
          </div>

          <div className="space-y-1.5 pl-7">
            <Label className="text-sm">URL du message d&apos;accueil (MP3)</Label>
            <Input
              type="url"
              placeholder="https://example.com/greeting.mp3"
              value={settings.voicemail_greeting_url}
              onChange={(e) => update("voicemail_greeting_url", e.target.value)}
              className="h-8 text-sm"
              disabled={settings.voicemail_enabled !== "true"}
            />
            <p className="text-xs text-muted-foreground">
              Fichier audio joue avant l&apos;enregistrement. Laisser vide = bip direct.
            </p>
          </div>

          <div className="space-y-1.5 pl-7">
            <Label className="text-sm">Duree max du message (secondes)</Label>
            <Input
              type="number"
              min={10}
              max={300}
              value={settings.voicemail_max_duration}
              onChange={(e) => update("voicemail_max_duration", e.target.value)}
              className="h-8 text-sm w-24"
              disabled={settings.voicemail_enabled !== "true"}
            />
          </div>
        </div>
      </Card>

      {/* Horaires de bureau */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Horaires de bureau</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Debut</Label>
            <Input
              type="time"
              value={settings.business_hours_start}
              onChange={(e) => update("business_hours_start", e.target.value)}
              className="h-8 text-sm w-32"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Fin</Label>
            <Input
              type="time"
              value={settings.business_hours_end}
              onChange={(e) => update("business_hours_end", e.target.value)}
              className="h-8 text-sm w-32"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Hors horaires de bureau</Label>
          <Select
            value={settings.outside_hours_action}
            onValueChange={(v) => update("outside_hours_action", v)}
          >
            <SelectTrigger className="w-56 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="forward">Renvoyer vers le mobile</SelectItem>
              <SelectItem value="voicemail">Messagerie vocale</SelectItem>
              <SelectItem value="reject">Rejeter l&apos;appel</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Action a effectuer quand un appel arrive en dehors des horaires.
          </p>
        </div>
      </Card>
    </div>
  );
}
