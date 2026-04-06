"use client";

import { Button } from "@/components/ui/button";
import { Phone, Loader2 } from "lucide-react";
import { useTelnyx } from "./telnyx-provider";

interface CallButtonProps {
  phoneNumber: string;
  leadDomain: string;
  leadName?: string;
}

export function CallButton({ phoneNumber, leadDomain, leadName }: CallButtonProps) {
  const { call, state, callDomain } = useTelnyx();

  const busy = state === "calling" || state === "ringing" || state === "in_call" || state === "held";
  const isThisCall = busy && callDomain === leadDomain;
  const isOtherCall = busy && callDomain !== leadDomain;
  const disabled = isOtherCall || state === "disconnected" || state === "connecting" || state === "error";

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isThisCall) return; // already calling this number
    call(phoneNumber, leadDomain, leadName);
  }

  // Active call on this lead — show in-call state
  if (isThisCall) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs text-green-600 gap-1 pointer-events-none"
        disabled
      >
        {state === "calling" || state === "ringing" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Phone className="h-3 w-3" />
        )}
        {state === "calling" ? "Appel..." : state === "ringing" ? "Sonne..." : "En ligne"}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 w-6 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
      onClick={handleClick}
      disabled={disabled}
      title={isOtherCall ? "Appel en cours sur un autre numero" : `Appeler ${phoneNumber}`}
    >
      <Phone className="h-3.5 w-3.5" />
    </Button>
  );
}
