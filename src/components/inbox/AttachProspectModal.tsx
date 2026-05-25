"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";

interface ProspectCandidate {
  siren: string;
  denomination: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  leadEmailId: string | null;
  onAttached?: () => void;
}

export function AttachProspectModal({
  open,
  onClose,
  leadEmailId,
  onAttached,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ProspectCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, startSubmit] = useTransition();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (!query || query.trim().length < 2) {
        setCandidates([]);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: "1",
          pageSize: "10",
          f_search: query.trim(),
        });
        const res = await fetch(`/api/leads?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) setCandidates([]);
          return;
        }
        const json = (await res.json()) as {
          data?: Array<{ siren?: string; domain?: string; nom_entreprise?: string }>;
        };
        if (cancelled) return;
        const mapped: ProspectCandidate[] = (json.data ?? [])
          .map((row) => ({
            siren: (row.siren ?? row.domain ?? "").toString(),
            denomination: row.nom_entreprise ?? null,
          }))
          .filter((c) => /^\d{9}$/.test(c.siren));
        setCandidates(mapped);
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, open]);

  function attach(siren: string): void {
    if (!leadEmailId) return;
    startSubmit(async () => {
      try {
        const res = await fetch("/api/inbox/attach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ leadEmailId, siren }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(json.error ?? `Erreur (HTTP ${res.status})`);
          return;
        }
        toast.success("Mail rattaché au prospect");
        onAttached?.();
        onClose();
        router.refresh();
      } catch (err) {
        toast.error("Échec rattachement : " + (err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="attach-prospect-modal">
        <DialogHeader>
          <DialogTitle>Rattacher à un prospect</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom d'entreprise ou SIREN…"
              className="pl-8"
              data-testid="attach-prospect-search"
            />
          </div>

          <div className="border rounded-md max-h-72 overflow-auto" data-testid="attach-prospect-results">
            {loading && (
              <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Recherche…
              </div>
            )}
            {!loading && query.trim().length >= 2 && candidates.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Aucun prospect trouvé pour « {query} »
              </div>
            )}
            {!loading && query.trim().length < 2 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Tapez au moins 2 caractères
              </div>
            )}
            {!loading &&
              candidates.map((c) => (
                <button
                  key={c.siren}
                  type="button"
                  disabled={submitting}
                  onClick={() => attach(c.siren)}
                  data-testid={`attach-candidate-${c.siren}`}
                  className="w-full text-left px-3 py-2 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed border-b last:border-b-0 text-sm flex items-center justify-between gap-2"
                >
                  <span className="font-medium truncate">
                    {c.denomination ?? `SIREN ${c.siren}`}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono shrink-0">
                    {c.siren}
                  </span>
                </button>
              ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={submitting}
              data-testid="attach-cancel"
            >
              Annuler
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
