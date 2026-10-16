import crypto from "node:crypto";

/**
 * توقيع JWT بـ RS256 لمبادلته برمز OAuth2 من Google.
 *
 * منفصل عن push.ts ليُختبر بمفتاح محلي دون شبكة ولا قاعدة: خطأ في ترميز
 * الأجزاء لا يظهر إلا كرفض 400 غامض من Google في الإنتاج.
 */
export function signServiceJwt(args: {
  clientEmail: string;
  privateKey: string;
  scope: string;
  audience: string;
  nowSeconds: number;
}): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: args.clientEmail,
    scope: args.scope,
    aud: args.audience,
    iat: args.nowSeconds,
    // ساعة هي أقصى ما تقبله Google
    exp: args.nowSeconds + 3600,
  })}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(args.privateKey)
    .toString("base64url");
  return `${unsigned}.${signature}`;
}
