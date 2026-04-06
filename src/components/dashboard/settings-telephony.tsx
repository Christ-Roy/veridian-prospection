"use client";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Phone, Wifi, CreditCard } from "lucide-react";
import type { AllSettings } from "./settings-tabs";

interface Props {
  settings: AllSettings;
  update: <K extends keyof AllSettings>(key: K, value: AllSettings[K]) => void;
}

export function SettingsTelephony({ settings, update }: Props) {
  return (
    <div className="space-y-6">
      {/* Infos provider - lecture seule */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Provider VoIP</h2>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Provider</span>
            <p className="font-medium">Telnyx</p>
          </div>
          <div>
            <span className="text-muted-foreground">Numero</span>
            <p className="font-medium font-mono">+33 9 74 06 61 75</p>
          </div>
          <div>
            <span className="text-muted-foreground">Statut du numero</span>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                requirement-info-under-review
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Connection WebRTC</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Wifi className="h-3.5 w-3.5 text-green-500" />
              <p className="font-medium">Veridian WebRTC Softphone</p>
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Call Control App</span>
            <p className="font-medium">Veridian Dashboard</p>
          </div>
        </div>
      </Card>

      {/* Balance et tarifs */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Balance &amp; Tarifs</h2>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Balance Telnyx</span>
            <p className="font-medium text-green-600">$3.90</p>
          </div>
          <div>
            <span className="text-muted-foreground">Tarif appels FR</span>
            <p className="font-medium font-mono">~$0.005-0.008/min</p>
          </div>
          <div>
            <span className="text-muted-foreground">Enregistrement</span>
            <p className="font-medium font-mono">$0.002/min</p>
          </div>
          <div>
            <span className="text-muted-foreground">Stockage</span>
            <p className="font-medium">Gratuit 1 an</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Ces valeurs seront a terme recuperees en temps reel depuis l&apos;API Telnyx.
        </p>
      </Card>

      {/* Comportement appels */}
      <Card className="p-6 space-y-5">
        <h2 className="text-lg font-semibold">Comportement des appels</h2>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="auto_record"
              checked={settings.auto_record === "true"}
              onCheckedChange={(checked) =>
                update("auto_record", checked ? "true" : "false")
              }
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="auto_record" className="text-sm font-medium cursor-pointer">
                Enregistrer tous les appels automatiquement
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Les enregistrements sont stockes chez Telnyx (gratuit 1 an).
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="auto_ai_summary"
              checked={settings.auto_ai_summary === "true"}
              onCheckedChange={(checked) =>
                update("auto_ai_summary", checked ? "true" : "false")
              }
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="auto_ai_summary" className="text-sm font-medium cursor-pointer">
                Resume IA automatique apres chaque appel
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Utilise le LLM configure dans l&apos;onglet IA &amp; Stockage.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="auto_followup"
              checked={settings.auto_followup_no_answer === "true"}
              onCheckedChange={(checked) =>
                update("auto_followup_no_answer", checked ? "true" : "false")
              }
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="auto_followup" className="text-sm font-medium cursor-pointer">
                Creer un rappel automatique si appel sans reponse
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Un rappel sera programme automatiquement dans le pipeline.
              </p>
            </div>
          </div>

          <div className="space-y-1.5 pl-7">
            <Label className="text-sm">Delai de rappel automatique (jours)</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={settings.followup_delay_days}
              onChange={(e) => update("followup_delay_days", e.target.value)}
              className="h-8 text-sm w-24"
            />
            <p className="text-xs text-muted-foreground">
              Nombre de jours avant de rappeler un prospect sans reponse.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
