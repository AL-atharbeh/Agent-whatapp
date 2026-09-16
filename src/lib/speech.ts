/**
 * طبقة الصوت: تفريغ الفويس الوارد، وتوليد فويس للرد.
 *
 * معزولة عن القنوات وعن المحرّك عمداً — القناة تعرف كيف تنزّل الملف وترفعه،
 * وهذه تعرف كيف تحوّل صوتاً إلى نص والعكس، ولا تعرف واحدتهما بالأخرى.
 * تبديل المزوّد لاحقاً (ElevenLabs مثلاً) يمسّ هذا الملف وحده.
 */

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** whisper-large-v3-turbo أسرع وأرخص، ودقّته على العربية كافية لرسائل العملاء. */
const STT_MODEL = () => process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo";
const TTS_MODEL = () => process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-arabic-saudi";
/** أصوات orpheus العربية: fahad · sultan · abdullah · noura · lulwa · aisha */
const TTS_VOICE = () => process.env.GROQ_TTS_VOICE || "noura";

/** سقف طول الرد المنطوق. الأطول يُرسل نصاً — لا أحد يسمع فويس دقيقتين ليعرف سعراً. */
export const MAX_TTS_CHARS = 600;

/** سقف حجم الفويس الوارد (١٦ ميجا = سقف واتساب نفسه). */
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

export type SpeechResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const key = () => process.env.GROQ_API_KEY;

// ═══════════════════════════════════════════════════════════
//  صوت ← نص
// ═══════════════════════════════════════════════════════════

/**
 * يفرّغ فويس العميل إلى نص.
 *
 * `locale` يُمرَّر كتلميح لغة لا كإلزام: تحديد "ar" يرفع الدقة كثيراً على
 * اللهجات مقارنة بالكشف التلقائي.
 */
