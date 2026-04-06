"use client";

import { PROSPECT_PRESETS, type ProspectPreset } from "@/lib/domains";

interface PresetTabsProps {
  activePresets: ProspectPreset[];
  onPresetChange: (presets: ProspectPreset[]) => void;
  counts: Record<ProspectPreset, number> | null;
}

const PRESET_ICONS: Record<ProspectPreset, string> = {
  top_prospects: "\u2605",    // filled star
  btp_artisans: "\u2692",     // hammer and pick
  sante_droit: "\u2695",      // medical
  commerce_services: "\u2302", // house/shop
  tous: "\u25CF",              // filled circle
  historique: "\u21BA",        // rotate arrow
  rge: "\u2714",               // check mark
  qualiopi: "\u2714",
  bio: "\u2714",
  epv: "\u2714",
  bni: "\u2714",
  non_identifie_avec_tel: "\u260E", // telephone
};

export function PresetTabs({ activePresets, onPresetChange, counts }: PresetTabsProps) {
  function togglePreset(presetId: ProspectPreset) {
    if (activePresets.includes(presetId)) {
      // Don't allow deselecting the last preset
      if (activePresets.length === 1) return;
      onPresetChange(activePresets.filter(p => p !== presetId));
    } else {
      onPresetChange([...activePresets, presetId]);
    }
  }

  return (
    <div className="flex items-center gap-1 px-4 py-2 bg-white border-b">
      {PROSPECT_PRESETS.map(preset => {
        const isActive = activePresets.includes(preset.id);
        const count = counts?.[preset.id] ?? 0;
        return (
          <button
            key={preset.id}
            onClick={() => togglePreset(preset.id)}
            title={preset.description}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? `${preset.activeColor} ${preset.color} border ${preset.borderColor}`
                : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
            }`}
          >
            <span className="text-xs">{PRESET_ICONS[preset.id]}</span>
            {preset.label}
            <span className={`text-[10px] tabular-nums ${isActive ? preset.color : "text-muted-foreground"}`}>
              {count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
