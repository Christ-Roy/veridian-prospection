"use client";

/**
 * ClientErrorBoundary — capture window-level JS errors and POST them to
 * /api/errors (cf. commit 9fe9ddd).
 *
 * Installs listeners for:
 *  - window.onerror (synchronous uncaught errors)
 *  - window.onunhandledrejection (async rejected promises)
 *
 * Sends the payload via navigator.sendBeacon when available (non-blocking,
 * survives the page unload) and falls back to fetch({ keepalive: true }).
 *
 * Debouncing: the same error (message + url + lineno) is only reported
 * once per 30s to avoid flooding /api/errors during a crash loop.
 *
 * This component is mounted in src/app/layout.tsx so it covers all pages.
 * It renders nothing (no UI) — it's a pure side-effect component.
 */

import { useEffect } from "react";

type ErrorPayload = {
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

const DEDUPE_WINDOW_MS = 30_000;
const dedupeCache = new Map<string, number>();

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = dedupeCache.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  dedupeCache.set(key, now);
  // Clean up old entries opportunistically
  if (dedupeCache.size > 200) {
    for (const [k, t] of dedupeCache) {
      if (now - t > DEDUPE_WINDOW_MS) dedupeCache.delete(k);
    }
  }
  return true;
}

function postError(payload: ErrorPayload) {
  try {
    const body = JSON.stringify(payload);
    // Debug trace — used by e2e tests to assert the listener is installed
    // and the handler was reached even if the network layer drops the POST
    // (e.g. Playwright headless can silently swallow sendBeacon).
    console.debug("[client-error-boundary] POST /api/errors", payload);
    // Prefer sendBeacon for non-blocking, survives unload
    let beaconOk = false;
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([body], { type: "application/json" });
        beaconOk = navigator.sendBeacon("/api/errors", blob);
      } catch {
        beaconOk = false;
      }
    }
    if (beaconOk) return;
    // Fallback: keepalive fetch — fired synchronously (no setTimeout/microtask
    // wrapper) so it runs in the same tick as the error event, before any
    // navigation or unload.
    void fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* swallow — nothing we can do if even /api/errors fails */
    });
  } catch {
    // Never throw from the error handler itself
  }
}

export function ClientErrorBoundary() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleError(e: ErrorEvent) {
      const key = `${e.message}|${e.filename}|${e.lineno}`;
      if (!shouldSend(key)) return;
      postError({
        message: e.message || "unknown error",
        stack: e.error instanceof Error ? e.error.stack : undefined,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        context: {
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          source: "window.onerror",
        },
      });
    }

    function handleRejection(e: PromiseRejectionEvent) {
      const reason = e.reason;
      let message = "unhandled promise rejection";
      let stack: string | undefined;
      if (reason instanceof Error) {
        message = reason.message || message;
        stack = reason.stack;
      } else if (typeof reason === "string") {
        message = reason;
      } else if (reason && typeof reason === "object") {
        try {
          message = JSON.stringify(reason).slice(0, 500);
        } catch {
          /* keep default */
        }
      }
      const key = `rejection|${message}`;
      if (!shouldSend(key)) return;
      postError({
        message,
        stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        context: { source: "unhandledrejection" },
      });
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
