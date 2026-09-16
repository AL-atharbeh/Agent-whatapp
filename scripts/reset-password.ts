import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

/**
 * يعيد تعيين كلمة سر أي حساب — مالك منصة أو صاحب متجر.
 *
 *   npm run password
 *
 * كلمات السر مخزَّنة كهاش PBKDF2 باتجاه واحد، فالقديمة غير قابلة للقراءة؛
 * المتاح هو الاستبدال فقط.
 */

const MIN = 8;

const ENTER = ["\r", "\n"];
const CTRL_C = String.fromCharCode(3);
const BACKSPACE = [String.fromCharCode(127), String.fromCharCode(8)];

/**
 * يقرأ سطراً دون طباعته. نستخدم الوضع الخام ونتولّى الصدى بأنفسنا،
 * لأن اعتراض _writeToOutput في readline غير موثوق عبر إصدارات Node —
 * وهو ما سرّب كلمة السر على الشاشة في النسخة السابقة.
 */
function askHidden(question: string): Promise<string> {
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
            stdout.write("[D [D"); // امسح النقطة الأخيرة
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
const toAscii = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, tenant: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (users.length === 0) {
    console.error("\n⚠️  لا يوجد حسابات — أنشئ حساباً بـ: npm run admin\n");
    return;
  }

  console.log("\nالحسابات المسجّلة:");
  users.forEach((u, i) => {
    const role =
      u.role === "PLATFORM_ADMIN" ? "مالك المنصة" : `متجر: ${u.tenant?.name ?? "—"}`;
    console.log(`  ${i + 1}) ${u.email}  —  ${role}`);
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const pick = (await rl.question("\nالرقم أو البريد: ")).trim();
  rl.close();

  const idx = Number(toAscii(pick));
  const user =
    Number.isInteger(idx) && idx >= 1 && idx <= users.length
      ? users[idx - 1]
      : users.find((u) => u.email.toLowerCase() === pick.toLowerCase());

  if (!user) {
    console.error("\n❌ اختيار غير صالح — لم يتغيّر شيء\n");
    return;
  }

  console.log(`\nتغيير كلمة سر: ${user.email}`);
  console.log(`الشرط: ${MIN} أحرف فأكثر. الكتابة مخفيّة وتظهر كنجوم.\n`);

  // نعيد السؤال بدل الخروج عند الخطأ — حتى لا تُكتب كلمة السر
  // في سطر الأوامر بعد انتهاء السكربت (وتنحفظ في سجل الأوامر).
  let password = "";
  for (let attempt = 1; ; attempt++) {
    if (attempt > 3) {
      console.error("\n❌ محاولات كثيرة — لم يتغيّر شيء\n");
      return;
    }
    const first = (await askHidden("كلمة السر الجديدة: ")).trim();
    if (first.length < MIN) {
      console.error(`⚠️  قصيرة (${first.length} من ${MIN}) — جرّب مرة ثانية\n`);
      continue;
    }
    const again = (await askHidden("أعد كتابتها للتأكيد: ")).trim();
    if (first !== again) {
      console.error("⚠️  الكلمتان غير متطابقتين — جرّب مرة ثانية\n");
      continue;
    }
    password = first;
    break;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });

  console.log(`\n✅ تغيّرت كلمة سر ${user.email}`);
  console.log(`   سجّل الدخول: ${process.env.APP_BASE_URL ?? "http://localhost:3000"}/login\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
