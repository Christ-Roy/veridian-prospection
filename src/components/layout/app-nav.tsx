"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  FolderOpen, Kanban, History, BookOpen, Settings, Clock, Menu, X, Globe, PhoneCall, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/layout/notification-bell";
import { useTrial } from "@/lib/trial-context";

const navItems = [
  { href: "/prospects", label: "Prospects", icon: FolderOpen },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/historique", label: "Historique", icon: History },
  { href: "/guide", label: "Guide", icon: BookOpen, settingKey: "show_guide" },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { daysLeft, isExpired } = useTrial();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // "Avec site" / "sans site" toggle: persist via URL param `site` on /prospects.
  // Default "all" (no filter). Values: "all" | "with" | "without".
  const currentSite = (searchParams?.get("site") as "all" | "with" | "without" | null) ?? "all";
  const onProspects = pathname === "/prospects" || pathname.startsWith("/prospects/");

  function buildProspectsHref(site: "all" | "with" | "without"): string {
    const qp = new URLSearchParams(searchParams?.toString() ?? "");
    if (site === "all") qp.delete("site"); else qp.set("site", site);
    const qs = qp.toString();
    return qs ? `/prospects?${qs}` : "/prospects";
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : {})
      .then(setSettings)
      .catch(() => {});
    fetch("/api/me")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.isAdmin) setIsAdmin(true); })
      .catch(() => {});
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return null;
  }

  const visibleItems = navItems.filter((item) => {
    if (!item.settingKey) return true;
    return settings[item.settingKey] === "true";
  });

  // Admin entry only visible to users flagged isAdmin by /api/me
  if (isAdmin) {
    visibleItems.push({
      href: "/admin/members",
      label: "Admin",
      icon: Shield,
    });
  }

  const urgent = daysLeft <= 3;

  return (
    <header className="border-b bg-white dark:bg-gray-900 dark:border-gray-800 px-4 md:px-6 py-2.5 sticky top-0 z-40">
      <div className="flex items-center justify-between">
        {/* Logo + trial badge */}
        <div className="flex items-center gap-2 md:gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">V</span>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-base font-semibold leading-tight">Prospection</h1>
            <p className="text-[11px] text-muted-foreground">Veridian</p>
          </div>
          <div className={cn(
            "ml-1 md:ml-2 inline-flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-full text-[9px] md:text-[10px] font-medium shrink-0",
            isExpired
              ? "bg-red-100 text-red-700"
              : urgent
                ? "bg-red-100 text-red-700 animate-pulse"
                : "bg-amber-100 text-amber-700"
          )}>
            <Clock className="h-2.5 w-2.5 md:h-3 md:w-3" />
            <span className="hidden sm:inline">
              {isExpired ? "Essai termine" : `Essai gratuit — ${daysLeft}j`}
            </span>
            <span className="sm:hidden">
              {isExpired ? "Expire" : `${daysLeft}j`}
            </span>
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5",
                  isActive
                    ? "font-medium text-indigo-600 bg-indigo-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}

          {/* Toggle avec site / sans site — only when on /prospects */}
          {onProspects && (
            <div className="ml-3 pl-3 border-l flex items-center gap-0.5" data-testid="site-toggle">
              <Link
                href={buildProspectsHref("all")}
                title="Tous les prospects"
                className={cn(
                  "px-2.5 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1",
                  currentSite === "all"
                    ? "font-semibold text-indigo-600 bg-indigo-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Tous
              </Link>
              <Link
                href={buildProspectsHref("with")}
                title="Prospects avec site web"
                className={cn(
                  "px-2.5 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1",
                  currentSite === "with"
                    ? "font-semibold text-emerald-700 bg-emerald-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Globe className="h-3 w-3" /> Avec site
              </Link>
              <Link
                href={buildProspectsHref("without")}
                title="Prospects sans site web (RGE, Qualiopi, etc.)"
                className={cn(
                  "px-2.5 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1",
                  currentSite === "without"
                    ? "font-semibold text-orange-700 bg-orange-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <PhoneCall className="h-3 w-3" /> Sans site
              </Link>
            </div>
          )}
        </nav>

                <NotificationBell />

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-1.5 rounded-md hover:bg-muted transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <nav className="md:hidden mt-2 pb-2 border-t pt-2 flex flex-col gap-1">
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "px-3 py-2 text-sm rounded-md transition-colors flex items-center gap-2",
                  isActive
                    ? "font-medium text-indigo-600 bg-indigo-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
