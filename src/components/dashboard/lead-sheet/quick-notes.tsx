"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Check } from "lucide-react";
import { toast } from "sonner";

interface QuickNotesProps {
  domain: string;
  initialNotes: string;
  dirigeant?: string | null;
  onSaved?: () => void;
}

const NOTE_PRESETS = [
  { label: "A rappeler", text: (d: string | null) => `A rappeler${d ? ` (${d})` : ""} — ${new Date().toLocaleDateString("fr-FR")}` },
  { label: "Interesse", text: () => `Interesse par une refonte — ${new Date().toLocaleDateString("fr-FR")}` },
  { label: "Pas interesse", text: () => `Pas interesse pour le moment` },
  { label: "Pas joignable", text: () => `Pas joignable — ${new Date().toLocaleDateString("fr-FR")}` },
  { label: "Devis envoye", text: (d: string | null) => `Devis envoye${d ? ` a ${d}` : ""} — ${new Date().toLocaleDateString("fr-FR")}` },
  { label: "RDV planifie", text: () => `RDV planifie — ` },
];

export function QuickNotes({ domain, initialNotes, dirigeant, onSaved }: QuickNotesProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [open, setOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialNotes);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasNotes = !!(notes && notes.trim());

  // Reset when domain changes
  useEffect(() => {
    setNotes(initialNotes);
    lastSavedRef.current = initialNotes;
    setSaveStatus("idle");
  }, [domain, initialNotes]);

  // Auto-focus textarea when popover opens
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  const saveNotes = useCallback(async (value: string) => {
    if (value === lastSavedRef.current) return;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/outreach/${encodeURIComponent(domain)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value }),
      });
      if (res.ok) {
        lastSavedRef.current = value;
        setSaveStatus("saved");
        onSaved?.();
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("idle");
        toast.error("Erreur sauvegarde");
      }
    } catch {
      setSaveStatus("idle");
      toast.error("Erreur reseau");
    }
  }, [domain, onSaved]);

  function handleChange(value: string) {
    setNotes(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => saveNotes(value), 500);
  }

  function insertPreset(text: string) {
    const newNotes = notes ? notes + "\n" + text : text;
    handleChange(newNotes);
    // Move cursor to end
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newNotes.length;
        textareaRef.current.selectionEnd = newNotes.length;
        textareaRef.current.focus();
      }
    }, 10);
  }

  // Save on close if changed
  function handleOpenChange(isOpen: boolean) {
    if (!isOpen && notes !== lastSavedRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      saveNotes(notes);
    }
    setOpen(isOpen);
  }

  // Cleanup
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant={hasNotes ? "default" : "outline"}
          className={`h-10 px-3 gap-1.5 text-xs font-medium ${hasNotes ? "bg-rose-600 hover:bg-rose-700 text-white" : ""}`}
        >
          <MessageSquare className="h-4 w-4" />
          Note
          {hasNotes && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" side="bottom" align="end">
        <div className="space-y-2">
          {/* Presets */}
          <div className="flex flex-wrap gap-1">
            {NOTE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => insertPreset(preset.text(dirigeant ?? null))}
                className="text-[10px] px-2 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Textarea */}
          <Textarea
            ref={textareaRef}
            value={notes}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Notes de prospection..."
            className="min-h-[120px] text-sm resize-none"
          />

          {/* Save status */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              Auto-save
            </span>
            <span className="text-[10px]">
              {saveStatus === "saving" && <span className="text-muted-foreground animate-pulse">Sauvegarde...</span>}
              {saveStatus === "saved" && <span className="text-green-600 flex items-center gap-0.5"><Check className="h-3 w-3" /> OK</span>}
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
