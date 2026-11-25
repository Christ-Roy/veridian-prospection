import type { ReactNode } from "react";

const HUB = process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";

/** En-tête et pied des pages publiques. */
export function CadrePublic({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <a href="/marches" className="text-[15px] font-semibold">
            Veridian Atlas
          </a>
          <nav className="flex items-center gap-3 text-sm">
            <a href="/login" className="text-neutral-600 hover:text-neutral-900">
              Se connecter
            </a>
            <a href={`${HUB}/signup`} className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700">
              Créer un compte
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-5 pb-10 text-xs text-neutral-500">
        Comptes d&apos;entreprises actives, d&apos;après la base Sirene et les sources publiques réunies par Veridian. Aucune donnée personnelle.
      </footer>
    </div>
  );
}

export function Invitation({ quoi }: { quoi: string }) {
  return (
    <aside className="mt-10 rounded-2xl bg-neutral-100 p-6">
      <h2 className="text-lg font-semibold">Aller plus loin sur {quoi}</h2>
      <p className="mt-1 text-sm text-neutral-600">La carte jusqu&apos;à la commune, votre taux de pénétration, vos cibles classées, et votre IA branchée dessus. Gratuit pour commencer.</p>
      <a href={`${HUB}/signup`} className="mt-4 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
        Ouvrir Atlas
      </a>
    </aside>
  );
}