export async function transcribe(args: {
  audio: Buffer;
  mimeType?: string;
  locale?: string;
}): Promise<SpeechResult<string>> {
  if (!key()) return { ok: false, error: "GROQ_API_KEY غير معرّف" };
  if (args.audio.byteLength === 0) return { ok: false, error: "ملف صوتي فارغ" };
  if (args.audio.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, error: `الملف أكبر من ${MAX_AUDIO_BYTES / 1024 / 1024} ميجا` };
  }

  const mime = args.mimeType?.split(";")[0] || "audio/ogg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(args.audio)], { type: mime }), fileNameFor(mime));
  form.append("model", STT_MODEL());
  form.append("response_format", "json");
  // نأخذ أول مقطعين من اللهجة: "ar-JO" ⇒ "ar"
  const lang = args.locale?.slice(0, 2);
  if (lang) form.append("language", lang);

  try {
    const res = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { ok: false, error: `تفريغ الصوت ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim();
    if (!text) return { ok: false, error: "التفريغ رجع فارغاً" };
    return { ok: true, value: text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════
//  نص ← صوت
// ═══════════════════════════════════════════════════════════

/**
 * يولّد فويس للرد.
 *
 * Groq يخرج wav حصراً، وواتساب لا يقبل wav — فنرمّز إلى mp3 هنا.
 * الترميز بجافاسكربت خالص عمداً: Vercel بلا ffmpeg، وإضافة ثنائي ساكن
 * تضخّم الحزمة عشرات الميجابايتات مقابل مقطع مدته ثوانٍ.
 */
export async function synthesize(args: {
  text: string;
  voice?: string;
}): Promise<SpeechResult<{ audio: Buffer; mimeType: string }>> {
  if (!key()) return { ok: false, error: "GROQ_API_KEY غير معرّف" };

  const text = args.text.trim();
  if (!text) return { ok: false, error: "نص فارغ" };
  if (text.length > MAX_TTS_CHARS) {
    return { ok: false, error: `النص ${text.length} حرف والسقف ${MAX_TTS_CHARS}` };
  }

  try {
    const res = await fetch(`${GROQ_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL(),
        input: speakable(text),
        voice: args.voice || TTS_VOICE(),
        response_format: "wav", // الصيغة الوحيدة التي يدعمها orpheus
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { ok: false, error: `توليد الصوت ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const wav = Buffer.from(await res.arrayBuffer());
    if (wav.byteLength === 0) return { ok: false, error: "الصوت المولَّد فارغ" };

    const mp3 = await wavToMp3(wav);
    if (!mp3.ok) return mp3;
    return { ok: true, value: { audio: mp3.value, mimeType: "audio/mpeg" } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════
//  ترميز wav ← mp3
// ═══════════════════════════════════════════════════════════

/** وصف مقطع PCM مستخرَج من ملف wav. */
type Pcm = { samples: Int16Array; sampleRate: number; channels: number };

/**
 * يقرأ رأس wav ويستخرج عيّنات PCM.
 *
 * لا نثق بحقل حجم RIFF: Groq يبثّ الملف فيكتب `ffffffff` لأن الطول مجهول
 * وقت الكتابة. ولا نفترض أن `data` هو المقطع الثاني — قد يسبقه LIST/INFO —
 * فنمشي على المقاطع واحداً واحداً.
 */
function parseWav(buf: Buffer): Pcm | null {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return null;

  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let pos = 12;

  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const declared = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    // مقطع مفتوح الطول (بثّ) ⇒ خذ ما تبقّى من الملف
    const size = declared === 0xffffffff ? buf.length - body : Math.min(declared, buf.length - body);

    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16 || !sampleRate || !channels) return null;
      const usable = size - (size % 2);
      const samples = new Int16Array(usable / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(body + i * 2);
      return { samples, sampleRate, channels };
    }

    pos = body + size + (size % 2); // المقاطع محاذاة زوجية
  }
  return null;
}

/** يرمّز PCM إلى mp3. 64 كيلوبت أحادي تكفي للكلام ولا تثقل رسالة واتساب. */
async function wavToMp3(wav: Buffer): Promise<SpeechResult<Buffer>> {
  const pcm = parseWav(wav);
  if (!pcm) return { ok: false, error: "تعذّرت قراءة ملف wav المولَّد" };

  try {
    const { Mp3Encoder } = await import("@breezystack/lamejs");
    const encoder = new Mp3Encoder(pcm.channels, pcm.sampleRate, 64);
    const chunks: Uint8Array[] = [];
    const BLOCK = 1152; // حجم إطار mp3

    if (pcm.channels === 1) {
      for (let i = 0; i < pcm.samples.length; i += BLOCK) {
        const b = encoder.encodeBuffer(pcm.samples.subarray(i, i + BLOCK));
        if (b.length) chunks.push(b);
      }
    } else {
      // العيّنات متشابكة (L R L R…) — نفصلها لقناتين
      const frames = Math.floor(pcm.samples.length / pcm.channels);
      const left = new Int16Array(frames);
      const right = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        left[i] = pcm.samples[i * pcm.channels];
        right[i] = pcm.samples[i * pcm.channels + 1];
      }
      for (let i = 0; i < frames; i += BLOCK) {
        const b = encoder.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK));
        if (b.length) chunks.push(b);
      }
    }

    const tail = encoder.flush();
    if (tail.length) chunks.push(tail);

    const mp3 = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    if (mp3.byteLength === 0) return { ok: false, error: "الترميز أنتج ملفاً فارغاً" };
    return { ok: true, value: mp3 };
  } catch (err) {
    return { ok: false, error: `ترميز mp3: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ═══════════════════════════════════════════════════════════
//  مساعدات
// ═══════════════════════════════════════════════════════════

/**
 * ينظّف النص قبل نطقه.
 *
 * ردود الوكيل مكتوبة لتُقرأ: فيها نجوم تنسيق وشُرَط قوائم وإيموجي. نطقها
 * حرفياً يعطي صوتاً مضحكاً ("نجمة نجمة خمسة وخمسون نجمة نجمة").
 */
export function speakable(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // تأكيد ماركداون
    .replace(/[*_`#]/g, "")
    .replace(/^[-•]\s*/gm, "") // نقاط القوائم
    .replace(/https?:\/\/\S+/g, "الرابط بالرسالة المكتوبة")
    // الإيموجي المركّب (🙋‍♂️) سلسلة رموز: صورة + واصل + محدِّد نمط + علامة بشرة.
    // حذف الصورة وحدها يترك وراءه محارف غير مرئية تربك النطق، فنحذف السلسلة كاملة.
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** whisper يستدل على الصيغة من الامتداد، فنشتق امتداداً مناسباً من نوع المحتوى. */
function fileNameFor(mime: string): string {
  const ext =
    mime.includes("ogg") ? "ogg"
    : mime.includes("mpeg") || mime.includes("mp3") ? "mp3"
    : mime.includes("mp4") || mime.includes("m4a") ? "m4a"
    : mime.includes("wav") ? "wav"
    : mime.includes("webm") ? "webm"
    : mime.includes("amr") ? "amr"
    : "ogg";
  return `voice.${ext}`;
}
