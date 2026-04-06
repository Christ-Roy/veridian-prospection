"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

// ---------- Types ----------

export type TelnyxState =
  | "disconnected"
  | "connecting"
  | "registered"
  | "calling"
  | "ringing"   // outbound ringing (remote party ringing)
  | "in_call"
  | "incoming"
  | "held"
  | "error";

export type CallResult = "none" | "answered" | "no_answer" | "busy" | "error";

interface TelnyxContextType {
  state: TelnyxState;
  remoteNumber: string;
  elapsed: number;
  muted: boolean;
  recording: boolean;
  callDomain: string;
  callCompanyName: string;
  callResult: CallResult;
  lastCallDuration: number;
  call: (number: string, domain?: string, companyName?: string) => void;
  hangup: () => void;
  answer: () => void;
  toggleMute: () => void;
  hold: () => void;
  unhold: () => void;
  sendDtmf: (digit: string) => void;
}

const TelnyxContext = createContext<TelnyxContextType | null>(null);

export function useTelnyx(): TelnyxContextType {
  const ctx = useContext(TelnyxContext);
  if (!ctx) {
    // Fallback when TelnyxProvider hasn't mounted yet (SSR or dynamic loading)
    return {
      state: "disconnected",
      remoteNumber: "",
      elapsed: 0,
      muted: false,
      recording: false,
      callDomain: "",
      callCompanyName: "",
      callResult: "none",
      lastCallDuration: 0,
      call: () => {},
      hangup: () => {},
      answer: () => {},
      toggleMute: () => {},
      hold: () => {},
      unhold: () => {},
      sendDtmf: () => {},
    };
  }
  return ctx;
}

// ---------- Provider ----------

