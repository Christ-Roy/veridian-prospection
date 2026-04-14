"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, Bell, X } from "lucide-react";
import { toast } from "sonner";

/**
 * PwaManager handles:
 * 1. Service worker registration
 * 2. Push notification subscription (asks permission on first load)
 * 3. PWA install prompt (beforeinstallprompt)
 */
export function PwaManager() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | null>(null);

  // Register service worker
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[pwa] SW registered, scope:", reg.scope);
      })
      .catch((err) => {
        console.error("[pwa] SW registration failed:", err);
      });
  }, []);

  // Listen for install prompt
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      // Show install banner after 3 seconds if not already installed
      setTimeout(() => setShowInstallBanner(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Check push permission on mount
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setPushPermission(Notification.permission);
  }, []);

  // Subscribe to push notifications
  const subscribePush = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast.error("Push notifications non supportees sur ce navigateur");
      return;
    }

    const permission = await Notification.requestPermission();
    setPushPermission(permission);

    if (permission !== "granted") {
      toast.error("Notifications refusees");
      return;
    }

    try {
      // Get VAPID public key
      const vapidRes = await fetch("/api/push/vapid-key");
      const { publicKey } = await vapidRes.json();

      if (!publicKey) {
        console.warn("[pwa] No VAPID key configured");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = sub.toJSON();

      // Send subscription to server
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          platform: detectPlatform(),
          userAgent: navigator.userAgent,
        }),
      });

      toast.success("Notifications activees !");
    } catch (err) {
      console.error("[pwa] Push subscribe failed:", err);
      toast.error("Erreur lors de l'activation des notifications");
    }
  }, []);

  // Auto-subscribe if permission already granted (returning user)
  useEffect(() => {
    if (pushPermission === "granted") {
      subscribePush();
    }
  }, [pushPermission, subscribePush]);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      toast.success("Application installee !");
      setShowInstallBanner(false);
    }
    setInstallPrompt(null);
  };

  return (
    <>
      {/* Install banner (Android/Desktop) */}
      {showInstallBanner && installPrompt && (
        <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-80">
          <div className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded-xl shadow-lg p-4 flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">V</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Installer Prospection</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Acces rapide + notifications push
              </p>
              <div className="flex gap-2 mt-2">
                <Button size="sm" onClick={handleInstall} className="gap-1.5 h-7 text-xs">
                  <Download className="h-3 w-3" />
                  Installer
                </Button>
                {pushPermission === "default" && (
                  <Button size="sm" variant="outline" onClick={subscribePush} className="gap-1.5 h-7 text-xs">
                    <Bell className="h-3 w-3" />
                    Notifications
                  </Button>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowInstallBanner(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Push permission prompt (when no install prompt, e.g. iOS standalone) */}
      {!showInstallBanner && pushPermission === "default" && (
        <PushPrompt onSubscribe={subscribePush} />
      )}
    </>
  );
}

/**
 * Subtle push notification prompt shown on first visit.
 * Auto-hides after 10 seconds if dismissed.
 */
function PushPrompt({ onSubscribe }: { onSubscribe: () => void }) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Show after 5 seconds
    const timer = setTimeout(() => {
      // Don't show if user already dismissed in this session
      if (sessionStorage.getItem("push_prompt_dismissed")) return;
      setShow(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  if (!show || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72">
      <div className="bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded-xl shadow-lg p-3">
        <div className="flex items-start gap-2">
          <Bell className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Rappels pipeline</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Recevez une notification quand un rappel est du
            </p>
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={onSubscribe} className="h-7 text-xs gap-1">
                <Bell className="h-3 w-3" />
                Activer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setDismissed(true);
                  sessionStorage.setItem("push_prompt_dismissed", "1");
                }}
              >
                Plus tard
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}
