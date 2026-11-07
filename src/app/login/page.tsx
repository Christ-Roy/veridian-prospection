import { isLocalAuthEnabled } from "@/lib/auth/local-auth";
import { LoginScreen } from "./login-form";

// Lu à l'exécution : la variable ne doit pas être figée au build.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginScreen localAuth={isLocalAuthEnabled()} />;
}
