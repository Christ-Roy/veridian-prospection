"use client";

/**
 * Admin members table with pipeline drawer + visibility scope switch.
 *
 * Affiche tous les membres du tenant courant, leurs compteurs d'activité,
 * et permet :
 *   - de régler visibility_scope (all | own) par membre
 *   - de cliquer sur un membre pour voir son pipeline + historique dans un drawer
 */
import { useCallback, useEffect, useState } from "react";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";

type Membership = {
  workspaceId: string;
  workspaceName: string;
  role: "admin" | "member" | string;
  visibilityScope: "all" | "own" | string;
};

type Member = {
  userId: string;
  email: string;
  isOwner: boolean;
  memberships: Membership[];
  counts: {
    outreach: number;
    outreachActive: number;
    calls: number;
    claude: number;
  };
};

type PipelineGroup = {
  status: string;
  count: number;
  items: Array<{
    siren: string;
    denomination: string | null;
    updatedAt: string | null;
  }>;
};

type HistoryEvent = {
  type: "outreach" | "call" | "claude";
  siren: string;
  title: string;
  detail?: string;
  at: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  a_contacter: "À contacter",
  contacte: "Contacté",
  appele: "Appelé",
  interesse: "Intéressé",
  rdv: "RDV",
  client: "Client",
  rappeler: "À rappeler",
  relancer: "À relancer",
  archive: "Archivé",
  pas_interesse: "Pas intéressé",
};

function statusLabel(s: string) {
  return STATUS_LABELS[s] ?? s;
}

export function AdminMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerMember, setDrawerMember] = useState<Member | null>(null);
  const [pipeline, setPipeline] = useState<PipelineGroup[] | null>(null);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/members", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setMembers((data?.members ?? []) as Member[]);
    } catch (e) {
      toast.error(
        `Chargement échoué: ${e instanceof Error ? e.message : "erreur"}`
      );
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchMembers();
      setLoading(false);
    })();
  }, [fetchMembers]);

  async function updateScope(
    userId: string,
    workspaceId: string,
    scope: "all" | "own"
  ) {
    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, workspaceId, visibilityScope: scope }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success(
        `Visibilité mise à jour: ${scope === "all" ? "Tous les prospects" : "Seulement les siens"}`
      );
      await fetchMembers();
    } catch (e) {
      toast.error(
        `Échec: ${e instanceof Error ? e.message : "erreur"}`
      );
    }
  }

  async function openDrawer(member: Member) {
    setDrawerMember(member);
    setPipeline(null);
    setHistory(null);
    setDrawerLoading(true);
    try {
      const [pipeRes, histRes] = await Promise.all([
        fetch(`/api/admin/members/${member.userId}/pipeline`, {
          cache: "no-store",
        }),
        fetch(`/api/admin/members/${member.userId}/history`, {
          cache: "no-store",
        }),
      ]);
      if (pipeRes.ok) {
        const data = await pipeRes.json();
        setPipeline(data.groups ?? []);
      }
      if (histRes.ok) {
        const data = await histRes.json();
        setHistory(data.events ?? []);
      }
    } catch (e) {
      toast.error(
        `Chargement drawer: ${e instanceof Error ? e.message : "erreur"}`
      );
    } finally {
      setDrawerLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Membres</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Utilisateurs du tenant, avec leur activité et la visibilité qu&apos;ils ont.
        </p>
      </div>

      <div className="bg-white rounded-lg border" data-testid="admin-members-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead className="text-right">Outreach</TableHead>
              <TableHead className="text-right">Actif</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Claude</TableHead>
              <TableHead>Voit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-8 ml-auto" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-8 ml-auto" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-8 ml-auto" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-8 ml-auto" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-8 w-32" />
                  </TableCell>
                </TableRow>
              ))}
            {!loading && members.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-sm text-muted-foreground py-8"
                >
                  Aucun membre dans ce tenant.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              members.map((m) => {
                // Pick the "first" membership to control scope (single-workspace-aware for now)
                const primary = m.memberships[0];
                const role = primary?.role ?? (m.isOwner ? "admin" : "-");
                const currentScope = (primary?.visibilityScope ?? "all") as
                  | "all"
                  | "own";
                return (
                  <TableRow
                    key={m.userId}
                    className="cursor-pointer hover:bg-muted/50"
                    data-testid="admin-member-row"
                    onClick={(e) => {
                      // Prevent row click when clicking on the scope select
                      if ((e.target as HTMLElement).closest("[data-scope-select]")) {
                        return;
                      }
                      openDrawer(m);
                    }}
                  >
                    <TableCell className="font-medium">
                      {m.email}
                      {m.isOwner && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          owner
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={role === "admin" ? "default" : "secondary"}
                      >
                        {role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.counts.outreach}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.counts.outreachActive}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.counts.calls}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.counts.claude}
                    </TableCell>
                    <TableCell data-scope-select>
                      {primary ? (
                        <Select
                          value={currentScope}
                          onValueChange={(v) =>
                            updateScope(
                              m.userId,
                              primary.workspaceId,
                              v as "all" | "own"
                            )
                          }
                        >
                          <SelectTrigger
                            className="w-44"
                            aria-label="Visibilité du membre"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">
                              Tous les prospects
                            </SelectItem>
                            <SelectItem value="own">
                              Seulement les siens
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Owner (pas de membership)
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      <Sheet
        open={drawerMember !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDrawerMember(null);
            setPipeline(null);
            setHistory(null);
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{drawerMember?.email ?? ""}</SheetTitle>
            <SheetDescription>
              Pipeline et historique du membre
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pb-6 space-y-6" data-testid="admin-member-drawer">
            <section>
              <h3 className="text-sm font-semibold mb-2">Pipeline</h3>
              {drawerLoading && <Skeleton className="h-20 w-full" />}
              {!drawerLoading && pipeline && pipeline.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Aucun prospect assigné à ce membre.
                </p>
              )}
              {!drawerLoading && pipeline && pipeline.length > 0 && (
                <ul className="space-y-1">
                  {pipeline.map((g) => (
                    <li
                      key={g.status}
                      className="flex items-center justify-between text-sm py-1 border-b last:border-0"
                    >
                      <span>{statusLabel(g.status)}</span>
                      <Badge variant="secondary">{g.count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold mb-2">Historique</h3>
              {drawerLoading && <Skeleton className="h-20 w-full" />}
              {!drawerLoading && history && history.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Aucun événement récent.
                </p>
              )}
              {!drawerLoading && history && history.length > 0 && (
                <ul className="space-y-2">
                  {history.map((ev, i) => (
                    <li key={i} className="text-xs border-l-2 pl-2 border-muted">
                      <div className="font-medium">{ev.title}</div>
                      {ev.detail && (
                        <div className="text-muted-foreground">{ev.detail}</div>
                      )}
                      {ev.at && (
                        <div className="text-muted-foreground">
                          {new Date(ev.at).toLocaleString("fr-FR")}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
