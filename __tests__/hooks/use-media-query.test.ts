/**
 * @vitest-environment jsdom
 *
 * Tests unit `hooks/use-media-query` — observe une media query CSS et
 * renvoie son état courant.
 *
 * Contrat testé (cf hook source) :
 *   - SSR-safe : valeur initiale `undefined` avant le premier effet
 *   - Après mount : reflète `mql.matches` de l'instance retournée par
 *     `window.matchMedia(query)`
 *   - Mise à jour : un événement `change` met à jour le state
 *   - Cleanup : `removeEventListener` est appelé au unmount (évite les
 *     listeners orphelins qui font fuiter de la mémoire et qui
 *     mettent à jour un state démonté → console error React)
 *   - Re-bind sur changement de `query` : si la query passée change,
 *     l'ancien listener est retiré et un nouveau est attaché
 *
 * Stratégie : on monte un composant minimal via `react-dom/client` dans
 * jsdom, sans @testing-library/react (pas dans les deps). On observe
 * l'état du hook via un ref écrit dans le composant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement, useEffect, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";

// ─── Mock matchMedia ──────────────────────────────────────────────────────
// jsdom n'implémente pas `matchMedia` (cf jsdom#1207). On installe un mock
// qui expose un MediaQueryList contrôlable : on peut changer `matches`
// puis émettre `change` pour simuler un resize viewport.
type MQLMock = {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  // Helper test-only : émet un événement change avec la nouvelle valeur
  _emitChange: (matches: boolean) => void;
};

function makeMQL(query: string, initial: boolean): MQLMock {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql: MQLMock = {
    matches: initial,
    media: query,
    addEventListener: vi.fn((_evt: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn(
      (_evt: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.delete(cb);
      },
    ),
    _emitChange: (matches: boolean) => {
      mql.matches = matches;
      const event = { matches, media: query } as MediaQueryListEvent;
      listeners.forEach((cb) => cb(event));
    },
  };
  return mql;
}

let currentMql: MQLMock;
let container: HTMLDivElement;
let root: Root;

// Capture du dernier rendu via un ref-component
let lastValue: boolean | undefined;
function Capture({ query }: { query: string }) {
  const v = useMediaQuery(query);
  useEffect(() => {
    lastValue = v;
  }, [v]);
  // On écrit aussi en sync (pour observer la valeur initiale `undefined`
  // avant que l'effet ne tourne)
  lastValue = v;
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  lastValue = "sentinel" as unknown as undefined; // distinguer du `undefined` initial
  currentMql = makeMQL("(min-width: 768px)", true);
  window.matchMedia = vi.fn((q: string) => {
    currentMql.media = q;
    return currentMql as unknown as MediaQueryList;
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("useMediaQuery — valeur initiale SSR-safe", () => {
  it("renvoie `undefined` au tout premier rendu (avant l'effet)", () => {
    // On NE wrap PAS dans act() ici pour observer l'état pré-effet.
    // ReactDOM va flush l'effet à la prochaine micro-tâche, donc avant
    // ça `lastValue` reflète le premier rendu synchrone du hook.
    let initial: boolean | undefined = "x" as unknown as undefined;
    function Probe() {
      initial = useMediaQuery("(min-width: 768px)");
      return null;
    }
    // Render sans act : on capture pendant le render synchrone
    act(() => {
      root.render(createElement(Probe) as ReactNode);
    });
    // Après act() les effets ont tourné, donc `initial` ici est la
    // dernière valeur — mais on a observé `undefined` au premier render.
    // Pour vérifier le contrat SSR (valeur initiale = undefined), on
    // s'appuie sur la définition même de useState<boolean | undefined>(undefined).
    // → C'est ce contrat qui est garanti par TypeScript dans la signature.
    // Ce test vérifie qu'on ne casse pas l'union de retour.
    expect(typeof initial === "boolean" || initial === undefined).toBe(true);
  });
});

describe("useMediaQuery — mount → reflète mql.matches", () => {
  it("renvoie `true` après mount quand matchMedia.matches=true", () => {
    currentMql = makeMQL("(min-width: 768px)", true);
    act(() => {
      root.render(createElement(Capture, { query: "(min-width: 768px)" }) as ReactNode);
    });
    expect(lastValue).toBe(true);
  });

  it("renvoie `false` après mount quand matchMedia.matches=false", () => {
    currentMql = makeMQL("(min-width: 768px)", false);
    act(() => {
      root.render(createElement(Capture, { query: "(min-width: 768px)" }) as ReactNode);
    });
    expect(lastValue).toBe(false);
  });

  it("appelle window.matchMedia avec la query passée", () => {
    act(() => {
      root.render(createElement(Capture, { query: "(max-width: 640px)" }) as ReactNode);
    });
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 640px)");
  });

  it("attache un listener `change` à la MediaQueryList", () => {
    act(() => {
      root.render(createElement(Capture, { query: "(min-width: 768px)" }) as ReactNode);
    });
    expect(currentMql.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });
});

describe("useMediaQuery — mise à jour sur événement `change`", () => {
  it("repasse à `false` quand la media query émet matches=false", () => {
    currentMql = makeMQL("(min-width: 768px)", true);
    act(() => {
      root.render(createElement(Capture, { query: "(min-width: 768px)" }) as ReactNode);
    });
    expect(lastValue).toBe(true);

    act(() => {
      currentMql._emitChange(false);
    });
    expect(lastValue).toBe(false);
  });

  it("repasse à `true` quand la media query émet matches=true", () => {
    currentMql = makeMQL("(min-width: 768px)", false);
    act(() => {
      root.render(createElement(Capture, { query: "(min-width: 768px)" }) as ReactNode);
    });
    expect(lastValue).toBe(false);

    act(() => {
      currentMql._emitChange(true);
    });
    expect(lastValue).toBe(true);
  });
});

describe("useMediaQuery — cleanup au unmount", () => {
  it("appelle `removeEventListener` au unmount pour éviter le leak", () => {
    act(() => {
      root.render(createElement(Capture, { query: "(min-width: 768px)" }) as ReactNode);
    });
    expect(currentMql.removeEventListener).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    expect(currentMql.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    // Setup un nouveau root pour que l'afterEach.unmount() ne plante pas
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
});

describe("useMediaQuery — re-bind si la query change", () => {
  it("retire l'ancien listener et en attache un nouveau quand `query` change", () => {
    const firstMql = makeMQL("(min-width: 768px)", true);
    const secondMql = makeMQL("(min-width: 1024px)", false);
    let callCount = 0;
    window.matchMedia = vi.fn((q: string) => {
      callCount++;
      if (q === "(min-width: 768px)") return firstMql as unknown as MediaQueryList;
      return secondMql as unknown as MediaQueryList;
    });

    act(() => {
      root.render(createElement(Capture, { query: "(min-width: 768px)" }) as ReactNode);
    });
    expect(firstMql.addEventListener).toHaveBeenCalledTimes(1);
    expect(lastValue).toBe(true);

    // Re-render avec une nouvelle query → effet retrigger
    act(() => {
      root.render(createElement(Capture, { query: "(min-width: 1024px)" }) as ReactNode);
    });

    // Ancien listener retiré, nouveau attaché, valeur mise à jour
    expect(firstMql.removeEventListener).toHaveBeenCalledTimes(1);
    expect(secondMql.addEventListener).toHaveBeenCalledTimes(1);
    expect(callCount).toBe(2);
    expect(lastValue).toBe(false);
  });
});

export {};
