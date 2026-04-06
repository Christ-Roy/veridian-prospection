import { Suspense } from "react";
import { AuditLog } from "./audit-log-client";

export default function AuditLogPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Chargement...</div>}>
      <AuditLog />
    </Suspense>
  );
}
