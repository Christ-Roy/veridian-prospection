"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Invitation = {
  id: string;
  email: string;
  role: string;
  workspaceId: string | null;
  workspaceName: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  inviteUrl?: string | null;
};

type Workspace = {
  id: string;
  name: string;
  slug: string;
};

type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

function computeStatus(inv: Invitation): InviteStatus {
  if (inv.revokedAt) return "revoked";
  if (inv.acceptedAt) return "accepted";
  if (new Date(inv.expiresAt).getTime() < Date.now()) return "expired";
  return "pending";
}

function statusBadge(status: InviteStatus) {
  const map: Record<InviteStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "En attente", variant: "default" },
    accepted: { label: "Acceptée", variant: "secondary" },
    expired: { label: "Expirée", variant: "outline" },
    revoked: { label: "Révoquée", variant: "destructive" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function AdminInvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newWorkspaceId, setNewWorkspaceId] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [creating, setCreating] = useState(false);

  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null);
  const [revoking, setRevoking] = useState(false);

  const fetchInvitations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/invitations");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as Invitation[] | { invitations: Invitation[] };
      const list = Array.isArray(data) ? data : data.invitations;
      setInvitations(list || []);
    } catch (e) {
      console.error("[admin/invitations] fetch failed", e);
      toast.error(`Chargement échoué: ${e instanceof Error ? e.message : "?"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  async function openCreateDialog() {
    setDialogOpen(true);
    if (workspaces.length === 0) {
      try {
        const res = await fetch("/api/admin/workspaces");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as Workspace[];
        setWorkspaces(data);
        if (data.length > 0 && !newWorkspaceId) {
          setNewWorkspaceId(data[0].id);
        }
      } catch (e) {
        toast.error(`Workspaces: ${e instanceof Error ? e.message : "?"}`);
      }
    }
  }

  async function handleCreate() {
    if (!newEmail.trim() || !newEmail.includes("@")) {
      toast.error("Email invalide");
      return;
    }
    if (!newWorkspaceId) {
      toast.error("Workspace requis");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          workspaceId: newWorkspaceId,
          role: newRole,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        inviteUrl?: string;
        emailSent?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error || `status ${res.status}`);
      }
      toast.success("Invitation créée");
      if (body.emailSent === false) {
        toast.warning("Email non envoyé, copiez le lien manuellement");
      }
      setCreatedLink(body.inviteUrl || null);
      setLinkDialogOpen(!!body.inviteUrl);
      setDialogOpen(false);
      setNewEmail("");
      setNewRole("member");
      await fetchInvitations();
    } catch (e) {
      toast.error(`Création échouée: ${e instanceof Error ? e.message : "?"}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié");
    } catch {
      toast.error("Copie impossible");
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/admin/invitations/${revokeTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `status ${res.status}`);
      }
      toast.success("Invitation révoquée");
      setRevokeTarget(null);
      await fetchInvitations();
    } catch (e) {
      toast.error(`Révocation échouée: ${e instanceof Error ? e.message : "?"}`);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Invitations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invitez des utilisateurs à rejoindre un workspace.
          </p>
        </div>
        <Button onClick={openCreateDialog}>+ Nouvelle invitation</Button>
      </div>

      <div className="bg-white rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Créée le</TableHead>
              <TableHead>Expire le</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                </TableRow>
              ))}
            {!loading && invitations.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-sm text-muted-foreground py-8"
                >
                  Aucune invitation, cliquez &laquo; Nouvelle invitation &raquo; pour commencer.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              invitations.map((inv) => {
                const status = computeStatus(inv);
                const canAct = status === "pending";
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>{inv.workspaceName || "—"}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                        {inv.role}
                      </code>
                    </TableCell>
                    <TableCell>{statusBadge(status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(inv.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(inv.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {canAct && inv.inviteUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(inv.inviteUrl!)}
                        >
                          Copier
                        </Button>
                      )}
                      {canAct && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setRevokeTarget(inv)}
                        >
                          Révoquer
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle invitation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium" htmlFor="inv-email">
                Email
              </label>
              <Input
                id="inv-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="invite@exemple.com"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="inv-workspace">
                Workspace
              </label>
              <Select value={newWorkspaceId} onValueChange={setNewWorkspaceId}>
                <SelectTrigger id="inv-workspace" className="mt-1">
                  <SelectValue placeholder="Sélectionner un workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="inv-role">
                Rôle
              </label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="inv-role" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Membre</SelectItem>
                  <SelectItem value="admin">Administrateur</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Envoi..." : "Envoyer l'invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link created dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lien d&apos;invitation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Copiez ce lien et envoyez-le à votre invité si l&apos;email ne passe pas.
            </p>
            <Input value={createdLink || ""} readOnly className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLinkDialogOpen(false)}
            >
              Fermer
            </Button>
            <Button
              onClick={() => createdLink && handleCopy(createdLink)}
              disabled={!createdLink}
            >
              Copier le lien
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Révoquer l&apos;invitation ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            L&apos;invitation envoyée à{" "}
            <span className="font-medium">{revokeTarget?.email}</span> ne sera plus utilisable.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={revoking}>
              {revoking ? "Révocation..." : "Révoquer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
