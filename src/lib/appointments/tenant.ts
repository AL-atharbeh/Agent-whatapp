import { prisma } from "../db";
import { settingsOf, type AppointmentSettings } from "./settings";
import { safeTz } from "./time";
import { notFound } from "./errors";

/** ما يلزم من المتجر لأي عملية مواعيد — توقيته وإعداداته. */
export type ApptTenant = {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  currency: string;
  status: string;
  appointmentsEnabled: boolean;
  settings: AppointmentSettings;
};

export async function loadApptTenant(tenantId: string): Promise<ApptTenant> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      timezone: true,
      locale: true,
      currency: true,
      status: true,
      appointmentsEnabled: true,
      appointmentSettings: true,
    },
  });
  if (!t) throw notFound("المتجر");
  return {
    id: t.id,
    name: t.name,
    timezone: safeTz(t.timezone),
    locale: t.locale,
    currency: t.currency,
    status: t.status,
    appointmentsEnabled: t.appointmentsEnabled,
    settings: settingsOf(t),
  };
}
