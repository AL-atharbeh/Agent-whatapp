import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeTenant } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * نبضة: هل وصل جديد في محادثات هذا المتجر؟
 *
 * السؤال كل ثانية بـ `router.refresh()` يعيد بناء الصفحة كاملة — عدة
 * استعلامات وعرض كامل — ستين مرة في الدقيقة لكل متصفح مفتوح. مكلف بلا داعٍ،
 * لأن الجواب في معظم المرات «لا جديد».
 *
 * هذه النقطة استعلام واحد يرجّع بصمة صغيرة: عدد الرسائل وآخر وقت. الواجهة
 * تسألها كل ثانية، ولا تعيد بناء الصفحة إلا حين تتغيّر البصمة فعلاً —
 * فيصير التأخير ثانية واحدة بكلفة أقل من التحديث كل سبع.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;

  let tenantId: string;
  try {
    tenantId = await authorizeTenant(slug);
  } catch {
    return NextResponse.json({ error: "لا صلاحية" }, { status: 403 });
  }

  const [count, last] = await Promise.all([
    prisma.message.count({ where: { tenantId } }),
    prisma.message.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return NextResponse.json(
    { n: count, t: last?.createdAt.getTime() ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
