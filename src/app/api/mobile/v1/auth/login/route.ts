import { z } from "zod";
import { json, readBody, route } from "@/lib/mobile/http";
import { loginDevice } from "@/lib/mobile/auth";
import { clientIpKey } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// اسم الجهاز للعرض في «أجهزتي» فقط — نقصّه بدل رفض الدخول بسببه
const clip = (v: string, n: number) => Array.from(v).slice(0, n).join("");

const Body = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
  device: z.object({
    // max قبل القصّ: القصّ يمرّ على المحارف كلها، ولا داعي لأن يمرّ على
    // ميغابايت أرسلها أحد ليرى ماذا يحدث
    name: z.string().trim().min(1).max(500).transform((v) => clip(v, 100)),
    platform: z.enum(["ios", "android"]),
  }),
});

/** POST /auth/login — انظر docs/mobile-api.md */
export const POST = route(async (req) => {
  const body = await readBody(req, Body);
  // x-real-ip وحده — انظر lib/ip.ts لماذا لا x-forwarded-for
  return json(await loginDevice(body, clientIpKey(req.headers)));
});
