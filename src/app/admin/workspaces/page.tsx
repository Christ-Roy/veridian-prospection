"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
};

export default function AdminWorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function fetchWorkspaces() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/workspaces");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as Workspace[];
      setWorkspaces(data);
    } catch (e) {
      toast.error(`Chargement échoué: ${e instanceof Error ? e.message : "?"}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  async function handleCreate() {
    if (!newName.trim()) {
      toast.error("Nom requis");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `status ${res.status}`);
      }
      toast.success("Workspace créé");
      setCreateOpen(false);
      setNewName("");
      await fetchWorkspaces();
    } catch (e) {
      toast.error(`Création échouée: ${e instanceof Error ? e.message : "?"}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Organisations / équipes qui se partagent les prospects.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ Nouveau workspace</Button>
      </div>

      <div className="bg-white rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead className="text-right">Membres</TableHead>
              <TableHead>Créé le</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-10" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                </TableRow>
              ))}
            {!loading && workspaces.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                  Aucun workspace. Créez-en un pour commencer.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              workspaces.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{w.slug}</code>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{w.memberCount}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(w.createdAt).toLocaleDateString("fr-FR")}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau workspace</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">Nom</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="ex: Paris, Équipe ventes..."
              className="mt-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Création..." : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
