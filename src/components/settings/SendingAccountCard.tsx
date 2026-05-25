"use client";

/**
 * SendingAccountCard — toggle Hub Mail Gateway / SMTP BYO.
 *
 * 3 états :
 *   - `none` (default) : "Activer Gmail (recommandé)" + redirect Hub OAuth
 *   - `gmail-via-hub` connected : email + bouton "Tester" + bouton "Déconnecter"
 *   - `needs_reauth` : warning rouge + "Reconnecter mon Gmail"
 *
 * Le bouton "Connecter" redirige vers Hub :
 *   ${HUB_URL}/dashboard/settings/mail?return=${returnUrl}
 *
 * Le Hub gère le flow OAuth Google (scopes gmail.send + offline) et stocke
 * le refresh token. Au retour, l'utilisateur revient ici et toggle son
 * workspace en `gmail-via-hub` via POST /api/mail/sending-account.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Provider = "none" | "gmail-via-hub";

interface State {
  provider: Provider;
  email: string;
  gmailConnectedAt: string | null;
  gmailQuotaPerDay: number;
  isAdmin: boolean;
}

/**
 * URL Hub publique (env var côté Prosp, default = prod). Le return URL
 * permet au Hub de revenir sur cette page après le flow OAuth.
 */
const HUB_URL =
  process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";

export function SendingAccountCard() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/mail/sending-account")
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((data: State) => {
        setState(data);
      })
      .catch((err: Error) => {
        toast.error(`Impossible de charger l'état: ${err.message}`);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Chargement…</span>
        </CardContent>
      </Card>
    );
  }

  if (!state) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-destructive">
            Erreur de chargement — recharge la page.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleConnect = () => {
    const returnUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/settings/sending-account?connected=1`
        : "";
    const hubUrl = `${HUB_URL}/dashboard/settings/mail?return=${encodeURIComponent(returnUrl)}`;
    window.location.href = hubUrl;
  };

  const handleEnable = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/mail/sending-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gmail-via-hub" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `status ${res.status}`);
      }
      const data = (await res.json()) as {
        provider: Provider;
        gmailConnectedAt: string | null;
      };
      setState({ ...state, ...data });
      toast.success("Gmail activé comme compte d'envoi");
    } catch (err) {
      toast.error(`Échec activation: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Désactiver l'envoi via Gmail ? Les campagnes basculeront sur SMTP.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/mail/sending-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "none" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `status ${res.status}`);
      }
      setState({ ...state, provider: "none", gmailConnectedAt: null });
      toast.success("Gmail déconnecté");
    } catch (err) {
      toast.error(`Échec déconnexion: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: state.email,
          subject: "Veridian — test compte d'envoi",
          bodyText:
            "Si tu reçois ce mail c'est que ton Gmail est correctement connecté au Hub Veridian.",
          bodyHtml:
            "<p>Si tu reçois ce mail c'est que ton Gmail est correctement connecté au Hub Veridian.</p>",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        errorMessage?: string;
      };
      if (res.ok && data.ok) {
        toast.success(`Mail de test envoyé à ${state.email}`);
      } else if (data.reason === "needs_reauth") {
        toast.error("Reconnexion Gmail requise — clique sur Reconnecter");
      } else if (data.reason === "provider_not_linked") {
        toast.error("Aucun Gmail connecté côté Hub — connecte-le d'abord");
      } else {
        toast.error(
          `Test échoué: ${data.reason ?? "unknown"} ${data.errorMessage ?? ""}`,
        );
      }
    } catch (err) {
      toast.error(`Test échoué: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  // État 3 : needs_reauth — détecté à la volée par un test échec sur le
  // dernier envoi. On lit pas l'état Hub en direct ici (pas d'endpoint
  // mail-provider-status côté Hub v1) — on traite needs_reauth via le
  // toast handleTest.

  if (state.provider === "gmail-via-hub") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Gmail connecté
              </CardTitle>
              <CardDescription>
                Les campagnes outreach partent depuis votre Gmail (
                <span className="font-mono">{state.email}</span>).
              </CardDescription>
            </div>
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Actif
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm space-y-1">
            {state.gmailConnectedAt && (
              <p>
                <span className="text-muted-foreground">Connecté le:</span>{" "}
                <span className="font-medium">
                  {new Date(state.gmailConnectedAt).toLocaleString("fr-FR")}
                </span>
              </p>
            )}
            <p>
              <span className="text-muted-foreground">Quota quotidien:</span>{" "}
              <span className="font-medium">
                {state.gmailQuotaPerDay} mails/jour
              </span>
              <span className="text-xs text-muted-foreground ml-2">
                (Gmail standard = 250, Workspace = 2000)
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              Tester l&apos;envoi
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleConnect}
              disabled={busy}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Gérer dans Hub
            </Button>
            {state.isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={busy}
                className="text-destructive hover:text-destructive"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Déconnecter
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // État 1 : aucun provider — proposer Connecter
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Aucun compte d&apos;envoi connecté
        </CardTitle>
        <CardDescription>
          Connectez votre Gmail pour envoyer vos campagnes depuis votre propre
          adresse (meilleure délivrabilité qu&apos;un sender Veridian).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
          <p className="font-medium">Pourquoi Gmail ?</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
            <li>From = votre email, pas un sender Veridian</li>
            <li>Réputation SPF/DKIM = votre domaine</li>
            <li>250 mails/jour (Gmail) ou 2000 (Workspace)</li>
            <li>Trace dans votre dossier Envoyé Gmail</li>
          </ul>
        </div>

        <div className="flex gap-2">
          {state.isAdmin ? (
            <>
              <Button onClick={handleConnect} disabled={busy}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Connecter mon Gmail
              </Button>
              <Button
                variant="outline"
                onClick={handleEnable}
                disabled={busy}
                title="Si vous avez déjà connecté votre Gmail côté Hub, activez ici"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                J&apos;ai déjà connecté — activer
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Seul un administrateur peut connecter le compte d&apos;envoi du
              workspace.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
