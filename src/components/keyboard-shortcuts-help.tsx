"use client";

/**
 * KeyboardShortcutsHelp — modale affichée quand l'utilisateur appuie sur "?".
 * Liste les raccourcis globaux disponibles dans le dashboard + active la
 * navigation par sequence "g + <touche>" (vim-style).
 *
 * Mounted dans src/app/layout.tsx pour être actif sur toutes les pages.
 *
 * Installé dans le cadre de C10 UX polish (session 2026-04-05).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

type Shortcut = { keys: string[]; label: string };

const SHORTCUTS: Shortcut[] = [
  { keys: ["?"], label: "Afficher cette aide" },
  { keys: ["g", "p"], label: "Aller à /prospects" },
  { keys: ["g", "s"], label: "Aller à /segments" },
  { keys: ["g", "h"], label: "Aller à /historique" },
  { keys: ["g", "k"], label: "Aller à /pipeline (kanban)" },
  { keys: ["g", "a"], label: "Aller à /admin/workspaces" },
  { keys: ["Esc"], label: "Fermer cette aide" },
];

// Navigation sequences g+<key>
const G_NAV_MAP: Record<string, string> = {
  p: "/prospects",
  s: "/segments",
  h: "/historique",
  k: "/pipeline",
  a: "/admin/workspaces",
};
const G_SEQUENCE_WINDOW_MS = 1500;

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Timestamp of the last "g" press — if a nav key is pressed within the
  // window, navigate. Uses a ref to avoid re-renders on every keystroke.
  const lastGPressRef = useRef<number>(0);

  useKeyboardShortcuts({
    "?": () => setOpen(true),
    g: () => {
      lastGPressRef.current = Date.now();
    },
  });

  // Handle the "g + X" follow-up key (separate listener to avoid fighting
  // with the main hook which only binds single keys and chords).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore if in an input
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      // Ignore modifiers
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Only trigger if "g" was pressed recently
      const elapsed = Date.now() - lastGPressRef.current;
      if (elapsed > G_SEQUENCE_WINDOW_MS || lastGPressRef.current === 0) return;

      const key = (e.key || "").toLowerCase();
      if (key === "g") return; // Don't loop on double-g
      const target_path = G_NAV_MAP[key];
      if (target_path) {
        e.preventDefault();
        lastGPressRef.current = 0;
        router.push(target_path);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="px-2 py-0.5 rounded border bg-gray-100 text-xs font-mono"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-4 border-t">
            Les raccourcis simples sont désactivés quand vous tapez dans un champ de
            saisie. Les raccourcis avec <kbd className="px-1 rounded border bg-gray-100">Cmd</kbd>/<kbd className="px-1 rounded border bg-gray-100">Ctrl</kbd> fonctionnent partout.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
