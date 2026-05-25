"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Link2, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AttachProspectModal } from "./AttachProspectModal";

export interface InboxClientItem {
  id: string;
  direction: string;
  siren: string | null;
  entrepriseName: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  subject: string | null;
  bodyPreview: string | null;
  occurredAt: string;
  sentStatus: string;
}

interface Props {
  items: InboxClientItem[];
  nextCursor: string | null;
}

const SUBJECT_TRUNCATE = 80;
const PREVIEW_TRUNCATE = 120;

function truncate(input: string | null, max: number): string {
  if (!input) return "";
  return input.length > max ? input.slice(0, max - 1) + "…" : input;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function InboxList({ items, nextCursor }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [attaching, setAttaching] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function loadMore(): void {
    if (!nextCursor) return;
    const qp = new URLSearchParams(searchParams?.toString() ?? "");
    qp.set("cursor", nextCursor);
    startTransition(() => {
      router.push(`/inbox?${qp.toString()}`);
    });
  }

  if (items.length === 0) {
    return (
      <div
        className="border rounded-lg bg-white py-16 text-center text-muted-foreground"
        data-testid="inbox-empty"
      >
        <p className="text-lg font-medium">Aucun mail dans la boîte</p>
        <p className="text-sm">
          Les mails envoyés depuis les fiches prospects et les mails reçus en
          IMAP apparaîtront ici.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="border rounded-lg bg-white overflow-hidden" data-testid="inbox-list">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="w-10 px-2 py-2"></th>
              <th className="px-2 py-2">De / Vers</th>
              <th className="px-2 py-2">Sujet</th>
              <th className="px-2 py-2 hidden md:table-cell">Prospect</th>
              <th className="px-2 py-2 text-right whitespace-nowrap">Date</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isIncoming = item.direction === "incoming";
              const counterpart = isIncoming
                ? item.fromEmail
                : item.toEmails[0] ?? item.fromEmail;
              return (
                <tr
                  key={item.id}
                  data-testid={`inbox-row-${item.id}`}
                  data-direction={item.direction}
                  data-attached={item.siren ? "yes" : "no"}
                  className="border-t hover:bg-muted/30"
                >
                  <td className="px-2 py-2 align-top">
                    <span
                      title={isIncoming ? "Reçu" : "Envoyé"}
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full",
                        isIncoming
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-indigo-50 text-indigo-700",
                      )}
                    >
                      {isIncoming ? (
                        <ArrowDownLeft className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2 align-top max-w-[220px]">
                    <div className="font-medium truncate" title={counterpart}>
                      {item.fromName ?? counterpart}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {counterpart}
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div className="font-medium truncate" title={item.subject ?? undefined}>
                      {truncate(item.subject, SUBJECT_TRUNCATE) || (
                        <span className="text-muted-foreground italic">
                          (sans sujet)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {truncate(item.bodyPreview, PREVIEW_TRUNCATE) || (
                        <span className="italic">(sans contenu)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top hidden md:table-cell">
                    {item.siren ? (
                      <Link
                        href={`/leads/${item.siren}`}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:underline text-xs"
                        data-testid={`inbox-attached-${item.id}`}
                      >
                        <Link2 className="h-3 w-3" />
                        <span className="truncate max-w-[160px]">
                          {item.entrepriseName ?? `SIREN ${item.siren}`}
                        </span>
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="bg-amber-50 text-amber-700 border-amber-200"
                          data-testid={`inbox-orphan-${item.id}`}
                        >
                          <Unlink className="h-3 w-3 mr-1" />
                          Non rattaché
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAttaching(item.id)}
                          data-testid={`inbox-attach-btn-${item.id}`}
                          className="h-6 px-2 text-xs"
                        >
                          Rattacher
                        </Button>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top text-right text-xs text-muted-foreground whitespace-nowrap">
                    {formatDate(item.occurredAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="flex justify-center py-3">
          <Button
            variant="outline"
            onClick={loadMore}
            data-testid="inbox-load-more"
          >
            Charger plus
          </Button>
        </div>
      )}

      <AttachProspectModal
        open={attaching !== null}
        onClose={() => setAttaching(null)}
        leadEmailId={attaching}
        onAttached={() => {
          /* router.refresh() est déjà appelé dans la modale */
        }}
      />
    </>
  );
}
