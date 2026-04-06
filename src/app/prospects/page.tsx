import { Suspense } from "react";
import { ProspectPage } from "@/components/dashboard/prospect-page";

export default function Page() {
  return (
    <Suspense>
      <ProspectPage />
    </Suspense>
  );
}
