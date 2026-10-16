import type { Channel } from "@prisma/client";

/**
 * كيف يُعرض العميل — مشترك بين اللوحة والجوال، وبلا اعتماديات تشغيلية.
 */

/**
 * اسم بلا حرف ولا رقم («.»، «…») ليس اسماً.
 *
 * واتساب يعطي الاسم المعروض كما كتبه صاحبه، وكثيرون يضعون نقطة ليخفوه.
 * عرضها كاسم يجعل السطر يبدو فارغاً أو مكسوراً، والرقم بعدها أنفع.
 */
export function displayName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed && /[\p{L}\p{N}]/u.test(trimmed) ? trimmed : null;
}

/** واتساب: الرقم بعلامة + ليُنسخ ويُتّصل به مباشرة. غيره: المعرّف كما هو. */
export function displayId(channel: Channel, externalUserId: string): string {
  return channel === "WHATSAPP" ? `+${externalUserId}` : externalUserId;
}
