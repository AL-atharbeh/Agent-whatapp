import { NextResponse } from "next/server";
import { synthesize } from "@/lib/speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * فحص جاهزية المسار الصوتي داخل بيئة النشر.
 *
 * وُجد لأن المسار ينجح محلياً ويسقط للنص على Vercel بصمت — وسقوطه مقصود
 * (أفضل من ضياع الرد) لكنه يُخفي السبب. هنا نُظهره.
 *
 * لا ينادي Groq ولا يكشف أي مفتاح: يفحص أن مرمّز mp3 انحزم فعلاً مع الدالة
 * وأنه يرمّز، وهو أرجح المشتبهين لأن استيراده ديناميكي.
 */
export async function GET(req: Request) {
  const checks: Record<string, unknown> = {
    runtime: process.env.NEXT_RUNTIME ?? "nodejs",
    groq_key: Boolean(process.env.GROQ_API_KEY),
    tts_model: process.env.GROQ_TTS_MODEL ?? "canopylabs/orpheus-arabic-saudi",
    tts_voice: process.env.GROQ_TTS_VOICE ?? "noura",
  };

  // نرمّز صمتاً اصطناعياً: يثبت أن الحزمة محمّلة وتعمل، بلا أي كلفة
  try {
    const { Mp3Encoder } = await import("@breezystack/lamejs");
    const encoder = new Mp3Encoder(1, 24000, 64);
    const frames = encoder.encodeBuffer(new Int16Array(1152));
    const tail = encoder.flush();
    checks.mp3_encoder = {
      ok: true,
      bytes: (frames?.length ?? 0) + (tail?.length ?? 0),
    };
  } catch (err) {
    checks.mp3_encoder = {
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }

  // ?tts=1 يشغّل توليداً حقيقياً — خلف علم لأن له كلفة وزمناً، ولأن الفحص
  // الأول (بلا كلفة) يكفي في معظم الحالات.
  if (new URL(req.url).searchParams.get("tts") === "1") {
    const t0 = Date.now();
    const v = await synthesize({ text: "تجربة." });
    checks.tts = v.ok
      ? { ok: true, bytes: v.value.audio.byteLength, mime: v.value.mimeType, ms: Date.now() - t0 }
      : { ok: false, error: v.error, ms: Date.now() - t0 };
  }

  const ok = Boolean(
    checks.groq_key &&
      (checks.mp3_encoder as { ok?: boolean })?.ok &&
      (checks.tts === undefined || (checks.tts as { ok?: boolean }).ok),
  );

  return NextResponse.json(
    {
      ok,
      checks,
      next_step: ok
        ? "المسار الصوتي جاهز — إن بقي الرد نصاً فالسبب في رفع الملف أو إرساله لميتا."
        : "راجع الفحص الفاشل أعلاه.",
    },
    { status: ok ? 200 : 503 },
  );
}
