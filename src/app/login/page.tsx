"use client";

import { Suspense, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const hubUrl =
    process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // SSO bounce Hub (Couche 4 §6bis.8) : on délègue l'OAuth au Hub. Pas de
  // provider OAuth local côté Prospection — le Hub fait OAuth Google/MS
  // puis nous renvoie via /api/auth/bounce/complete qui appelle
  // /api/sso/issue-magic-link pour générer le token autologin one-shot.
  function bounceToHub() {
    const next =
      typeof window !== "undefined"
        ? encodeURIComponent(window.location.href)
        : "";
    window.location.href = `${hubUrl}/login?next=${next}`;
  }

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

      <div className="space-y-2">
        <button
          type="button"
          onClick={bounceToHub}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 border border-gray-300 bg-white rounded-lg text-sm font-medium hover:bg-gray-50 transition"
          aria-label="Continuer avec Google via le Hub Veridian"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h5.92a5.07 5.07 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.33Z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.07.56 4.21 1.65l3.16-3.16C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
            />
          </svg>
          Continuer avec Google
        </button>

        <button
          type="button"
          onClick={bounceToHub}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 border border-gray-300 bg-white rounded-lg text-sm font-medium hover:bg-gray-50 transition"
          aria-label="Continuer avec Microsoft via le Hub Veridian"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#F25022" d="M1 1h10v10H1z" />
            <path fill="#7FBA00" d="M13 1h10v10H13z" />
            <path fill="#00A4EF" d="M1 13h10v10H1z" />
            <path fill="#FFB900" d="M13 13h10v10H13z" />
          </svg>
          Continuer avec Microsoft
        </button>

        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-2 text-muted-foreground">ou</span>
          </div>
        </div>
      </div>

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
