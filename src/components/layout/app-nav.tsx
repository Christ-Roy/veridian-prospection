"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  FolderOpen, Kanban, History, BookOpen, Settings, Clock, Menu, X, Globe, PhoneCall, Shield, List, LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/layout/notification-bell";
import { LeadsBalanceBadge } from "@/components/dashboard/leads-balance-badge";
import { useTrial } from "@/lib/trial-context";

const navItems = [
  { href: "/prospects", label: "Prospects", icon: FolderOpen },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/historique", label: "Historique", icon: History },
  { href: "/guide", label: "Guide", icon: BookOpen, settingKey: "show_guide" },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNav({ initialIsAdmin = false }: { initialIsAdmin?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { daysLeft, isExpired } = useTrial();
  const { data: session } = useSession();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isAdmin, setIsAdmin] = useState(initialIsAdmin);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Logout : signOut Auth.js + redirect login. Le bouton est exposé dans la
  // nav (desktop + mobile) — sinon l'utilisateur n'a aucun moyen visible de
  // changer de compte (ex : démo, machine partagée, switch tenant via Hub).
  async function handleSignOut() {
    await signOut({ callbackUrl: "/login", redirect: true });
  }

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
                title={label}
                className={cn(
                  "px-2 lg:px-3 py-2 min-h-[36px] text-sm rounded-md transition-colors flex items-center gap-1 lg:gap-1.5",
                  isActive
                    ? "font-medium text-indigo-600 bg-indigo-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {/* Labels masqués entre md et lg (icônes seules) pour que la
                    nav tienne dans le viewport tablette ; reviennent à lg. */}
                <span className="hidden lg:inline">{label}</span>
              </Link>
            );
          })}

          {/* Toggle avec site / sans site — only when on /prospects.
              Entre md et lg, les libellés sont masqués (icônes seules) pour
              que le header tienne dans le viewport tablette ; les labels
              reviennent à lg où il y a la place. */}
          {onProspects && (
            <div className="ml-2 pl-2 lg:ml-3 lg:pl-3 border-l flex items-center gap-0.5" data-testid="site-toggle">
              <Link
                href={buildProspectsHref("all")}
                title="Tous les prospects"
                data-testid="site-toggle-all"
                className={cn(
                  "px-2 lg:px-2.5 py-2 min-h-[36px] text-xs rounded-md transition-colors flex items-center gap-1",
                  currentSite === "all"
                    ? "font-semibold text-indigo-600 bg-indigo-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <List className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden lg:inline">Tous</span>
              </Link>
              <Link
                href={buildProspectsHref("with")}
                title="Prospects avec site web"
                data-testid="site-toggle-with"
                className={cn(
                  "px-2 lg:px-2.5 py-2 min-h-[36px] text-xs rounded-md transition-colors flex items-center gap-1",
                  currentSite === "with"
                    ? "font-semibold text-emerald-700 bg-emerald-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden lg:inline">Avec site</span>
              </Link>
              <Link
                href={buildProspectsHref("without")}
                title="Prospects sans site web (RGE, Qualiopi, etc.)"
                data-testid="site-toggle-without"
                className={cn(
                  "px-2 lg:px-2.5 py-2 min-h-[36px] text-xs rounded-md transition-colors flex items-center gap-1",
                  currentSite === "without"
                    ? "font-semibold text-orange-700 bg-orange-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <PhoneCall className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden lg:inline">Sans site</span>
              </Link>
            </div>
          )}
        </nav>

        {/* Solde leads — perma-visible (decision Robert 2026-05-22). Cliquable
            → /settings/leads pour acheter. Mobile : visible aussi à côté du
            burger. */}
        <LeadsBalanceBadge className="hidden sm:inline-flex" />

                <NotificationBell />

        {/* Logout (desktop seulement — mobile l'a dans le burger) */}
        {session?.user && (
          <button
            type="button"
            onClick={handleSignOut}
            title={`Se déconnecter (${session.user.email ?? ""})`}
            aria-label="Se déconnecter"
            className="hidden md:inline-flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}

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

          {/* Toggle avec/sans site — sur /prospects uniquement. La nav
              desktop l'expose en barre de segments ; en mobile il est
              inaccessible sans cette section, le filtre par site serait
              perdu sur téléphone. */}
          {onProspects && (
            <div className="mt-1 pt-2 border-t flex flex-col gap-1" data-testid="site-toggle-mobile">
              <span className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Filtrer par site
              </span>
              <Link
                href={buildProspectsHref("all")}
                data-testid="site-toggle-mobile-all"
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2 text-sm rounded-md transition-colors flex items-center gap-2",
                  currentSite === "all"
                    ? "font-medium text-indigo-600 bg-indigo-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <List className="h-4 w-4" />
                Tous les prospects
              </Link>
              <Link
                href={buildProspectsHref("with")}
                data-testid="site-toggle-mobile-with"
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2 text-sm rounded-md transition-colors flex items-center gap-2",
                  currentSite === "with"
                    ? "font-medium text-emerald-700 bg-emerald-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Globe className="h-4 w-4" />
                Avec site
              </Link>
              <Link
                href={buildProspectsHref("without")}
                data-testid="site-toggle-mobile-without"
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "px-3 py-2 text-sm rounded-md transition-colors flex items-center gap-2",
                  currentSite === "without"
                    ? "font-medium text-orange-700 bg-orange-50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <PhoneCall className="h-4 w-4" />
                Sans site
              </Link>
            </div>
          )}

          {/* Solde leads — section dédiée burger mobile (le badge desktop est
              hors-écran ici). Lien direct vers /settings/leads. */}
          <div className="mt-1 pt-2 border-t flex flex-col gap-1">
            <span className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Solde leads
            </span>
            <Link
              href="/settings/leads"
              data-testid="nav-mobile-leads-link"
              onClick={() => setMobileOpen(false)}
              className="px-3 py-2 text-sm rounded-md transition-colors flex items-center justify-between gap-2 hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Mes leads
              </span>
              <LeadsBalanceBadge />
            </Link>
          </div>

          {/* Logout — toujours visible en bas du burger mobile, avec email
              affiché pour identifier le compte courant. */}
          {session?.user && (
            <div className="mt-1 pt-2 border-t flex flex-col gap-1">
              {session.user.email && (
                <span className="px-3 pb-0.5 text-[11px] text-muted-foreground truncate">
                  Connecté : {session.user.email}
                </span>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                className="px-3 py-2 text-sm rounded-md transition-colors flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-left"
              >
                <LogOut className="h-4 w-4" />
                Se déconnecter
              </button>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
