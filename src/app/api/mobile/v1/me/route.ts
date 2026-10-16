import { prisma } from "@/lib/db";
import { MOBILE_CHANNELS, json, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /me — المستخدم ومتجره وقنواته وإعداد هذا الجهاز. */
export const GET = route(async (req) => {
  const d = await requireDevice(req);

  const [user, tenant, accounts] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: d.userId },
      select: { id: true, email: true, name: true },
    }),
    prisma.tenant.findUniqueOrThrow({
      where: { id: d.tenantId },
      select: { id: true, slug: true, name: true, agentName: true },
    }),
    prisma.channelAccount.findMany({
      where: { tenantId: d.tenantId, active: true, channel: { in: [...MOBILE_CHANNELS] } },
      select: { channel: true, accessTokenEnc: true },
    }),
  ]);

  return json({
    user,
    tenant,
    // «مربوطة» = تستطيع الإرسال فعلاً، أي لها رمز وصول — حساب بلا رمز
    // يبدو مربوطاً ثم يفشل أول رد عليه.
    channels: MOBILE_CHANNELS.map((channel) => ({
      channel,
      connected: accounts.some((a) => a.channel === channel && !!a.accessTokenEnc),
    })),
    device: { id: d.deviceId, notify: d.notify },
  });
});
