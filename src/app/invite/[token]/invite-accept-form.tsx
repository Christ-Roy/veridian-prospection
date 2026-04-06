"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { toast } from "sonner";

type Props = {
  token: string;
  email: string;
  role: string;
  workspaceName: string | null;
  inviterEmail: string | null;
  expiresAt: string;
};

export function InviteAcceptForm({
  token,
  email,
  role,
  workspaceName,
  inviterEmail,
}: Props) {
  const router = useRouter();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/invitations/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, fullName: fullName.trim() || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = body.error || `Erreur ${res.status}`;
        setError(msg);
        toast.error(msg);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as {
        session?: { access_token: string; refresh_token: string };
        redirectTo?: string;
      };

      if (data.session && supabaseUrl && supabaseAnonKey) {
        const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
        const { error: setErr } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (setErr) {
          console.error("[invite] setSession failed", setErr);
          toast.error("Session non établie, merci de vous reconnecter");
          router.push("/login");
          return;
        }
      }

      toast.success("Invitation acceptée");
      const target = data.redirectTo || "/prospects";
      // Full reload so middleware picks up cookies set by setSession
      window.location.href = target;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau";
      setError(msg);
      toast.error(msg);
      setLoading(false);
    }
  }

  const roleLabel = role === "admin" ? "administrateur" : "membre";

  return (
    <div className="max-w-sm w-full p-8 bg-white rounded-xl shadow-lg space-y-6">
      <div className="text-center">
        <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center mx-auto mb-3">
          <span className="text-white font-bold text-xl">V</span>
        </div>
        <h1 className="text-xl font-bold">Rejoindre Veridian</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {inviterEmail ? (
            <>
              Vous avez été invité par <span className="font-medium">{inviterEmail}</span>
            </>
          ) : (
            <>Vous avez été invité</>
          )}{" "}
          à rejoindre{" "}
          <span className="font-medium">{workspaceName || "Veridian Prospection"}</span> en tant
          que <span className="font-medium">{roleLabel}</span>.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            readOnly
            className="w-full mt-1 px-3 py-2 border rounded-lg text-sm bg-gray-50 text-gray-600 outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="fullName">
            Nom complet <span className="text-muted-foreground">(optionnel)</span>
          </label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jean Dupont"
            className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="password">
            Mot de passe
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            placeholder="8 caractères minimum"
            className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {loading ? "Acceptation..." : "Accepter l'invitation"}
        </button>
      </form>
    </div>
  );
}
