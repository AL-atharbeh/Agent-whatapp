import { NextResponse } from "next/server";
import { getStaffPhoto } from "@/lib/appointments";
import { ApiError, parseId, route } from "@/lib/mobile/http";
import { requireAppointments } from "@/lib/mobile/appointments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /staff/:id/photo — الصورة بمخبأ طويل.
 *
 * الرابط في /staff يحمل ?v=<بصمة>: الصورة تحت هذا الرابط لا تتغيّر أبداً،
 * فيخبّئها التطبيق سنة كاملة. تغيير الصورة يغيّر البصمة فيتغيّر الرابط.
 * ومع ETag، طلبٌ بلا ?v يأخذ 304 بلا بايتات حين لم تتغيّر.
 *
 * private لا public: الطلب بمصادقة، ووسيط مشترك لا يجوز أن يخبّئ صور فريق
 * متجر ويعطيها لغيره.
 */
export const GET = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const photo = await getStaffPhoto(d.tenantId, parseId((await ctx.params).id));
  if (!photo) throw new ApiError("NOT_FOUND", "لا صورة");

  const etag = `"${photo.etag}"`;
  const pinned = new URL(req.url).searchParams.get("v") === photo.etag;
  const headers = {
    ETag: etag,
    "Cache-Control": pinned ? "private, max-age=31536000, immutable" : "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(Buffer.from(photo.bytes), {
    status: 200,
    headers: { ...headers, "Content-Type": photo.mime, "Content-Length": String(photo.bytes.byteLength) },
  });
});