export function TelnyxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TelnyxState>("disconnected");
  const [remoteNumber, setRemoteNumber] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [callDomain, setCallDomain] = useState("");
  const [callCompanyName, setCallCompanyName] = useState("");
  const [callResult, setCallResult] = useState<CallResult>("none");
  const [lastCallDuration, setLastCallDuration] = useState(0);

  // We store the TelnyxRTC client and current call as refs to avoid
  // re-renders on every internal SDK event.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the domain/company for call logging
  const pendingDomainRef = useRef<string | undefined>(undefined);
  const pendingCompanyRef = useRef<string | undefined>(undefined);
  const callAnsweredRef = useRef(false);

  // Timer for call duration
  useEffect(() => {
    if (state === "in_call" || state === "held") {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      timerRef.current = setInterval(
        () =>
          setElapsed(
            Math.floor((Date.now() - startTimeRef.current) / 1000)
          ),
        1000
      );
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (state !== "calling" && state !== "ringing") {
        setElapsed(0);
        startTimeRef.current = 0;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  // ---- Fetch JWT token and connect ----
  async function connectClient() {
    setState("connecting");

    try {
      // 1. Get JWT from our server-side endpoint
      const tokenRes = await fetch("/api/phone/telnyx-token", {
        method: "POST",
      });
      if (!tokenRes.ok) {
        console.error("[Telnyx] Failed to get token:", tokenRes.status);
        setState("error");
        return;
      }
      const { token } = await tokenRes.json();
      if (!token) {
        console.error("[Telnyx] Empty token received");
        setState("error");
        return;
      }

      // 2. Dynamically import TelnyxRTC (browser-only)
      const { TelnyxRTC } = await import("@telnyx/webrtc");

      const client = new TelnyxRTC({
        login_token: token,
        debug: false,
      });

      // 3. Event handlers
      client.on("telnyx.ready", () => {
        console.log("[Telnyx] Ready / Registered");
        setState("registered");
        fetch("/api/phone/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ online: true }) }).catch(() => {});
      });

      client.on("telnyx.error", (err: unknown) => {
        console.error("[Telnyx] Error:", err);
        // Don't set error state if we're in a call — just log
        if (
          state !== "in_call" &&
          state !== "calling" &&
          state !== "ringing"
        ) {
          setState("error");
        }
      });

      client.on("telnyx.socket.close", () => {
        console.warn("[Telnyx] Socket closed");
        if (
          state !== "in_call" &&
          state !== "calling" &&
          state !== "ringing"
        ) {
          setState("disconnected");
          // Auto-reconnect after 5s
          reconnectTimerRef.current = setTimeout(() => {
            connectClient();
          }, 5000);
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on("telnyx.notification", (notification: any) => {
        const call = notification.call;
        if (!call) return;

        switch (notification.type) {
          case "callUpdate": {
            handleCallStateChange(call);
            break;
          }
          case "userMediaError": {
            console.error("[Telnyx] Media error — microphone access denied?");
            setState("error");
            break;
          }
        }
      });

      client.connect();
      clientRef.current = client;
    } catch (err) {
      console.error("[Telnyx] Connection error:", err);
      setState("error");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleCallStateChange(call: any) {
    const s = call.state;

    switch (s) {
      case "new":
      case "requesting":
      case "trying":
      case "recovering":
        setState("calling");
        break;
      case "ringing":
        // If inbound, show incoming; if outbound, show ringing
        if (call.direction === "inbound") {
          setRemoteNumber(call.options?.callerNumber || "Inconnu");
          callRef.current = call;
          setState("incoming");
        } else {
          setState("ringing");
        }
        break;
      case "answering":
      case "early":
        if (call.direction === "inbound") {
          setState("incoming");
        } else {
          setState("ringing");
        }
        break;
      case "active":
        setState("in_call");
        setRecording(true); // Recording started server-side
        callAnsweredRef.current = true;
        // Attach remote audio
        attachRemoteAudio(call);
        break;
      case "held":
        setState("held");
        break;
      case "hangup":
      case "destroy":
      case "purge": {
        // Compute final call result + duration before resetting
        const finalElapsed = startTimeRef.current
          ? Math.floor((Date.now() - startTimeRef.current) / 1000)
          : 0;
        const result: CallResult = callAnsweredRef.current ? "answered" : "no_answer";
        setCallResult(result);
        setLastCallDuration(finalElapsed);
        // POST hangup log (fire & forget)
        const hangupDomain = pendingDomainRef.current;
        const hangupNumber = remoteNumber;
        const hangupCallId = call?.id;
        fetch("/api/phone/call-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            number: hangupNumber,
            domain: hangupDomain,
            duration: finalElapsed,
            answered: result === "answered",
            call_control_id: hangupCallId,
          }),
        }).catch(() => {});
        // Reset call state
        setState("registered");
        setRemoteNumber("");
        setMuted(false);
        setRecording(false);
        callRef.current = null;
        callAnsweredRef.current = false;
        pendingDomainRef.current = undefined;
        pendingCompanyRef.current = undefined;
        if (audioRef.current) {
          audioRef.current.srcObject = null;
        }
        // Clear domain/company after a short delay (so widget can show post-call)
        setTimeout(() => {
          setCallDomain("");
          setCallCompanyName("");
        }, 6000);
        break;
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function attachRemoteAudio(call: any) {
    if (!audioRef.current) return;
    const remoteStream = call.remoteStream;
    if (remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.play().catch(() => {});
    }
  }

  // Connect on mount
  useEffect(() => {
    // Create hidden audio element for remote audio playback
    if (!audioRef.current) {
      const el = document.createElement("audio");
      el.id = "telnyx-remote-audio";
      el.autoplay = true;
      document.body.appendChild(el);
      audioRef.current = el;
    }

    connectClient();

    // Mark offline when tab closes
    const handleBeforeUnload = () => {
      navigator.sendBeacon("/api/phone/presence", JSON.stringify({ online: false }));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      fetch("/api/phone/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ online: false }) }).catch(() => {});
      if (reconnectTimerRef.current)
        clearTimeout(reconnectTimerRef.current);
      if (clientRef.current) {
        try {
          clientRef.current.disconnect();
        } catch {
          // ignore
        }
      }
      if (audioRef.current) {
        audioRef.current.remove();
        audioRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Actions ----

  const dial = useCallback((number: string, domain?: string, companyName?: string) => {
    const client = clientRef.current;
    if (!client || !number.trim()) return;

    setRemoteNumber(number);
    setState("calling");
    setMuted(false);
    setRecording(false);
    setCallResult("none");
    setCallDomain(domain || "");
    setCallCompanyName(companyName || "");
    pendingDomainRef.current = domain;
    pendingCompanyRef.current = companyName;
    callAnsweredRef.current = false;

    // Normalize number to E.164 for Telnyx
    let e164 = number.replace(/[\s.\-()]/g, "");
    if (e164.startsWith("0") && !e164.startsWith("00")) {
      e164 = "+33" + e164.slice(1);
    } else if (e164.startsWith("33") && !e164.startsWith("+")) {
      e164 = "+" + e164;
    } else if (e164.startsWith("0033")) {
      e164 = "+" + e164.slice(2);
    } else if (!e164.startsWith("+")) {
      e164 = "+" + e164;
    }

    try {
      const newCall = client.newCall({
        destinationNumber: e164,
        callerNumber: "+33974066175",
        callerName: "Veridian",
        audio: true,
        video: false,
      });
      callRef.current = newCall;
    } catch (err) {
      console.error("[Telnyx] newCall error:", err);
      setState("registered");
      return;
    }

    // Log call server-side for tracking (fire & forget)
    fetch("/api/phone/call-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction: "outgoing",
        provider: "telnyx",
        from_number: "+33974066175",
        to_number: number,
        domain,
        status: "initiated",
        started_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  }, []);

  const hangupCall = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    try {
      call.hangup();
    } catch {
      // If hangup fails, force state reset
      setState("registered");
      setRemoteNumber("");
      callRef.current = null;
    }
  }, []);

  const answerCall = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    try {
      call.answer({ audio: true, video: false });
    } catch (err) {
      console.error("[Telnyx] answer error:", err);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    try {
      call.toggleAudioMute();
      setMuted((prev) => !prev);
    } catch {
      // ignore
    }
  }, []);

  const holdCall = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    try {
      call.hold();
    } catch {
      // ignore
    }
  }, []);

  const unholdCall = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    try {
      call.unhold();
    } catch {
      // ignore
    }
  }, []);

  const sendDtmf = useCallback((digit: string) => {
    const call = callRef.current;
    if (!call) return;
    try {
      call.dtmf(digit);
    } catch {
      // ignore
    }
  }, []);

  return (
    <TelnyxContext.Provider
      value={{
        state,
        remoteNumber,
        elapsed,
        muted,
        recording,
        callDomain,
        callCompanyName,
        callResult,
        lastCallDuration,
        call: dial,
        hangup: hangupCall,
        answer: answerCall,
        toggleMute,
        hold: holdCall,
        unhold: unholdCall,
        sendDtmf,
      }}
    >
      {children}
    </TelnyxContext.Provider>
  );
}
