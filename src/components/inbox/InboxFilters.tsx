"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Inbox, ArrowDownLeft, ArrowUpRight, Link2, Unlink, List } from "lucide-react";

type Direction = "all" | "in" | "out";
type Status = "all" | "attached" | "orphan";

interface Props {
  direction: Direction;
  status: Status;
  counts?: { total: number; orphan: number };
}

export function InboxFilters({ direction, status, counts }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function build(updates: Partial<{ direction: Direction; status: Status }>): string {
    const qp = new URLSearchParams(searchParams?.toString() ?? "");
    qp.delete("cursor");
    if (updates.direction !== undefined) {
      if (updates.direction === "all") qp.delete("direction");
      else qp.set("direction", updates.direction);
    }
    if (updates.status !== undefined) {
      if (updates.status === "all") qp.delete("status");
      else qp.set("status", updates.status);
    }
    const qs = qp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function go(updates: Partial<{ direction: Direction; status: Status }>): void {
    router.push(build(updates));
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="inbox-filters">
      <div className="inline-flex rounded-md border bg-white dark:bg-gray-900 p-0.5" data-testid="inbox-filter-direction">
        <FilterButton
          active={direction === "all"}
          onClick={() => go({ direction: "all" })}
          icon={<List className="h-3.5 w-3.5" />}
          label="Tous"
          testId="inbox-filter-direction-all"
        />
        <FilterButton
          active={direction === "in"}
          onClick={() => go({ direction: "in" })}
          icon={<ArrowDownLeft className="h-3.5 w-3.5" />}
          label="Reçus"
          testId="inbox-filter-direction-in"
        />
        <FilterButton
          active={direction === "out"}
          onClick={() => go({ direction: "out" })}
          icon={<ArrowUpRight className="h-3.5 w-3.5" />}
          label="Envoyés"
          testId="inbox-filter-direction-out"
        />
      </div>

      <div className="inline-flex rounded-md border bg-white dark:bg-gray-900 p-0.5" data-testid="inbox-filter-status">
        <FilterButton
          active={status === "all"}
          onClick={() => go({ status: "all" })}
          icon={<Inbox className="h-3.5 w-3.5" />}
          label="Tout"
          testId="inbox-filter-status-all"
          badge={counts ? String(counts.total) : undefined}
        />
        <FilterButton
          active={status === "attached"}
          onClick={() => go({ status: "attached" })}
          icon={<Link2 className="h-3.5 w-3.5" />}
          label="Rattachés"
          testId="inbox-filter-status-attached"
        />
        <FilterButton
          active={status === "orphan"}
          onClick={() => go({ status: "orphan" })}
          icon={<Unlink className="h-3.5 w-3.5" />}
          label="Non rattachés"
          testId="inbox-filter-status-orphan"
          badge={counts ? String(counts.orphan) : undefined}
        />
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  icon,
  label,
  testId,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors",
        active
          ? "bg-indigo-50 text-indigo-700 font-medium"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && (
        <span className="ml-1 px-1 rounded text-[10px] bg-gray-100 text-gray-700">
          {badge}
        </span>
      )}
    </button>
  );
}
