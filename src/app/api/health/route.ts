import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * تشخيص النشر: يخبرك أي متغيّر بيئة ناقص وهل قاعدة البيانات متصلة.
 * لا يكشف أي قيمة — فقط موجود/ناقص.
 *
 * افتح: https://<دومينك>/api/health
 */

const REQUIRED = ["DATABASE_URL", "DIRECT_URL", "ENCRYPTION_KEY", "APP_BASE_URL"];

export async function GET() {
  const provider = (process.env.AGENT_PROVIDER || "anthropic").toLowerCase();
  const providerKey = provider === "groq" ? "GROQ_API_KEY" : "ANTHROPIC_API_KEY";

  const env: Record<string, boolean> = {};
  for (const k of [...REQUIRED, providerKey]) {
    env[k] = !!process.env[k]?.trim();
  }

  // ENCRYPTION_KEY يجب أن يكون 64 حرف hex بالضبط
  const encValid = (process.env.ENCRYPTION_KEY ?? "").length === 64;

  let database: { ok: boolean; tenants?: number; error?: string };
  try {
    const tenants = await prisma.tenant.count();
    database = { ok: true, tenants };
  } catch (err) {
    database = {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 200) : "خطأ غير معروف",
    };
  }

  const missing = Object.entries(env)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);

  const ok = missing.length === 0 && encValid && database.ok;

  return NextResponse.json(
    {
      ok,
      provider,
      env,
      encryption_key_valid_length: encValid,
      database,
      missing,
      next_step: ok
        ? "كل شي سليم."
        : missing.length
          ? `أضف هذه المتغيّرات في إعدادات النشر ثم أعد النشر: ${missing.join(", ")}`
          : !encValid
            ? "ENCRYPTION_KEY يجب أن يكون 64 حرف hex — ولّده بـ: openssl rand -hex 32"
            : "المتغيّرات موجودة لكن الاتصال بقاعدة البيانات فشل — راجع رسالة الخطأ أعلاه.",
    },
    { status: ok ? 200 : 503 },
  );
}
