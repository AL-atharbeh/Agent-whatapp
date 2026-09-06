import { NextResponse } from "next/server";
import { chatOnce } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ساحة تجربة الوكيل — نفس المحرك ونفس العزل، بدون قنوات Meta. */
export async function POST(req: Request) {
  const { tenantSlug, sessionId, text } = await req.json();

  if (!tenantSlug || !sessionId || !text?.trim()) {
    return NextResponse.json({ error: "ناقص: tenantSlug / sessionId / text" }, { status: 400 });
  }

  const result = await chatOnce({ tenantSlug, sessionId, text: text.trim() });
  if ("error" in result) return NextResponse.json(result, { status: 404 });
  return NextResponse.json(result);
}
