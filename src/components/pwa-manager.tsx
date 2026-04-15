"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, Bell, X, Share } from "lucide-react";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * PwaManager handles:
 * 1. Service worker registration
 * 2. PWA install prompt — Android (beforeinstallprompt) + iOS (bottom sheet guide)
 * 3. Push notification subscription — respects iOS constraints (standalone only)
 */
export function PwaManager() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | null>(null);

  // Register service worker
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("[pwa] SW registered, scope:", reg.scope))
      .catch((err) => console.error("[pwa] SW registration failed:", err));
  }, []);

  // Listen for install prompt (Android/Desktop)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowInstallBanner(true), 3000);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // iOS: show install guide (no beforeinstallprompt on Safari)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isIOS() || isStandalone()) return;
    // Don't show if dismissed in last 7 days
    if (document.cookie.includes("pwa_ios_dismissed=1")) return;
    const timer = setTimeout(() => setShowIOSGuide(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Check push permission
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setPushPermission(Notification.permission);
  }, []);

  const subscribePush = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast.error("Push non supporte sur ce navigateur");
      return;
    }

    // iOS: push only works in standalone mode (installed PWA)
    if (isIOS() && !isStandalone()) {
      toast.info("Installez d'abord l'app pour activer les notifications");
      return;
    }

    const permission = await Notification.requestPermission();
    setPushPermission(permission);

    if (permission !== "granted") {
      toast.error("Notifications refusees");
      return;
    }

    try {
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
      toast.error("Erreur activation notifications");
    }
  }, []);

  // Auto-subscribe if permission already granted
  useEffect(() => {
    if (pushPermission === "granted") subscribePush();
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

  const dismissIOSGuide = () => {
    setShowIOSGuide(false);
    document.cookie = "pwa_ios_dismissed=1;max-age=604800;path=/;SameSite=Lax";
  };

  return (
    <>
      {/* Android/Desktop install banner */}
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
            <button onClick={() => setShowInstallBanner(false)} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* iOS install guide (bottom sheet) */}
      {showIOSGuide && (
        <>
          <div
            className="fixed inset-0 z-[9998] bg-black/40 transition-opacity"
            onClick={dismissIOSGuide}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-xl">V</span>
              </div>
              <div>
                <p className="font-semibold text-base">Installer Prospection</p>
                <p className="text-sm text-muted-foreground">Acces rapide depuis l&apos;ecran d&apos;accueil</p>
              </div>
            </div>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-xl p-4 mb-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Share className="h-5 w-5 text-blue-500" />
                <span>Appuyez sur <strong>Partager</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-lg">+</span>
                <span>Puis <strong>Sur l&apos;ecran d&apos;accueil</strong></span>
              </div>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={dismissIOSGuide}
            >
              Plus tard
            </Button>
          </div>
        </>
      )}

      {/* Push prompt (iOS standalone or desktop without install prompt) */}
      {!showInstallBanner && !showIOSGuide && pushPermission === "default" && (
        <PushPrompt onSubscribe={subscribePush} />
      )}
    </>
  );
}

function PushPrompt({ onSubscribe }: { onSubscribe: () => void }) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (sessionStorage.getItem("push_prompt_dismissed")) return;
      // On iOS, only show push prompt if in standalone mode
      if (typeof window !== "undefined" && isIOS() && !isStandalone()) return;
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
