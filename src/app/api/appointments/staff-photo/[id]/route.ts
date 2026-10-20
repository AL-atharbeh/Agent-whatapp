import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getStaffPhoto } from "@/lib/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * صورة مقدّم الخدمة للوحة الويب — بجلسة الكوكي لا برمز الجوال.
 *
 * خارج مطابقة middleware فالحراسة هنا: مالك المنصة يرى أي متجر، وصاحب
 * المتجر متجره فقط. معرّف من متجر آخر ⇒ 404 كأي معرّف غير موجود.
 *
 * ?v=<بصمة> يجعل الرابط ثابت المحتوى فيُخبّأ سنة؛ تغيير الصورة يغيّر الرابط.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401 });

  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new NextResponse(null, { status: 404 });

  const staff = await prisma.staff.findUnique({ where: { id }, select: { tenantId: true } });
  const allowed =
    staff && (session.role === "PLATFORM_ADMIN" || session.tenantId === staff.tenantId);
  if (!allowed) return new NextResponse(null, { status: 404 });

  const photo = await getStaffPhoto(staff.tenantId, id);
  if (!photo) return new NextResponse(null, { status: 404 });

  const etag = `"${photo.etag}"`;
  const pinned = new URL(req.url).searchParams.get("v") === photo.etag;
  const headers = {
    ETag: etag,
    "Cache-Control": pinned ? "private, max-age=31536000, immutable" : "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(Buffer.from(photo.bytes), {
    status: 200,
    headers: { ...headers, "Content-Type": photo.mime },
  });
}
