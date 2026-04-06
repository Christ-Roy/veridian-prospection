import { headers } from "next/headers";
import Link from "next/link";
import { InviteAcceptForm } from "./invite-accept-form";

type InvitePayload = {
  token: string;
  email: string;
  role: string;
  workspaceName: string | null;
  inviterEmail: string | null;
  expiresAt: string;
};

type InviteError = {
  status: number;
  error: string;
};

async function fetchInvitation(
  token: string
): Promise<{ data: InvitePayload | null; error: InviteError | null }> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || "http";
  const base = process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${host}`;

  try {
    const res = await fetch(`${base}/api/invitations/${token}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        data: null,
        error: { status: res.status, error: body.error || `HTTP ${res.status}` },
      };
    }
    const data = (await res.json()) as InvitePayload;
    return { data, error: null };
  } catch (e) {
    return {
      data: null,
      error: { status: 500, error: e instanceof Error ? e.message : "fetch failed" },
    };
  }
}

function reasonLabel(status: number, error: string): string {
  const lower = error.toLowerCase();
  if (status === 404) return "Cette invitation n'existe pas ou a été révoquée.";
  if (status === 410) return "Cette invitation a expiré.";
  if (lower.includes("expired")) return "Cette invitation a expiré.";
  if (lower.includes("revoked")) return "Cette invitation a été révoquée.";
  if (lower.includes("accepted") || lower.includes("used")) return "Cette invitation a déjà été acceptée.";
  return "Invitation invalide.";
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { data, error } = await fetchInvitation(token);

  if (error || !data) {
    const message = error ? reasonLabel(error.status, error.error) : "Invitation invalide.";
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-sm w-full p-8 bg-white rounded-xl shadow-lg space-y-6 text-center">
          <div className="h-12 w-12 rounded-xl bg-red-100 flex items-center justify-center mx-auto">
            <span className="text-red-600 font-bold text-xl">!</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">Invitation invalide</h1>
            <p className="text-sm text-muted-foreground mt-2">{message}</p>
          </div>
          <Link
            href="/login"
            className="inline-block w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
          >
            Retour à la connexion
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <InviteAcceptForm
        token={token}
        email={data.email}
        role={data.role}
        workspaceName={data.workspaceName}
        inviterEmail={data.inviterEmail}
        expiresAt={data.expiresAt}
      />
    </div>
  );
}
