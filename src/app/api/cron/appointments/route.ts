import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { runAppointmentsCron } from "@/lib/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// متاجر كثيرة × رسائل Meta — أطول من مهلة الدالة الافتراضية
export const maxDuration = 60;

/**
 * مهمة المواعيد المجدولة — تذكير، غياب تلقائي، تأخير، عودة (docs/appointments.md §٨).
 *
 *   POST /api/cron/appointments    Authorization: Bearer ${CRON_SECRET}
 *
 * GET مقبول بنفس الشرط: Vercel Cron ينادي بـ GET ويضع الرأس نفسه تلقائياً
 * حين يكون CRON_SECRET مضبوطاً في المشروع. والخدمة الخارجية (كل ٥ دقائق)
 * تنادي بـ POST.
 *
 * بلا CRON_SECRET لا تعمل إطلاقاً: نقطة عامة تُطلق رسائل لعملاء كل المتاجر
 * لا يجوز أن تُفتح لأي أحد يعرف الرابط.
 */

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  // مقارنة ثابتة الزمن على هاش الطرفين — طولان مختلفان لا يكشفان شيئاً
  const h = (v: string) => crypto.createHash("sha256").update(v).digest();
  return crypto.timingSafeEqual(h(got), h(want));
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron] CRON_SECRET غير مضبوط — مهمة المواعيد معطّلة");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const results = await runAppointmentsCron();
  return NextResponse.json(
    { ok: true, tenants: results.length, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const POST = handle;
export const GET = handle;
