"use client";

/**
 * Gestionnaire de templates mail custom — onglet "Templates" de /settings/mail.
 *
 * Cf ticket follow-ups §A + migration 0029.
 *
 * Liste les templates customs, permet d'en créer / éditer / supprimer.
 * Les templates fallback (hardcodés) ne sont pas listés ici — ils restent
 * dispo dans le dropdown compose tant qu'aucun custom ne shadow leur slug.
 *
 * Admin only — l'UI s'affiche quand même mais le backend renvoie 403.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Save, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface TemplateRow {
  id: string;
  slug: string;
  label: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

interface EditState {
  open: boolean;
  template: TemplateRow | null;
  slug: string;
  label: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

const EMPTY_EDIT: EditState = {
  open: false,
  template: null,
  slug: "",
  label: "",
  subject: "",
  bodyText: "",
  bodyHtml: "",
};

export function MailTemplatesManager() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/mail-templates");
      if (!res.ok) {
        if (res.status === 403) {
          toast.error("Réservé aux administrateurs");
        }
        setTemplates([]);
      } else {
        const data = (await res.json()) as { templates: TemplateRow[] };
        setTemplates(data.templates);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function openNew() {
    setEdit({
      open: true,
      template: null,
      slug: "",
      label: "",
      subject: "",
      bodyText:
        "Bonjour {{ prospect.name }},\n\n" +
        "[message libre]\n\n" +
        "Cordialement,\n{{ sender.name }}",
      bodyHtml: "",
    });
  }

  function openEdit(tpl: TemplateRow) {
    setEdit({
      open: true,
      template: tpl,
      slug: tpl.slug,
      label: tpl.label,
      subject: tpl.subject,
      bodyText: tpl.bodyText,
      bodyHtml: tpl.bodyHtml,
    });
  }

  async function handleSave() {
    setSaving(true);
    const body = {
      slug: edit.slug.trim(),
      label: edit.label.trim(),
      subject: edit.subject,
      bodyText: edit.bodyText,
      bodyHtml: edit.bodyHtml || `<p>${edit.bodyText.replace(/\n/g, "<br>")}</p>`,
    };
    try {
      const url = edit.template
        ? `/api/admin/mail-templates/${edit.template.id}`
        : "/api/admin/mail-templates";
      const method = edit.template ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 409) {
          toast.error("Ce slug existe déjà — choisis-en un autre");
        } else {
          toast.error(data.error ?? `Échec (${res.status})`);
        }
      } else {
        toast.success(edit.template ? "Template mis à jour" : "Template créé");
        setEdit(EMPTY_EDIT);
        void refresh();
      }
    } catch (err) {
      toast.error(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
    }
    setSaving(false);
  }

  async function handleDelete(tpl: TemplateRow) {
    if (!confirm(`Supprimer le template « ${tpl.label} » ?`)) return;
    const res = await fetch(`/api/admin/mail-templates/${tpl.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Échec suppression");
    } else {
      toast.success("Template supprimé");
      void refresh();
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Templates mail customs</h2>
            <p className="text-xs text-muted-foreground">
              Les templates customs s&apos;affichent dans le dropdown
              &quot;Choisir un template&quot; à l&apos;envoi. Les templates
              système Veridian restent dispo en fallback.
            </p>
          </div>
        </div>
        <Button onClick={openNew} className="gap-2" data-testid="template-new">
          <Plus className="h-4 w-4" /> Nouveau template
        </Button>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : templates.length === 0 ? (
        <div className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
          Aucun template custom. Les 2 templates système Veridian
          (&quot;Relance commerciale&quot;, &quot;Proposition de démo&quot;)
          restent dispo dans le dropdown compose.
        </div>
      ) : (
        <ul className="border rounded-md divide-y" data-testid="template-list">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              className="px-4 py-3 flex items-center justify-between gap-3"
              data-testid={`template-row-${tpl.slug}`}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{tpl.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  <code>{tpl.slug}</code> — {tpl.subject}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(tpl)}
                  className="gap-1"
                  data-testid={`template-edit-${tpl.slug}`}
                >
                  <Pencil className="h-3.5 w-3.5" /> Éditer
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(tpl)}
                  className="gap-1 text-red-600 hover:text-red-700"
                  data-testid={`template-delete-${tpl.slug}`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={edit.open}
        onOpenChange={(o) => (o ? null : setEdit(EMPTY_EDIT))}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {edit.template ? "Éditer le template" : "Nouveau template"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="tpl-slug">Slug technique</Label>
                <Input
                  id="tpl-slug"
                  value={edit.slug}
                  onChange={(e) =>
                    setEdit((s) => ({ ...s, slug: e.target.value }))
                  }
                  placeholder="ma-relance-personnalisee"
                  disabled={!!edit.template}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  lowercase, alphanumérique, -/_ — non modifiable après création.
                </p>
              </div>
              <div>
                <Label htmlFor="tpl-label">Libellé UI</Label>
                <Input
                  id="tpl-label"
                  value={edit.label}
                  onChange={(e) =>
                    setEdit((s) => ({ ...s, label: e.target.value }))
                  }
                  placeholder="Ma relance personnalisée"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="tpl-subject">Sujet</Label>
              <Input
                id="tpl-subject"
                value={edit.subject}
                onChange={(e) =>
                  setEdit((s) => ({ ...s, subject: e.target.value }))
                }
                placeholder="Suite à notre échange — {{ prospect.entreprise }}"
              />
            </div>

            <div>
              <Label htmlFor="tpl-body">Corps (text)</Label>
              <Textarea
                id="tpl-body"
                value={edit.bodyText}
                onChange={(e) =>
                  setEdit((s) => ({ ...s, bodyText: e.target.value }))
                }
                rows={8}
                placeholder="Bonjour {{ prospect.name }}..."
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Variables : {"{{ prospect.name }}"}, {"{{ prospect.entreprise }}"},
                {" {{ sender.name }}"}, {"{{ sender.email }}"}.
              </p>
            </div>

            <div>
              <Label htmlFor="tpl-html">Corps (HTML, optionnel)</Label>
              <Textarea
                id="tpl-html"
                value={edit.bodyHtml}
                onChange={(e) =>
                  setEdit((s) => ({ ...s, bodyHtml: e.target.value }))
                }
                rows={5}
                placeholder="<p>Bonjour {{ prospect.name }}</p>..."
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Si vide, le corps text est converti en HTML simple.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEdit(EMPTY_EDIT)}
              disabled={saving}
              className="gap-2"
            >
              <X className="h-4 w-4" /> Annuler
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                !edit.slug.trim() ||
                !edit.label.trim() ||
                !edit.subject ||
                !edit.bodyText
              }
              className="gap-2"
              data-testid="template-save"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {edit.template ? "Mettre à jour" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
