import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TrialGate } from "@/components/layout/trial-gate";
import { requireUser, getWorkspaceFilter } from "@/lib/auth/user-context";
import {
  listInboxEmails,
  type InboxDirection,
  type InboxStatus,
} from "@/lib/queries/inbox";
import { InboxFilters } from "@/components/inbox/InboxFilters";
import { InboxList } from "@/components/inbox/InboxList";

export const dynamic = "force-dynamic";

interface SearchParams {
  direction?: string;
  status?: string;
  cursor?: string;
}

function parseDirection(v: string | undefined): InboxDirection {
  if (v === "in" || v === "out") return v;
  return "all";
}

function parseStatus(v: string | undefined): InboxStatus {
  if (v === "attached" || v === "orphan") return v;
  return "all";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const auth = await requireUser();
  if ("error" in auth) {
    // requireUser ne crash pas, mais en server component on doit rediriger
    redirect("/login");
  }

  const sp = await searchParams;
  const direction = parseDirection(sp.direction);
  const status = parseStatus(sp.status);
  const cursor = sp.cursor ?? null;

  const workspaceFilter = getWorkspaceFilter(auth.ctx);

  const result = await listInboxEmails({
    tenantId: auth.ctx.tenantId,
    workspaceFilter,
    direction,
    status,
    cursor,
    limit: 50,
  });

  const items = result.items.map((item) => ({
    ...item,
    occurredAt: item.occurredAt.toISOString(),
  }));

  return (
    <TrialGate>
      <div className="min-h-screen">
        <main className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Inbox</h2>
              <Badge variant="secondary" data-testid="inbox-count">
                {items.length}
                {result.nextCursor ? "+" : ""}
              </Badge>
            </div>
            <InboxFilters direction={direction} status={status} />
          </div>

          <p className="text-sm text-muted-foreground">
            Tous les mails envoyés et reçus du tenant. Les mails sans prospect
            rattaché peuvent être associés à une entreprise pour enrichir la
            timeline 360°.
          </p>

          <InboxList items={items} nextCursor={result.nextCursor} />
        </main>
      </div>
    </TrialGate>
  );
}
