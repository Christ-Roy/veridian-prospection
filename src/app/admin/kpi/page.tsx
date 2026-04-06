import { Suspense } from "react";
import { AdminKpiDashboard } from "@/components/dashboard/admin-kpi";

export default function KpiPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Chargement KPI...</div>}>
      <AdminKpiDashboard />
    </Suspense>
  );
}
