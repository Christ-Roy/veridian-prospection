"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_OPTIONS } from "@/lib/types";
import type { Lead } from "@/lib/types";
import { toast } from "sonner";
import { Star } from "lucide-react";

interface OutreachFormProps {
  lead: Lead;
  onSaved: () => void;
}

export function OutreachForm({ lead, onSaved }: OutreachFormProps) {
  const [status, setStatus] = useState(lead.outreach_status || "a_contacter");
  const [notes, setNotes] = useState(lead.outreach_notes || "");
  const [method, setMethod] = useState(lead.contact_method || "none");
  const [date, setDate] = useState(
    lead.contacted_date || new Date().toISOString().split("T")[0]
  );
  const [qualification, setQualification] = useState<number>(
    lead.qualification != null ? Math.round(lead.qualification * 100) : 0
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/outreach/${encodeURIComponent(lead.domain)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          notes,
          contact_method: method === "none" ? "" : method,
          contacted_date: date,
          qualification: qualification / 100,
        }),
      });
      if (res.ok) {
        toast.success("Suivi mis a jour");
        onSaved();
      } else {
        toast.error("Erreur de sauvegarde");
      }
    } finally {
      setSaving(false);
    }
  }

  const qualColor =
    qualification >= 70 ? "text-green-600" :
    qualification >= 40 ? "text-orange-500" :
    qualification > 0 ? "text-red-500" :
    "text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* Qualification slider */}
      <div>
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-amber-500" />
          Qualification
        </label>
        <div className="flex items-center gap-3 mt-1">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={qualification}
            onChange={(e) => setQualification(Number(e.target.value))}
            className="flex-1 h-2 accent-amber-500"
          />
          <span className={`text-sm font-bold min-w-[3ch] text-right ${qualColor}`}>
            {qualification}%
          </span>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">Statut</label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-sm font-medium">Methode</label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Choisir..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">-</SelectItem>
            <SelectItem value="phone">Telephone</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="both">Les deux</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-sm font-medium">Date de contact</label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
      </div>

      <div>
        <label className="text-sm font-medium">Notes</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes libres..."
          rows={4}
          className="mt-1"
        />
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Sauvegarde..." : "Sauvegarder"}
      </Button>
    </div>
  );
}
