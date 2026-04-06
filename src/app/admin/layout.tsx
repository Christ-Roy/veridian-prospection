/**
 * Admin layout — Server Component auth guard.
 * Redirect non-admin users to /prospects. Unauthenticated → /login.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Building2, Users, Mail, BarChart3, ScrollText } from "lucide-react";
import { getUserContext } from "@/lib/supabase/user-context";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getUserContext();
  if (!ctx) {
    redirect("/login?redirect=/admin");
  }
  if (!ctx.isAdmin) {
    redirect("/prospects");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link href="/prospects" className="text-sm font-semibold text-indigo-600">
            ← Dashboard
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin" className="hover:text-indigo-600 inline-flex items-center gap-1">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
            <Link href="/admin/workspaces" className="hover:text-indigo-600 inline-flex items-center gap-1">
              <Building2 className="h-4 w-4" />
              Workspaces
            </Link>
            <Link href="/admin/members" className="hover:text-indigo-600 inline-flex items-center gap-1">
              <Users className="h-4 w-4" />
              Membres
            </Link>
            <Link href="/admin/invitations" className="hover:text-indigo-600 inline-flex items-center gap-1">
              <Mail className="h-4 w-4" />
              Invitations
            </Link>
            <Link href="/admin/kpi" className="hover:text-indigo-600 inline-flex items-center gap-1">
              <BarChart3 className="h-4 w-4" />
              KPI
            </Link>
            <Link href="/admin/audit-log" className="hover:text-indigo-600 inline-flex items-center gap-1">
              <ScrollText className="h-4 w-4" />
              Audit
            </Link>
          </nav>
          <div className="ml-auto text-xs text-muted-foreground">
            {ctx.email}
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
