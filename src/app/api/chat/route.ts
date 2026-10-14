import { NextResponse } from "next/server";
import { chatOnce } from "@/lib/pipeline";
import { authorizeTenant } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ساحة تجربة الوكيل — نفس المحرك ونفس العزل، بدون قنوات Meta.
 *
 * ⚠️ `tenantSlug` يأتي من جسم الطلب، أي من المتصفح، أي من المستخدم. الاكتفاء
 * بأنه مسجَّل دخوله لا يكفي: أي صاحب متجر كان يستطيع وضع معرّف متجر منافس
 * فيستجوب وكيله ويستخرج كتالوجه وأسعاره وسياساته — ويستهلك رصيده أيضاً.
 *
 * `authorizeTenant` تقارن المعرّف بالمتجر المرتبط بالجلسة الموقّعة، فتسقط
 * المحاولة قبل أن تصل للمحرك.
 */

/** سقف طول الرسالة — رسالة عميل حقيقية لا تتجاوز هذا، والأطول استنزاف. */
const MAX_TEXT = 2000;

export async function POST(req: Request) {
  let body: { tenantSlug?: string; sessionId?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "جسم الطلب ليس JSON صالحاً" }, { status: 400 });
  }

  const { tenantSlug, sessionId, text } = body;
  if (!tenantSlug || !sessionId || !text?.trim()) {
    return NextResponse.json({ error: "ناقص: tenantSlug / sessionId / text" }, { status: 400 });
  }
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: `الرسالة أطول من ${MAX_TEXT} حرف` }, { status: 400 });
  }

  try {
    await authorizeTenant(tenantSlug);
  } catch {
    // رسالة واحدة للمتجر المجهول وللمتجر غير المملوك — حتى لا تكشف
    // الاستجابة أي المتاجر موجودة لمن يجرّب معرّفات عشوائية.
    return NextResponse.json({ error: "لا صلاحية لك على هذا المتجر" }, { status: 403 });
  }

  const result = await chatOnce({ tenantSlug, sessionId, text: text.trim() });
  if ("error" in result) return NextResponse.json(result, { status: 404 });
  return NextResponse.json(result);
}
