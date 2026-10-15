import { stdin, stdout } from "node:process";

/**
 * إدخال الطرفية المشترك بين سكربتات الحسابات.
 *
 * كان `askHidden` منسوخاً في أكثر من سكربت. ونسخةٌ من قراءة كلمة سر ليست
 * تكراراً عادياً: إصلاح تسريبٍ في إحداها يترك الأخرى تسرّب — وقد حدث ذلك
 * فعلاً حين ظهرت كلمة السر على الشاشة في نسخة سابقة.
 */

const ENTER = ["\r", "\n"];
const CTRL_C = String.fromCharCode(3);
const BACKSPACE = [String.fromCharCode(127), String.fromCharCode(8)];

/**
 * يقرأ سطراً دون طباعته. نستخدم الوضع الخام ونتولّى الصدى بأنفسنا،
 * لأن اعتراض `_writeToOutput` في readline غير موثوق عبر إصدارات Node.
 */
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error("لا يمكن إخفاء الإدخال خارج الطرفية"));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();

    let buf = "";
    const done = (value: string | null) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (value === null) process.exit(130);
      resolve(value);
    };

    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ENTER.includes(ch)) return done(buf);
        if (ch === CTRL_C) return done(null);
        if (BACKSPACE.includes(ch)) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            stdout.write("\x1b[D \x1b[D"); // امسح النجمة الأخيرة
          }
          continue;
        }
        if (ch < " ") continue; // تجاهل بقية أحرف التحكم
        buf += ch;
        stdout.write("*"); // نجمة بدل الحرف — ليعرف المستخدم أن الكتابة تصل
      }
    };

    stdin.on("data", onData);
  });
}

/** يحوّل الأرقام العربية إلى إنجليزية — الكيبورد العربي يكتبها افتراضياً. */
export const toAscii = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/**
 * يسأل عن كلمة سر مرتين حتى تتطابق وتستوفي الطول.
 *
 * يعيد السؤال بدل الخروج عند الخطأ: الخروج يدفع المستخدم لإعادة تشغيل
 * السكربت بكلمة السر مكتوبةً في سطر الأوامر — فتُحفَظ في سجل الأوامر.
 */
export async function askNewPassword(min = 8, tries = 3): Promise<string | null> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const first = (await askHidden("كلمة السر: ")).trim();
    if (first.length < min) {
      console.error(`⚠️  قصيرة (${first.length} من ${min}) — جرّب مرة ثانية\n`);
      continue;
    }
    const again = (await askHidden("أعد كتابتها للتأكيد: ")).trim();
    if (first !== again) {
      console.error("⚠️  الكلمتان غير متطابقتين — جرّب مرة ثانية\n");
      continue;
    }
    return first;
  }
  return null;
}
