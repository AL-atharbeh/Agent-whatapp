import { prisma } from "@/lib/db";
import { ApiError, noContent, parseId, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /devices/:id — يسحب جهازاً لنفس المستخدم فقط.
 *
 * جهاز زميل في نفس المتجر يُعامل كغير موجود: صاحب جوال مسروق يُخرجه هو،
 * لا أي موظف يرى قائمة أجهزة غيره.
 */
export const DELETE = route<{ id: string }>(async (req, ctx) => {
  const d = await requireDevice(req);
  const id = parseId((await ctx.params).id);

  const { count } = await prisma.deviceSession.updateMany({
    where: { id, userId: d.userId, tenantId: d.tenantId, revokedAt: null },
    data: { revokedAt: new Date(), pushToken: null },
  });
  if (count === 0) throw new ApiError("NOT_FOUND", "الجهاز غير موجود");
  return noContent();
});
