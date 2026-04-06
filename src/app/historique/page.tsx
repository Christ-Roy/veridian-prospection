"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { LeadSheet } from "@/components/dashboard/lead-sheet";
import { formatTimeAgo } from "@/lib/types";
import type { Lead } from "@/lib/types";
import {
  History, Phone, Mail, MapPin, User,
} from "lucide-react";
import { TrialGate } from "@/components/layout/trial-gate";

export default function HistoriquePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  const fetchHistory = useCallback(() => {
    setLoading(true);
    fetch("/api/history")
      .then((r) => r.json())
      .then((data) => { setLeads(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <TrialGate>
    <div className="min-h-screen">
      <main className="px-6 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Fiches consultées</h2>
            {!loading && <Badge variant="secondary">{leads.length}</Badge>}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">Aucune fiche consultée</p>
            <p className="text-sm">Les fiches que vous ouvrez apparaîtront ici, triées par date de consultation.</p>
          </div>
        ) : (
          <div className="border rounded-lg bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Entreprise</TableHead>
                  <TableHead>Domaine</TableHead>
                  <TableHead>Dirigeant</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Ville</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Consulté</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow
                    key={lead.domain}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedDomain(lead.domain)}
                  >
                    <TableCell className="font-medium">
                      {lead.nom_entreprise || lead.web_domain || `SIREN ${lead.domain}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {lead.web_domain ?? <span className="font-mono text-xs">SIREN {lead.domain}</span>}
                    </TableCell>
                    <TableCell>
                      {lead.dirigeant && lead.dirigeant.trim() ? (
                        <span className="flex items-center gap-1 text-sm">
                          <User className="h-3 w-3 text-muted-foreground" />
                          {lead.dirigeant}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {lead.phone && (
                          <span title={lead.phone}>
                            <Phone className="h-3.5 w-3.5 text-green-600" />
                          </span>
                        )}
                        {(lead.dirigeant_email || lead.email) && (
                          <span title={lead.dirigeant_email || lead.email || ""}>
                            <Mail className="h-3.5 w-3.5 text-blue-600" />
                          </span>
                        )}
                        {!lead.phone && !lead.dirigeant_email && !lead.email && (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {lead.ville ? (
                        <span className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {lead.ville}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={lead.outreach_status} />
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                      {lead.last_visited ? formatTimeAgo(lead.last_visited) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <LeadSheet
        domain={selectedDomain}
        onClose={() => {
          setSelectedDomain(null);
          fetchHistory();
        }}
        onUpdated={fetchHistory}
      />
    </div>
    </TrialGate>
  );
}
