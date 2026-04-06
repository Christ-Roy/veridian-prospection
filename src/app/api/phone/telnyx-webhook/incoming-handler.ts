import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/queries";

const TELNYX_API = "https://api.telnyx.com/v2";

async function telnyxCall(callControlId: string, action: string, body?: Record<string, unknown>) {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    console.error("[incoming] TELNYX_API_KEY not set");
    return null;
  }
  const res = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[incoming] ${action} failed (${res.status}):`, text);
  }
  return res;
}

/** Check if we're inside business hours */
async function isBusinessHours(): Promise<boolean> {
  const start = await getSetting("settings.business_hours_start") ?? "09:00";
  const end = await getSetting("settings.business_hours_end") ?? "19:00";
  const tz = await getSetting("settings.business_hours_timezone") ?? "Europe/Paris";

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const hhmm = formatter.format(now); // "14:30"

  return hhmm >= start && hhmm < end;
}

/**
 * Handle an incoming call (call.initiated with direction=incoming).
 * - If WebRTC is online: answer + let SDK handle (the WebRTC client gets the notification)
 * - If offline / outside hours: answer, play greeting, forward to mobile or voicemail
 */
export async function handleIncomingCall(
  callControlId: string,
  callerNumber: string,
) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];

  // Log the incoming call
  await prisma.callLog.create({
    data: {
      direction: "incoming",
      provider: "telnyx",
      fromNumber: callerNumber,
      toNumber: "+33974066175",
      status: "initiated",
      startedAt: now,
      telnyxCallControlId: callControlId,
    },
  });

  const online = (await getSetting("settings.webrtc_online")) === "true";
  const forwardEnabled = (await getSetting("settings.call_forward_enabled")) === "true";
  const forwardNumber = await getSetting("settings.call_forward_number");
  const voicemailEnabled = (await getSetting("settings.voicemail_enabled")) === "true";
  const greetingUrl = await getSetting("settings.voicemail_greeting_url");
  const maxDuration = parseInt((await getSetting("settings.voicemail_max_duration")) ?? "60", 10);
  const outsideAction = (await getSetting("settings.outside_hours_action")) ?? "forward";

  // Check business hours
  const inHours = await isBusinessHours();

  // If outside business hours, apply specific action
  if (!inHours) {
    await telnyxCall(callControlId, "answer");
    if (outsideAction === "reject") {
      await telnyxCall(callControlId, "hangup");
      return;
    }
    if (outsideAction === "voicemail" && voicemailEnabled) {
      await startVoicemail(callControlId, greetingUrl, maxDuration);
      return;
    }
    // outsideAction === "forward" -- fall through to forward logic
    if (forwardEnabled && forwardNumber) {
      await forwardCall(callControlId, forwardNumber, greetingUrl);
      return;
    }
    // No forward configured -- try voicemail
    if (voicemailEnabled) {
      await startVoicemail(callControlId, greetingUrl, maxDuration);
      return;
    }
    // Nothing configured -- just let it ring
    return;
  }

  // Inside business hours
  if (online) {
    // WebRTC is connected -- do nothing, SDK handles it
    return;
  }

  // Offline -- answer and forward/voicemail
  if (forwardEnabled && forwardNumber) {
    await telnyxCall(callControlId, "answer");
    await forwardCall(callControlId, forwardNumber, greetingUrl);
    return;
  }

  if (voicemailEnabled) {
    await telnyxCall(callControlId, "answer");
    await startVoicemail(callControlId, greetingUrl, maxDuration);
    return;
  }

  // Nothing configured, nothing online -- call will just ring and timeout on Telnyx side
}

async function forwardCall(
  callControlId: string,
  forwardNumber: string,
  greetingUrl: string | null,
) {
  if (greetingUrl) {
    await telnyxCall(callControlId, "playback_start", { audio_url: greetingUrl });
    await new Promise((r) => setTimeout(r, 3000));
  }
  await telnyxCall(callControlId, "transfer", { to: forwardNumber });
}

async function startVoicemail(
  callControlId: string,
  greetingUrl: string | null,
  maxDuration: number,
) {
  if (greetingUrl) {
    await telnyxCall(callControlId, "playback_start", { audio_url: greetingUrl });
    await new Promise((r) => setTimeout(r, 4000));
  }
  await telnyxCall(callControlId, "record_start", {
    format: "mp3",
    channels: "single",
    max_length: maxDuration,
    timeout_secs: 5,
  });
}
