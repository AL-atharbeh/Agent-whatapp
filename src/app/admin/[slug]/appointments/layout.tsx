import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ActionError } from "@/components/action-error";
import AppointmentsNav from "./_views/nav";

export const dynamic = "force-dynamic";

/** قسم المواعيد لمالك المنصة — موجود فقط لمتجر فعّل الوحدة. */
export default async function AdminAppointmentsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { appointmentsEnabled: true } });
  if (!t?.appointmentsEnabled) notFound();
  return (
    <>
      <AppointmentsNav base={`/admin/${slug}/appointments`} />
      <Suspense fallback={null}>
        <ActionError />
      </Suspense>
      {children}
    </>
  );
}
