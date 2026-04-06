"use client";

import { useEffect, useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, Loader2, Monitor, Phone, Brain, BookOpen, PhoneForwarded } from "lucide-react";
import { SettingsDisplay } from "./settings-display";
import { SettingsReference } from "./settings-reference";

// All settings keys used across tabs
export interface AllSettings {
  // Display
  page_size: string;
  default_tab: string;
  default_dept: string;
  default_size: string;
  default_min_tech_score: string;
  show_guide: string;
  // Telephony
  auto_record: string;
  auto_ai_summary: string;
  auto_followup_no_answer: string;
  followup_delay_days: string;
  // Call Routing
  call_forward_enabled: string;
  call_forward_number: string;
  call_forward_timeout: string;
  voicemail_enabled: string;
  voicemail_greeting_url: string;
  voicemail_max_duration: string;
  business_hours_start: string;
  business_hours_end: string;
  outside_hours_action: string;
  // AI & Storage
  llm_base_url: string;
  llm_api_key: string;
  llm_model: string;
  download_recordings: string;
  recordings_path: string;
}

export const DEFAULTS: AllSettings = {
  page_size: "50",
  default_tab: "top_prospects",
  default_dept: "",
  default_size: "all",
  default_min_tech_score: "0",
  show_guide: "false",
  auto_record: "true",
  auto_ai_summary: "true",
  auto_followup_no_answer: "true",
  followup_delay_days: "2",
  call_forward_enabled: "false",
  call_forward_number: "",
  call_forward_timeout: "20",
  voicemail_enabled: "false",
  voicemail_greeting_url: "",
  voicemail_max_duration: "60",
  business_hours_start: "09:00",
  business_hours_end: "19:00",
  outside_hours_action: "forward",
  llm_base_url: "",
  llm_api_key: "",
  llm_model: "glm-4.7-flash",
  download_recordings: "false",
  recordings_path: "/data/recordings",
};

export function SettingsTabs() {
  const [settings, setSettings] = useState<AllSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        const s: AllSettings = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS) as (keyof AllSettings)[]) {
          const stored = data[`settings.${key}`];
          if (stored !== undefined) s[key] = stored;
        }
        setSettings(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const update = useCallback(
    <K extends keyof AllSettings>(key: K, value: AllSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        toast.success("Settings sauvegardees");
      } else {
        toast.error("Erreur lors de la sauvegarde");
      }
    } catch {
      toast.error("Erreur reseau");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Tabs defaultValue="display">
        <TabsList className="mb-4">
          <TabsTrigger value="display" className="gap-1.5">
            <Monitor className="h-3.5 w-3.5" />
            Affichage
          </TabsTrigger>
          <TabsTrigger value="telephony" className="gap-1.5 opacity-50" onClick={(e) => { e.preventDefault(); toast("Prochainement...", { duration: 1500 }); }}>
            <Phone className="h-3.5 w-3.5" />
            Telephonie
          </TabsTrigger>
          <TabsTrigger value="call-routing" className="gap-1.5 opacity-50" onClick={(e) => { e.preventDefault(); toast("Prochainement...", { duration: 1500 }); }}>
            <PhoneForwarded className="h-3.5 w-3.5" />
            Renvoi &amp; Messagerie
          </TabsTrigger>
          <TabsTrigger value="ai-storage" className="gap-1.5 opacity-50" onClick={(e) => { e.preventDefault(); toast("Prochainement...", { duration: 1500 }); }}>
            <Brain className="h-3.5 w-3.5" />
            IA &amp; Stockage
          </TabsTrigger>
          <TabsTrigger value="reference" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Reference technique
          </TabsTrigger>
        </TabsList>

        <TabsContent value="display">
          <SettingsDisplay settings={settings} update={update} />
        </TabsContent>
        <TabsContent value="reference">
          <SettingsReference />
        </TabsContent>
      </Tabs>

      <Button onClick={handleSave} disabled={saving} className="gap-2 mt-6">
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        Sauvegarder
      </Button>
    </div>
  );
}
