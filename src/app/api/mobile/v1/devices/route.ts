import { prisma } from "@/lib/db";
import { json, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /devices — أجهزة هذا المستخدم الحيّة، ليرى ما لا يعرفه منها فيسحبه. */
export const GET = route(async (req) => {
  const d = await requireDevice(req);
  const now = new Date();

  const rows = await prisma.deviceSession.findMany({
    where: {
      userId: d.userId,
      tenantId: d.tenantId,
      revokedAt: null,
      expiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
    },
    select: { id: true, name: true, platform: true, lastSeenAt: true, createdAt: true },
    orderBy: { lastSeenAt: "desc" },
  });

  return json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      lastSeenAt: r.lastSeenAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      current: r.id === d.deviceId,
    })),
  });
});
