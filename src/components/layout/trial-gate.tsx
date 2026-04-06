"use client";

import { useState } from "react";
import { useTrial } from "@/lib/trial-context";
import { Paywall } from "./paywall";
import { Lock } from "lucide-react";

/**
 * Wraps a page and shows paywall overlay when trial is expired.
 * The page content is visible but blurred in the background.
 */
export function TrialGate({ children }: { children: React.ReactNode }) {
  const { isExpired } = useTrial();
  const [dismissed, setDismissed] = useState(false);

  if (!isExpired) return <>{children}</>;

  return (
    <>
      <div className="relative">
        {/* Blurred content behind */}
        <div className="blur-sm pointer-events-none select-none opacity-60">
          {children}
        </div>
        {/* Overlay prompt if paywall dismissed */}
        {dismissed && (
          <button
            onClick={() => setDismissed(false)}
            className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <Lock className="h-4 w-4" />
            Voir les plans
          </button>
        )}
      </div>
      <Paywall open={!dismissed} onClose={() => setDismissed(true)} />
    </>
  );
}
