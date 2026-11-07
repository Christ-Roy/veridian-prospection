/**
 * Porte locale fermée en production (CONTRAT-HUB §3.8) : le seul login est celui du Hub.
 * `LOCAL_AUTH_ENABLED=1` ne sert qu'au staging, où les e2e se connectent sans Hub.
 */
export function isLocalAuthEnabled(): boolean {
  return process.env.LOCAL_AUTH_ENABLED === "1";
}

export const LOCAL_AUTH_CLOSED = {
  error: "local_auth_closed",
  message: "La connexion et les invitations passent par le Hub Veridian.",
} as const;
