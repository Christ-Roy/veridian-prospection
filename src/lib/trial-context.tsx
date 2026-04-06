"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const TRIAL_DAYS = parseInt(process.env.NEXT_PUBLIC_TRIAL_DAYS ?? "7", 10);

interface TrialState {
  daysLeft: number;
  isExpired: boolean;
  loading: boolean;
}

const TrialContext = createContext<TrialState>({ daysLeft: TRIAL_DAYS, isExpired: false, loading: true });

export function useTrial() {
  return useContext(TrialContext);
}

export function TrialProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TrialState>({ daysLeft: TRIAL_DAYS, isExpired: false, loading: true });

  useEffect(() => {
    // Fetch trial info from server (based on user creation date in Supabase)
    fetch("/api/trial")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && typeof data.daysLeft === "number") {
          setState({ daysLeft: data.daysLeft, isExpired: data.daysLeft <= 0, loading: false });
        } else {
          // Fallback: no auth or API error → show trial as active
          setState({ daysLeft: TRIAL_DAYS, isExpired: false, loading: false });
        }
      })
      .catch(() => {
        setState({ daysLeft: TRIAL_DAYS, isExpired: false, loading: false });
      });
  }, []);

  return <TrialContext.Provider value={state}>{children}</TrialContext.Provider>;
}
