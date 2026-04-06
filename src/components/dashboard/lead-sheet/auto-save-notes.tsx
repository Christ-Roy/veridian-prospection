"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface AutoSaveNotesProps {
  domain: string;
  initialNotes: string;
  onSaved?: () => void;
}

export function AutoSaveNotes({ domain, initialNotes, onSaved }: AutoSaveNotesProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialNotes);

  // Reset when domain changes
  useEffect(() => {
    setNotes(initialNotes);
    lastSavedRef.current = initialNotes;
    setSaveStatus("idle");
  }, [domain, initialNotes]);

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
        toast.error("Erreur sauvegarde notes");
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

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="space-y-1">
      <Textarea
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Notes de prospection..."
        className="min-h-[100px] text-sm"
      />
      <div className="h-4 text-right">
        {saveStatus === "saving" && (
          <span className="text-[10px] text-muted-foreground animate-pulse">Sauvegarde...</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-[10px] text-green-600">Sauvegarde</span>
        )}
      </div>
    </div>
  );
}
