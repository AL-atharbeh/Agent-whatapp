import { prisma } from "@/lib/db";
import { noContent, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /auth/logout — يسحب جلسة هذا الجهاز ويمحو رمز إشعاراته.
 *
 * محو الرمز ليس تفصيلاً: بدونه يبقى الجوال يستقبل رسائل العملاء على شاشة
 * القفل بعد خروج صاحبه — وقد يكون سلّمه لغيره.
 */
export const POST = route(async (req) => {
  const d = await requireDevice(req);
  await prisma.deviceSession.updateMany({
    where: { id: d.deviceId, revokedAt: null },
    data: { revokedAt: new Date(), pushToken: null },
  });
  return noContent();
});
