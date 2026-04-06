"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  FolderOpen, Kanban, History, Settings, Shield, BarChart3,
  Search, Users, Mail, BookOpen, Moon, Sun,
} from "lucide-react";
import { useTheme } from "next-themes";

const PAGES = [
  { label: "Prospects", href: "/prospects", icon: FolderOpen, keywords: "leads entreprises" },
  { label: "Prospects avec site", href: "/prospects?site=with", icon: FolderOpen, keywords: "website domain" },
  { label: "Prospects sans site", href: "/prospects?site=without", icon: FolderOpen, keywords: "rge qualiopi phone" },
  { label: "Pipeline", href: "/pipeline", icon: Kanban, keywords: "kanban status outreach" },
  { label: "Historique", href: "/historique", icon: History, keywords: "visited recent" },
  { label: "Settings", href: "/settings", icon: Settings, keywords: "config preferences" },
  { label: "Guide", href: "/guide", icon: BookOpen, keywords: "help documentation aide" },
  { label: "Admin - Membres", href: "/admin/members", icon: Users, keywords: "team workspace" },
  { label: "Admin - KPI", href: "/admin/kpi", icon: BarChart3, keywords: "stats dashboard" },
  { label: "Admin - Invitations", href: "/admin/invitations", icon: Mail, keywords: "invite" },
  { label: "Admin - Workspaces", href: "/admin/workspaces", icon: Shield, keywords: "tenant" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Rechercher une page, un prospect..." />
      <CommandList>
        <CommandEmpty>Aucun resultat.</CommandEmpty>
        <CommandGroup heading="Pages">
          {PAGES.map(p => (
            <CommandItem key={p.href} onSelect={() => navigate(p.href)} className="cursor-pointer">
              <p.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{p.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions rapides">
          <CommandItem onSelect={() => { setOpen(false); document.querySelector<HTMLInputElement>('[placeholder*="Rechercher"]')?.focus(); }}>
            <Search className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Rechercher un prospect</span>
          </CommandItem>
          <CommandItem onSelect={() => { setTheme(theme === "dark" ? "light" : "dark"); setOpen(false); }}>
            {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            <span>{theme === "dark" ? "Mode clair" : "Mode sombre"}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
