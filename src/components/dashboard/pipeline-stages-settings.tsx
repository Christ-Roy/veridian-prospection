"use client";

/**
 * UI d'édition des stages pipeline d'un workspace.
 *
 * Pattern volontairement simple : HTML5 drag-and-drop natif (cohérent
 * avec pipeline-board.tsx qui utilise déjà la même mécanique) +
 * modales create/edit. Pas de lib externe (react-dnd, dnd-kit) pour
 * ne pas alourdir le bundle settings pour une feature admin seule.
 *
 * Sécu : si `canEdit=false`, l'UI est en lecture seule (pas de boutons
 * actifs). L'API a ses propres checks (defense in depth).
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  GripVertical,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  EyeOff,
  Flag,
} from "lucide-react";

type Stage = {
  id: string;
  slug: string;
  label: string;
  position: number;
  color: string | null;
  isTerminal: boolean;
  isHidden: boolean;
};

const COLOR_PRESETS = [
  { value: "bg-indigo-500", label: "Indigo" },
  { value: "bg-sky-500", label: "Bleu ciel" },
  { value: "bg-orange-500", label: "Orange" },
  { value: "bg-purple-500", label: "Violet" },
  { value: "bg-emerald-500", label: "Émeraude" },
  { value: "bg-teal-500", label: "Teal" },
  { value: "bg-yellow-500", label: "Jaune" },
  { value: "bg-rose-500", label: "Rose" },
  { value: "bg-red-500", label: "Rouge" },
  { value: "bg-slate-500", label: "Gris" },
];

export function PipelineStagesSettings({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editStage, setEditStage] = useState<Stage | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pipeline-stages`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setStages(Array.isArray(data.stages) ? data.stages : []);
    } catch {
      toast.error("Erreur chargement étapes");
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function persistOrder(next: Stage[]) {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/pipeline-stages/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: next.map((s) => s.id) }),
        },
      );
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Erreur réordre — rechargement");
      load();
    }
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    if (!canEdit) return;
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    if (!canEdit || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIdx(idx);
  }

  function handleDrop(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (!canEdit || !dragId) return;
    const from = stages.findIndex((s) => s.id === dragId);
    if (from === -1 || from === targetIdx) {
      setDragId(null);
      setDropIdx(null);
      return;
    }
    const next = [...stages];
    const [moved] = next.splice(from, 1);
    // Adjust target if dropping after the source position
    const adjustedTarget = from < targetIdx ? targetIdx - 1 : targetIdx;
    next.splice(adjustedTarget, 0, moved);
    setStages(next.map((s, i) => ({ ...s, position: i })));
    setDragId(null);
    setDropIdx(null);
    persistOrder(next);
  }

  async function handleDelete(stage: Stage) {
    if (
      !window.confirm(
        `Supprimer l'étape "${stage.label}" ? Cette action est irréversible.`,
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/pipeline-stages/${stage.id}`,
        { method: "DELETE" },
      );
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          data?.message ||
            "Des leads sont encore sur cette étape. Migre-les d'abord.",
        );
        return;
      }
      if (!res.ok) throw new Error();
      toast.success("Étape supprimée");
      load();
    } catch {
      toast.error("Erreur suppression");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        {stages.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            Aucune étape pour ce workspace.
          </p>
        )}

        {stages.map((stage, idx) => (
          <div
            key={stage.id}
            draggable={canEdit}
            onDragStart={(e) => handleDragStart(e, stage.id)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            onDragEnd={() => {
              setDragId(null);
              setDropIdx(null);
            }}
            className={`group flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5 transition-all ${
              dragId === stage.id ? "opacity-40" : ""
            } ${dropIdx === idx && dragId !== stage.id ? "border-primary shadow-sm" : ""}`}
          >
            {canEdit && (
              <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab shrink-0" />
            )}
            <span
              className={`h-3 w-3 rounded-full shrink-0 ${stage.color || "bg-slate-400"}`}
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{stage.label}</span>
                {stage.isTerminal && (
                  <Badge variant="outline" className="text-xs h-5 gap-1">
                    <Flag className="h-3 w-3" />
                    terminal
                  </Badge>
                )}
                {stage.isHidden && (
                  <Badge variant="outline" className="text-xs h-5 gap-1">
                    <EyeOff className="h-3 w-3" />
                    masqué
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {stage.slug}
              </span>
            </div>

            {canEdit && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditStage(stage)}
                  title="Modifier"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(stage)}
                  title="Supprimer"
                  className="text-muted-foreground hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <Button
          onClick={() => setCreateOpen(true)}
          variant="outline"
          className="gap-2"
        >
          <Plus className="h-4 w-4" /> Ajouter une étape
        </Button>
      )}

      <StageDialog
        open={createOpen}
        title="Nouvelle étape"
        stage={null}
        onClose={() => setCreateOpen(false)}
        onSave={async (data) => {
          try {
            const res = await fetch(
              `/api/workspaces/${workspaceId}/pipeline-stages`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
              },
            );
            if (!res.ok) throw new Error();
            toast.success("Étape créée");
            setCreateOpen(false);
            load();
          } catch {
            toast.error("Erreur création");
          }
        }}
      />

      <StageDialog
        open={!!editStage}
        title="Modifier l'étape"
        stage={editStage}
        onClose={() => setEditStage(null)}
        onSave={async (data) => {
          if (!editStage) return;
          try {
            const res = await fetch(
              `/api/workspaces/${workspaceId}/pipeline-stages/${editStage.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
              },
            );
            if (!res.ok) throw new Error();
            toast.success("Étape modifiée");
            setEditStage(null);
            load();
          } catch {
            toast.error("Erreur modification");
          }
        }}
      />
    </div>
  );
}

function StageDialog({
  open,
  title,
  stage,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  stage: Stage | null;
  onClose: () => void;
  onSave: (data: {
    label: string;
    color: string | null;
    isTerminal: boolean;
    isHidden: boolean;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<string>("");
  const [isTerminal, setIsTerminal] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  // Reset les champs à l'ouverture (sinon on garde l'état d'une session
  // précédente quand on ouvre la modale pour un autre stage).
  useEffect(() => {
    if (open) {
      setLabel(stage?.label || "");
      setColor(stage?.color || "");
      setIsTerminal(stage?.isTerminal || false);
      setIsHidden(stage?.isHidden || false);
    }
  }, [open, stage]);

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error("Le nom est requis");
      return;
    }
    onSave({
      label: trimmed,
      color: color || null,
      isTerminal,
      isHidden,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Nom</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: RDV planifié"
              maxLength={80}
              autoFocus
            />
          </div>

          <div>
            <Label className="text-xs">Couleur</Label>
            <div className="grid grid-cols-5 gap-1.5 mt-1.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`h-8 rounded ${c.value} ring-offset-2 transition-all ${
                    color === c.value
                      ? "ring-2 ring-foreground"
                      : "hover:ring-2 hover:ring-muted-foreground/30"
                  }`}
                  title={c.label}
                  aria-label={c.label}
                />
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="terminal"
              checked={isTerminal}
              onCheckedChange={(v) => setIsTerminal(v === true)}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="terminal" className="text-xs cursor-pointer">
                Étape terminale
              </Label>
              <span className="text-xs text-muted-foreground">
                Sort le lead du funnel actif. Ex: « client », « perdu ».
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="hidden"
              checked={isHidden}
              onCheckedChange={(v) => setIsHidden(v === true)}
            />
            <div className="grid gap-0.5">
              <Label htmlFor="hidden" className="text-xs cursor-pointer">
                Masquer du board principal
              </Label>
              <span className="text-xs text-muted-foreground">
                Reste accessible depuis l&apos;historique et les filtres.
              </span>
            </div>
          </div>

          {stage && (
            <div className="rounded border bg-muted/30 px-3 py-2">
              <Label className="text-xs text-muted-foreground">Slug (non modifiable)</Label>
              <code className="text-xs font-mono block mt-1">{stage.slug}</code>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={submit}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
