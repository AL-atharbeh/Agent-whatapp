import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * عيّنة صوت قبل اختياره لمتجر — GET ?voiceId=…&text=…
 *
 * لمالك المنصة وحده: كل عيّنة تُخصم من رصيد ElevenLabs، ونقطة مفتوحة كانت
 * ستصير مولّد صوت مجانياً لمن يعرف الرابط. بلا ELEVENLABS_API_KEY يختفي الزر.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (session?.role !== "PLATFORM_ADMIN") return new Response("forbidden", { status: 403 });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return new Response("ELEVENLABS_API_KEY غير مضبوط", { status: 501 });

  const url = new URL(req.url);
  const voiceId = url.searchParams.get("voiceId") ?? "";
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(voiceId)) return new Response("voiceId غير صالح", { status: 400 });
  // عيّنة قصيرة: الجملة الأولى تكفي للحكم على الصوت
  const text = (url.searchParams.get("text") ?? "أهلاً، كيف بقدر أساعدك اليوم؟").slice(0, 200);
  const model = url.searchParams.get("model") === "eleven_flash_v2_5" ? "eleven_flash_v2_5" : "eleven_multilingual_v2";

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!r.ok) {
    console.error("[voice-preview]", r.status, await r.text());
    return new Response("تعذّر توليد العيّنة — هل الصوت مضاف لحساب ElevenLabs؟", { status: 502 });
  }
  return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
