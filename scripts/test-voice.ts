import assert from "node:assert/strict";
import {
  DEFAULT_VOICE_MODEL,
  assistantOverrides,
  defaultFirstMessage,
  normalizeE164,
  voiceSettingsOf,
} from "../src/lib/voice/settings";

/**
 * اختبارات صوت المكالمات لكل متجر — منطق صافٍ بلا قاعدة ولا شبكة.
 *
 *   npx tsx scripts/test-voice.ts
 */

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

test("normalizeE164: الصيغ كما تُنسخ ⇒ +دولي، والتالف null", () => {
  assert.equal(normalizeE164("+962 6 555 1234"), "+96265551234");
  assert.equal(normalizeE164("0096265551234"), "+96265551234");
  assert.equal(normalizeE164("96265551234"), "+96265551234");
  assert.equal(normalizeE164("+1 401 498 4091"), "+14014984091");
  assert.equal(normalizeE164("abc"), null);
  assert.equal(normalizeE164(""), null);
});

test("voiceSettingsOf: قيم تالفة تسقط لافتراضيّها ولا تُسقط المكالمة", () => {
  const s = voiceSettingsOf({ voiceId: "bad id!", voiceModel: "gpt", firstMessage: "  ", vapiPhoneNumberId: 5 });
  assert.equal(s.voiceId, null);
  assert.equal(s.voiceModel, DEFAULT_VOICE_MODEL);
  assert.equal(s.firstMessage, null);
  assert.equal(s.vapiPhoneNumberId, null);
  assert.deepEqual(voiceSettingsOf(null), voiceSettingsOf({}));
  assert.equal(voiceSettingsOf({ voiceModel: "eleven_flash_v2_5" }).voiceModel, "eleven_flash_v2_5");
});

const t = { slug: "lush", agentName: "لمى", name: "صالون لاش" };

test("assistantOverrides: صوت المتجر وجملته ورابط وكيله", () => {
  const o = assistantOverrides(t, voiceSettingsOf({ voiceId: "6ZvbKYJmZfL6zVBzLwpV", firstMessage: "هلا" }), "https://h.example/");
  assert.equal(o.firstMessage, "هلا");
  assert.deepEqual(o.voice, { provider: "11labs", voiceId: "6ZvbKYJmZfL6zVBzLwpV", model: DEFAULT_VOICE_MODEL });
  assert.equal(o.model.url, "https://h.example/api/voice/lush", "بلا شرطتين");
  assert.equal(o.model.provider, "custom-llm");
});

test("assistantOverrides: بلا صوت ⇒ صوت المساعد الافتراضي، والجملة من اسم الوكيل والمتجر", () => {
  const o = assistantOverrides(t, voiceSettingsOf({}), "https://h.example");
  assert.equal("voice" in o, false);
  assert.equal(o.firstMessage, defaultFirstMessage(t));
  assert.match(o.firstMessage, /لمى/);
  assert.match(o.firstMessage, /صالون لاش/);
});

if (failures.length) {
  console.log(failures.join("\n\n"));
  console.log(`\n${passed} نجح، ${failures.length} فشل`);
  process.exit(1);
}
console.log(`✅ ${passed} اختبارات نجحت`);
