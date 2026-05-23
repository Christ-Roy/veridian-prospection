"use client";

import { Suspense, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const hubUrl = process.env.NEXT_PUBLIC_HUB_URL || "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError(
          result.error === "CredentialsSignin"
            ? "Email ou mot de passe incorrect"
            : result.error,
        );
        setLoading(false);
        return;
      }
      const redirectTo = searchParams.get("redirect") || "/prospects";
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Erreur de connexion");
      setLoading(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    // redirect:false → on reste sur /login pour permettre login direct
    // sur un autre compte sans rechargement (un router.refresh suffit pour
    // que useSession reflète l'état déconnecté).
    await signOut({ redirect: false });
    router.refresh();
    setSigningOut(false);
  }

  return (
    <div className="max-w-sm w-full p-8 bg-white rounded-xl shadow-lg space-y-6">
      <div className="text-center">
        <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center mx-auto mb-3">
          <span className="text-white font-bold text-xl">V</span>
        </div>
        <h1 className="text-xl font-bold">Prospection</h1>
        <p className="text-sm text-muted-foreground">Connectez-vous a votre compte</p>
      </div>

      {status === "authenticated" && session?.user?.email && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <p className="text-sm text-amber-900">
            Déjà connecté en tant que{" "}
            <span className="font-medium">{session.user.email}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(searchParams.get("redirect") || "/prospects")}
              className="flex-1 py-2 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-md hover:bg-amber-100 transition"
            >
              Continuer
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex-1 py-2 text-xs font-medium text-white bg-amber-700 rounded-md hover:bg-amber-800 transition disabled:opacity-50"
            >
              {signingOut ? "Déconnexion..." : "Changer de compte"}
            </button>
          </div>
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
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Suspense fallback={<div className="text-sm text-gray-500">Chargement...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
