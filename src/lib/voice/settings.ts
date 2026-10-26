/**
 * صوت المكالمات لكل متجر — الصوت والجملة الأولى ورقم المكالمات.
 *
 * منصة المكالمات (Vapi) فيها مساعد واحد للمنصة كلها. حين تصلها مكالمة تسأل
 * حاضر «لمن هذا الرقم؟» (assistant-request) فيردّ بإعدادات المتجر: صوته،
 * وجملته الأولى، ورابط وكيله. فمتجر جديد بصوت مختلف لا يحتاج فتح Vapi.
 *
 * الحقل Json يكتبه مالك المنصة؛ قيمة تالفة فيه تسقط لافتراضيّها دون أن تُسقط
 * المكالمة — صوت افتراضي أهون من خط لا يُجيب.
 */

export const VOICE_MODELS = ["eleven_multilingual_v2", "eleven_flash_v2_5"] as const;
export type VoiceModel = (typeof VOICE_MODELS)[number];

/** الأوضح صوتاً، وأبطأ بربع ثانية تقريباً من flash. */
export const DEFAULT_VOICE_MODEL: VoiceModel = "eleven_multilingual_v2";

/**
 * أصوات جاهزة للاختيار — معرّفات ElevenLabs. صوت خارجها يُكتب بمعرّفه.
 * أصوات «المكتبة» يجب أن تُضاف لحساب ElevenLabs المربوط بمنصة المكالمات
 * (Add to my voices) وإلا رفضتها المنصة.
 */
export const VOICE_CATALOG: { id: string; name: string; gender: "female" | "male" }[] = [
  { id: "6ZvbKYJmZfL6zVBzLwpV", name: "Lina — شابة، أسلوب محادثة (أردنية)", gender: "female" },
];

export type VoiceSettings = {
  voiceId: string | null;
  voiceName: string | null;
  voiceModel: VoiceModel;
  firstMessage: string | null;
  /** رقم Vapi لعناوين SIP التي لا رقم E.164 لها — بديل عن voicePhone في المطابقة */
  vapiPhoneNumberId: string | null;
};

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null;

export function voiceSettingsOf(raw: unknown): VoiceSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const model = VOICE_MODELS.find((m) => m === o.voiceModel) ?? DEFAULT_VOICE_MODEL;
  const voiceId = str(o.voiceId, 64);
  return {
    // معرّف ElevenLabs حروف وأرقام — غيره خطأ نسخ يرفضه المزوّد في منتصف المكالمة
    voiceId: voiceId && /^[A-Za-z0-9_-]+$/.test(voiceId) ? voiceId : null,
    voiceName: str(o.voiceName, 80),
    voiceModel: model,
    firstMessage: str(o.firstMessage, 300),
    vapiPhoneNumberId: str(o.vapiPhoneNumberId, 64),
  };
}

export function defaultFirstMessage(t: { agentName: string; name: string }): string {
  return `أهلاً، معك ${t.agentName} من ${t.name}، كيف بقدر أساعدك؟`;
}

/**
 * رقم بصيغة E.164 («+9626…»)، أو null. يقبل «00» والمسافات والشرطات كما
 * يُنسخ من أي مكان؛ المطابقة مع رقم المنصة يجب أن تكون حرفية.
 */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.trim().replace(/[\s()-]/g, "");
  if (d.startsWith("00")) d = `+${d.slice(2)}`;
  if (!d.startsWith("+")) d = `+${d}`;
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
}

/**
 * ما يُرسَل لمنصة المكالمات فوق المساعد المشترك: الصوت والجملة الأولى ورابط
 * وكيل هذا المتجر. النسخ (Transcriber) والإعدادات الأخرى تبقى من المساعد.
 */
export function assistantOverrides(
  t: { slug: string; agentName: string; name: string },
  s: VoiceSettings,
  baseUrl: string,
) {
  return {
    firstMessage: s.firstMessage ?? defaultFirstMessage(t),
    ...(s.voiceId
      ? { voice: { provider: "11labs", voiceId: s.voiceId, model: s.voiceModel } }
      : {}),
    model: {
      provider: "custom-llm",
      url: `${baseUrl.replace(/\/$/, "")}/api/voice/${t.slug}`,
      model: "hader",
      // بلا هذا لا يصل رقم المتصل لنقطة الوكيل، فلا يُعرف العميل ولا يُحجز باسمه
      metadataSendMode: "destructured",
    },
  };
}
