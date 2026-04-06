"use client";

/**
 * useKeyboardShortcuts — generic hook that binds window keydown listeners
 * to named callbacks.
 *
 * Usage:
 *   useKeyboardShortcuts({
 *     j: () => navigateNextRow(),
 *     k: () => navigatePrevRow(),
 *     o: () => openCurrentRow(),
 *     e: () => editStatus(),
 *     "?": () => setHelpOpen(true),
 *     "cmd+k": () => openCommandPalette(),
 *   });
 *
 * Règles de no-fire pour éviter de piéger les utilisateurs qui écrivent:
 *  - Ne déclenche PAS si le focus est dans <input>, <textarea>, <select>,
 *    ou tout élément contentEditable (exception pour les chords cmd+* / ctrl+*
 *    qui sont toujours actifs).
 *  - Ne déclenche PAS si une modifier key est pressée sans faire partie du
 *    binding (ex: shift+j n'active pas "j" tout seul).
 *
 * Format des clés:
 *  - Simple: "j", "k", "o", "?", "/"
 *  - Chord: "cmd+k", "ctrl+s", "alt+enter", "shift+?"
 *    - "cmd" est mappé sur metaKey (macOS) ET ctrlKey (Linux/Windows) pour
 *      une expérience cross-OS cohérente.
 */
import { useEffect, useRef } from "react";

export type KeyHandler = (e: KeyboardEvent) => void;
export type ShortcutMap = Record<string, KeyHandler>;

function isTypingElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().trim();
}

function matchesBinding(binding: string, e: KeyboardEvent): boolean {
  const parts = normalizeKey(binding).split("+").map((p) => p.trim());
  const key = parts.pop()!;
  const mods = new Set(parts);

  // Check the main key (case-insensitive, with fallback on e.code for special chars)
  const eKey = (e.key || "").toLowerCase();
  if (eKey !== key) {
    // Allow mapping "?" when shift+/ is pressed on US-like layouts
    if (!(key === "?" && eKey === "?")) return false;
  }

  // "cmd" matches either metaKey (macOS) or ctrlKey (Linux/Windows)
  const wantsCmd = mods.has("cmd") || mods.has("meta");
  const wantsCtrl = mods.has("ctrl");
  const wantsAlt = mods.has("alt") || mods.has("option");
  const wantsShift = mods.has("shift");

  if (wantsCmd && !(e.metaKey || e.ctrlKey)) return false;
  if (wantsCtrl && !e.ctrlKey) return false;
  if (wantsAlt && !e.altKey) return false;
  if (wantsShift && !e.shiftKey) return false;

  // If binding has NO modifiers, refuse if any modifier is pressed (except shift
  // for printable characters where shift is part of the key itself, e.g. "?")
  if (!wantsCmd && !wantsCtrl && !wantsAlt) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
  }

  return true;
}

/**
 * Hook component: bind the shortcuts for the lifetime of the mounting component.
 * Safe to call with a changing map — the latest map is always used (via ref).
 */
export function useKeyboardShortcuts(
  shortcuts: ShortcutMap,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  const mapRef = useRef<ShortcutMap>(shortcuts);

  // Keep the ref in sync with the latest map
  useEffect(() => {
    mapRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      const map = mapRef.current;
      // First check chord shortcuts (they should fire even inside inputs)
      for (const [binding, handler] of Object.entries(map)) {
        const isChord = binding.includes("+");
        if (!isChord) continue;
        if (matchesBinding(binding, e)) {
          handler(e);
          return;
        }
      }
      // Then single-key shortcuts — only if not typing
      if (isTypingElement(e.target)) return;
      for (const [binding, handler] of Object.entries(map)) {
        const isChord = binding.includes("+");
        if (isChord) continue;
        if (matchesBinding(binding, e)) {
          handler(e);
          return;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
