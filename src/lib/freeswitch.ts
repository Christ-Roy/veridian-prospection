/**
 * FreeSWITCH ESL client — connects via Tailscale to control calls
 *
 * No SSH, no docker exec, no bricolage.
 * Direct TCP connection to FreeSWITCH Event Socket.
 */

import net from "net";

const FS_HOST = process.env.FS_ESL_HOST || "100.88.202.29";
const FS_PORT = parseInt(process.env.FS_ESL_PORT || "8021");
const FS_PASS = process.env.FS_ESL_PASSWORD || "Veridian_ESL_2026";

export async function fsApi(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = "";
    let authenticated = false;
    let commandSent = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("ESL timeout"));
    }, 10000);

    socket.connect(FS_PORT, FS_HOST, () => {});

    socket.on("data", (data) => {
      buffer += data.toString();

      // Step 1: Auth request
      if (!authenticated && buffer.includes("auth/request")) {
        socket.write(`auth ${FS_PASS}\n\n`);
        buffer = "";
        return;
      }

      // Step 2: Auth response
      if (!authenticated && buffer.includes("Reply-Text:")) {
        if (buffer.includes("+OK")) {
          authenticated = true;
          buffer = "";
          // Step 3: Send command
          socket.write(`api ${command}\n\n`);
          commandSent = true;
        } else {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error("ESL auth failed"));
        }
        return;
      }

      // Step 4: Command response
      if (commandSent && buffer.includes("Content-Length:")) {
        const match = buffer.match(/Content-Length:\s*(\d+)\r?\n\r?\n([\s\S]*)/);
        if (match) {
          const expectedLen = parseInt(match[1]);
          const body = match[2];
          if (body.length >= expectedLen) {
            clearTimeout(timeout);
            socket.destroy();
            resolve(body.substring(0, expectedLen).trim());
          }
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      if (!commandSent) reject(new Error("ESL connection closed"));
    });
  });
}

/** Check if gateway is registered */
export async function isGatewayUp(): Promise<boolean> {
  try {
    const result = await fsApi("sofia status gateway ovh");
    return result.includes("REGED") && result.includes("UP");
  } catch {
    return false;
  }
}

/**
 * Make a call to a number via the FreeSWITCH dialplan.
 *
 * The originate sends the call out via the OVH gateway. When the remote
 * party answers, FreeSWITCH routes the call to extension 9000 in the
 * default context — which answers, starts recording, and plays hold
 * music until the call is hung up (or bridged to another leg later).
 *
 * Previously this used &park() which left the call in limbo with no
 * audio at all.
 */
export async function makeCall(number: string): Promise<string> {
  return fsApi(
    `originate {origination_caller_id_number=0033482530429,origination_caller_id_name=Veridian}sofia/gateway/ovh/${number} 9000 XML default`
  );
}

/** Get UUID of an active call (first channel) */
export async function getActiveCallUuid(): Promise<string | null> {
  try {
    const result = await fsApi("show channels as json");
    const data = JSON.parse(result);
    if (data.rows && data.rows.length > 0) {
      return data.rows[0].uuid || null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Hangup a specific call by UUID */
export async function hangupCall(uuid: string): Promise<string> {
  return fsApi(`uuid_kill ${uuid}`);
}

/** Get active channels count */
export async function getChannels(): Promise<number> {
  const result = await fsApi("show channels count");
  const match = result.match(/(\d+)\s+total/);
  return match ? parseInt(match[1]) : 0;
}

/** Hangup all calls */
export async function hangupAll(): Promise<void> {
  await fsApi("hupall");
}
