"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  ChevronDown,
  Mic,
  MicOff,
  Pause,
  Play,
  Grid3X3,
} from "lucide-react";
import { useTelnyx } from "./telnyx-provider";
import { DtmfKeypad } from "./dtmf-keypad";

export function SoftphoneWidget() {
  const {
    state, remoteNumber, elapsed, muted, recording,
    callDomain, callCompanyName, callResult, lastCallDuration,
    call, hangup, answer, toggleMute, hold, unhold, sendDtmf,
  } = useTelnyx();

  const [expanded, setExpanded] = useState(false);
  const [number, setNumber] = useState("");
  const [showDtmf, setShowDtmf] = useState(false);
  const [postCall, setPostCall] = useState(false);
  const postCallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const gwUp = state !== "disconnected" && state !== "connecting" && state !== "error";
  const busy = state === "calling" || state === "ringing" || state === "in_call" || state === "incoming" || state === "held";

  // Post-call overlay for 5s after hangup
  const prevBusy = useRef(busy);
  useEffect(() => {
    if (prevBusy.current && !busy && callResult !== "none") {
      setPostCall(true);
      setShowDtmf(false);
      postCallTimer.current = setTimeout(() => setPostCall(false), 5000);
    }
    prevBusy.current = busy;
    return () => { if (postCallTimer.current) clearTimeout(postCallTimer.current); };
  }, [busy, callResult]);

  // Connection status dot + label
  const statusDot = state === "in_call" || state === "held"
    ? "bg-green-500 animate-pulse"
    : state === "connecting"
    ? "bg-orange-400 animate-pulse"
    : gwUp
    ? "bg-green-500"
    : "bg-red-500";

  const statusLabel = state === "disconnected"
    ? "Deconnecte"
    : state === "connecting"
    ? "Connexion..."
    : state === "error"
    ? "Erreur"
    : "Connecte";

  // ---- Collapsed pill ----
  if (!expanded) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-background border rounded-full px-3 py-2 shadow-lg cursor-pointer hover:shadow-xl transition-shadow"
        onClick={() => setExpanded(true)}
      >
        <div className={`w-2.5 h-2.5 rounded-full ${statusDot}`} />
        {state === "incoming" ? (
          <PhoneIncoming className="h-4 w-4 text-orange-500 animate-bounce" />
        ) : (
          <Phone className="h-4 w-4" />
        )}
        {busy && (
          <span className="text-xs font-medium text-green-600">{fmt(elapsed)}</span>
        )}
        {busy && recording && (
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>
    );
  }

  // ---- Expanded widget ----
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-background border rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-xs font-medium">{statusLabel}</span>
          {recording && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1.5 animate-pulse">
              REC
            </Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setExpanded(false)}>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Post-call summary */}
      {postCall && !busy && (
        <div className="p-3 space-y-1 text-center">
          <div className="text-sm font-medium">
            Appel termine — {fmt(lastCallDuration)}
          </div>
          <div className="text-xs text-muted-foreground">
            {callResult === "answered" ? "Repondu" : "Pas de reponse"}
          </div>
        </div>
      )}

      {/* Incoming call */}
      {state === "incoming" && (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <PhoneIncoming className="h-5 w-5 text-orange-500 animate-bounce" />
            <span className="text-sm font-medium">Appel entrant : {remoteNumber}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={answer}>
              <Phone className="h-4 w-4 mr-1" /> Repondre
            </Button>
            <Button size="sm" variant="destructive" className="flex-1" onClick={hangup}>
              <PhoneOff className="h-4 w-4 mr-1" /> Refuser
            </Button>
          </div>
        </div>
      )}

      {/* Dialer — only when idle and not showing post-call */}
      {!busy && !postCall && (
        <div className="p-3 space-y-2">
          <div className="flex gap-1.5">
            <Input
              placeholder="06 29 45 43 11"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && number.trim() && call(number)}
              className="text-sm h-9"
            />
            <Button
              size="sm"
              className="h-9 px-3 bg-green-600 hover:bg-green-700"
              onClick={() => call(number)}
              disabled={!number.trim() || !gwUp}
            >
              <Phone className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* In call / Calling / Ringing / Held */}
      {(state === "calling" || state === "ringing" || state === "in_call" || state === "held") && (
        <div className="p-3 space-y-2">
          {/* Call info */}
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              {callCompanyName && (
                <div className="text-sm font-semibold truncate">{callCompanyName}</div>
              )}
              <div className="text-xs text-muted-foreground truncate">{remoteNumber}</div>
              {callDomain && (
                <div className="text-[10px] text-muted-foreground truncate">{callDomain}</div>
              )}
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {state === "calling" ? "Appel en cours..."
                  : state === "ringing" ? "Sonnerie..."
                  : state === "held" ? "En attente"
                  : "En ligne"}
              </div>
            </div>
            <div className="text-lg font-mono font-bold text-green-600 ml-2">
              {fmt(elapsed)}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5">
            {(state === "in_call" || state === "held") && (
              <>
                <Button
                  size="sm"
                  variant={muted ? "default" : "outline"}
                  className="flex-1 h-8 text-xs"
                  onClick={toggleMute}
                >
                  {muted ? <MicOff className="h-3.5 w-3.5 mr-1" /> : <Mic className="h-3.5 w-3.5 mr-1" />}
                  {muted ? "Unmute" : "Mute"}
                </Button>
                <Button
                  size="sm"
                  variant={state === "held" ? "default" : "outline"}
                  className="flex-1 h-8 text-xs"
                  onClick={state === "held" ? unhold : hold}
                >
                  {state === "held" ? <Play className="h-3.5 w-3.5 mr-1" /> : <Pause className="h-3.5 w-3.5 mr-1" />}
                  {state === "held" ? "Reprendre" : "Pause"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-8 w-8 p-0 ${showDtmf ? "bg-muted" : ""}`}
                  onClick={() => setShowDtmf((v) => !v)}
                >
                  <Grid3X3 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="destructive"
              className="flex-1 h-8 text-xs gap-1"
              onClick={hangup}
            >
              <PhoneOff className="h-3.5 w-3.5" /> Raccrocher
            </Button>
          </div>
        </div>
      )}

      {/* DTMF keypad */}
      {showDtmf && (state === "in_call" || state === "held") && (
        <DtmfKeypad onDigit={sendDtmf} />
      )}
    </div>
  );
}
