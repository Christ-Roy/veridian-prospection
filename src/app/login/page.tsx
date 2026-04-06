"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const hubUrl = process.env.NEXT_PUBLIC_HUB_URL || "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const misconfigured = !supabaseUrl || !supabaseAnonKey;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (misconfigured) {
      // NEXT_PUBLIC vars not baked into client JS — redirect to hub
      console.warn("[login] NEXT_PUBLIC_SUPABASE_URL or ANON_KEY missing — redirecting to hub");
      window.location.href = hubUrl + "/login";
      return;
    }
    setLoading(true);
    setError("");
    try {
      const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message === "Invalid login credentials"
          ? "Email ou mot de passe incorrect"
          : authError.message);
        setLoading(false);
        return;
      }
      window.location.href = "/prospects";
    } catch {
      setError("Erreur de connexion");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-sm w-full p-8 bg-white rounded-xl shadow-lg space-y-6">
        <div className="text-center">
          <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white font-bold text-xl">V</span>
          </div>
          <h1 className="text-xl font-bold">Prospection</h1>
          <p className="text-sm text-muted-foreground">Connectez-vous a votre compte</p>
        </div>

        {misconfigured && (
          <div className="bg-amber-50 text-amber-700 text-sm p-3 rounded-lg">
            Login direct indisponible. <a href={hubUrl + "/login"} className="underline font-medium">Connectez-vous via le Hub</a>.
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="votre@email.com"
              required
              className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <div className="text-center text-xs text-muted-foreground space-y-2">
          <p>
            <a href={hubUrl + "/signup"} className="text-indigo-600 hover:underline">Creer un compte</a>
            {" "}sur le Hub Veridian
          </p>
        </div>
      </div>
    </div>
  );
}
