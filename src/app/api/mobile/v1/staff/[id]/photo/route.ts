import { NextResponse } from "next/server";
import { MAX_PHOTO_BYTES, getStaffPhoto, setStaffPhoto } from "@/lib/appointments";
import { readCappedBytes } from "@/lib/mobile/body";
import { ApiError, json, parseId, route } from "@/lib/mobile/http";
import { requireAppointments, staffJson } from "@/lib/mobile/appointments";

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

/**
 * PUT /staff/:id/photo — البايتات نفسها في الجسم بـ Content-Type الصورة.
 *
 * لا JSON بـ base64: يكبّر الصورة الثلث ويتجاوز سقف ٦٤ كيلوبايت لأجسام
 * الجوال. السقف هنا سقف الصورة نفسه، والنوع الحقيقي يُفحص من البايتات لا
 * من الرأس (checkPhoto).
 */
export const PUT = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const id = parseId((await ctx.params).id);
  const bytes = await readCappedBytes(req, MAX_PHOTO_BYTES);
  if (bytes === null) throw new ApiError("INVALID_INPUT", "الصورة أكبر من ١٥٠ كيلوبايت");
  if (bytes.byteLength === 0) throw new ApiError("INVALID_INPUT", "لا صورة في الطلب");
  const s = await setStaffPhoto(d.tenantId, id, { bytes, mime: req.headers.get("content-type") });
  return json({ staff: staffJson(s) });
});

/** DELETE /staff/:id/photo — يمحو الصورة. */
export const DELETE = route<{ id: string }>(async (req, ctx) => {
  const d = await requireAppointments(req);
  const id = parseId((await ctx.params).id);
  return json({ staff: staffJson(await setStaffPhoto(d.tenantId, id, null)) });
});
