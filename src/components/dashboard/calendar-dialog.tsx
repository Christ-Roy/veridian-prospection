"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CalendarPlus, CalendarIcon, Clock, ExternalLink, Bell } from "lucide-react";
import { format, addMinutes, addDays, setHours, setMinutes } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type EventType = "rdv" | "rappel";

interface CalendarDialogProps {
  lead: {
    domain: string;
    nom_entreprise: string;
    dirigeant: string | null;
    phone: string | null;
    email: string | null;
    dirigeant_email: string | null;
    ville: string | null;
  };
  defaultType?: EventType;
}

const TIME_SLOTS = generateTimeSlots();
const DURATION_OPTIONS_RDV = [
  { value: "30", label: "30 min" },
  { value: "60", label: "1h" },
  { value: "90", label: "1h30" },
  { value: "120", label: "2h" },
];
const DURATION_OPTIONS_RAPPEL = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
];

const RAPPEL_PRESETS = [
  { label: "Demain", days: 1 },
  { label: "Dans 3 jours", days: 3 },
  { label: "Dans 1 semaine", days: 7 },
  { label: "Dans 2 semaines", days: 14 },
];

function generateTimeSlots(): { value: string; label: string }[] {
  const slots: { value: string; label: string }[] = [];
  for (let h = 8; h <= 19; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 19 && m > 0) break;
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      slots.push({ value: `${hh}:${mm}`, label: `${hh}:${mm}` });
    }
  }
  return slots;
}

function buildDefaultNotes(lead: CalendarDialogProps["lead"], type: EventType): string {
  const lines: string[] = [];
  lines.push(`Entreprise : ${lead.nom_entreprise || lead.domain}`);
  lines.push(`Site : ${lead.domain}`);
  if (lead.dirigeant) lines.push(`Contact : ${lead.dirigeant}`);
  if (lead.phone) lines.push(`Tel : ${lead.phone}`);
  const email = lead.dirigeant_email || lead.email;
  if (email) lines.push(`Email : ${email}`);
  if (lead.ville) lines.push(`Ville : ${lead.ville}`);
  lines.push("");
  lines.push(type === "rdv" ? "Objet : discussion refonte site web" : "Rappel : relancer ce prospect");
  return lines.join("\n");
}

function formatGCalDate(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}${mo}${d}T${h}${mi}00`;
}

function buildGoogleCalendarUrl(params: {
  title: string;
  start: Date;
  end: Date;
  details: string;
  location: string;
}): string {
  const base = "https://calendar.google.com/calendar/render";
  const searchParams = new URLSearchParams({
    action: "TEMPLATE",
    text: params.title,
    dates: `${formatGCalDate(params.start)}/${formatGCalDate(params.end)}`,
    details: params.details,
    location: params.location,
  });
  return `${base}?${searchParams.toString()}`;
}

export function CalendarDialog({ lead, defaultType }: CalendarDialogProps) {
  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState<EventType>(defaultType || "rdv");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("60");
  const [notes, setNotes] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen) {
      const type = defaultType || "rdv";
      setEventType(type);
      setDate(undefined);
      setTime(type === "rappel" ? "09:00" : "10:00");
      setDuration(type === "rappel" ? "15" : "60");
      setNotes(buildDefaultNotes(lead, type));
    }
  }

  function handleTypeChange(type: EventType) {
    setEventType(type);
    setTime(type === "rappel" ? "09:00" : "10:00");
    setDuration(type === "rappel" ? "15" : "60");
    setNotes(buildDefaultNotes(lead, type));
    setDate(undefined);
  }

  function handlePreset(days: number) {
    setDate(addDays(new Date(), days));
  }

  function handleCreate() {
    if (!date) {
      toast.error("Veuillez selectionner une date");
      return;
    }

    const [hours, minutes] = time.split(":").map(Number);
    const start = setMinutes(setHours(date, hours), minutes);
    const end = addMinutes(start, parseInt(duration, 10));

    const prefix = eventType === "rappel" ? "Rappel" : "RDV";
    const title = `${prefix} ${lead.nom_entreprise || lead.domain}`;
    const location = eventType === "rdv" ? (lead.ville || "") : "";

    const url = buildGoogleCalendarUrl({
      title,
      start,
      end,
      details: notes,
      location,
    });

    window.open(url, "_blank", "noopener,noreferrer");
    toast.success(`Google Calendar ouvert — ${prefix}`);
    setOpen(false);
  }

  const isRappel = eventType === "rappel";
  const durationOptions = isRappel ? DURATION_OPTIONS_RAPPEL : DURATION_OPTIONS_RDV;
  const isValid = !!date;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {defaultType === "rappel" ? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Bell className="h-4 w-4" />
            Rappel
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5">
            <CalendarPlus className="h-4 w-4" />
            Planifier
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRappel ? <Bell className="h-5 w-5" /> : <CalendarPlus className="h-5 w-5" />}
            {isRappel ? "Planifier un rappel" : "Planifier un rendez-vous"}
          </DialogTitle>
          <DialogDescription>
            {lead.nom_entreprise || lead.domain}
            {lead.dirigeant ? ` — ${lead.dirigeant}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Type toggle */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={!isRappel ? "default" : "outline"}
              onClick={() => handleTypeChange("rdv")}
              className="flex-1 gap-1.5"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Rendez-vous
            </Button>
            <Button
              size="sm"
              variant={isRappel ? "default" : "outline"}
              onClick={() => handleTypeChange("rappel")}
              className="flex-1 gap-1.5"
            >
              <Bell className="h-3.5 w-3.5" />
              Rappel
            </Button>
          </div>

          {/* Quick presets for rappel */}
          {isRappel && (
            <div className="flex flex-wrap gap-2">
              {RAPPEL_PRESETS.map((p) => (
                <Button
                  key={p.days}
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => handlePreset(p.days)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}

          {/* Date picker */}
          <div>
            <label className="text-sm font-medium">Date</label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "mt-1 w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date
                    ? format(date, "EEEE d MMMM yyyy", { locale: fr })
                    : "Choisir une date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    setDate(d);
                    setCalendarOpen(false);
                  }}
                  disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  locale={fr}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Time and Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Heure
              </label>
              <Select value={time} onValueChange={setTime}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot.value} value={slot.value}>
                      {slot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Duree</label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {durationOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={isRappel ? 4 : 6}
              className="mt-1 text-xs"
              placeholder={isRappel ? "Motif du rappel..." : "Contexte du rendez-vous..."}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={!isValid} className="gap-1.5">
            <ExternalLink className="h-4 w-4" />
            {isRappel ? "Creer le rappel" : "Creer le RDV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
