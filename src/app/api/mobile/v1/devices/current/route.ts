import { z } from "zod";
import { prisma } from "@/lib/db";
import { noContent, readBody, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { NOTIFY_LEVELS } from "@/lib/mobile/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  pushToken: z.string().trim().min(1).max(4096).nullable().optional(),
  notify: z.enum(NOTIFY_LEVELS).optional(),
});

/** PUT /devices/current — رمز الإشعارات ومستواها لهذا الجهاز. */
export const PUT = route(async (req) => {
  const d = await requireDevice(req);
  const body = await readBody(req, Body);

  const data = {
    ...(body.pushToken !== undefined ? { pushToken: body.pushToken } : {}),
    ...(body.notify ? { notify: body.notify } : {}),
  };
  if (Object.keys(data).length === 0) return noContent();

  /**
   * الرمز يخصّ تثبيت التطبيق لا الحساب. لو دخل شخص آخر على نفس الجوال
   * دون خروج الأول، تبقى جلسة الأول تحمل نفس الرمز — فتصل إشعارات متجر
   * الأول إلى جوال صار بيد غيره. فمن يثبت أنه يملك الرمز الآن يأخذه وحده.
   *
   * خطر مقبول عن قصد: المحو عابر للمتاجر، فمن يعرف رمز FCM لجهاز في متجر
   * آخر يستطيع أن يقطع عنه الإشعارات. قبلناه لأن الرمز سرّ لا يملكه إلا
   * الجهاز وFirebase ولا يظهر في أي رد لدينا، ولأن الضرر محصور: لا يُقرأ
   * به شيء ولا يُرسَل، والتطبيق يعيد تسجيل رمزه عند كل فتح ويبقى على
   * الاستطلاع حتى ذلك. أما حصر المحو في المتجر نفسه فيُبقي الثغرة الأخطر
   * التي يسدّها هذا السطر: جوال انتقل لمتجر آخر يستمر يستقبل إشعارات الأول.
   */
  await prisma.$transaction([
    ...(body.pushToken
      ? [
          prisma.deviceSession.updateMany({
            where: { pushToken: body.pushToken, id: { not: d.deviceId } },
            data: { pushToken: null },
          }),
        ]
      : []),
    prisma.deviceSession.update({ where: { id: d.deviceId }, data }),
  ]);

  return noContent();
});
