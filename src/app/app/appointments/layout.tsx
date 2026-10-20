import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOwnTenant } from "@/lib/session";
import { ActionError } from "@/components/action-error";
import AppointmentsNav from "@/app/admin/[slug]/appointments/_views/nav";

export const dynamic = "force-dynamic";

/** قسم المواعيد لصاحب النشاط — المتجر من الجلسة، والقسم لمن فعّل الوحدة فقط. */
export default async function PortalAppointmentsLayout({ children }: { children: React.ReactNode }) {
  const { tenant } = await requireOwnTenant();
  if (!tenant.appointmentsEnabled) notFound();
  return (
    <>
      <AppointmentsNav base="/app/appointments" />
      <Suspense fallback={null}>
        <ActionError />
      </Suspense>
      {children}
    </>
  );
}
