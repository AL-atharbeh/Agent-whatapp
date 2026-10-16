import { prisma } from "../src/lib/db";

/**
 * يملأ Conversation.lastInboundAt للمحادثات الموجودة قبل إضافة العمود.
 *
 *   npx tsx --env-file=.env scripts/backfill-last-inbound.ts
 *
 * يُشغَّل مرة واحدة بعد تطبيق السكيما. بدونه كل محادثة قديمة تبدو بلا
 * رسالة عميل: نافذتها مغلقة (فيُرفض رد الجوال وهي مفتوحة عند Meta)،
 * ولا تظهر في عدّاد «غير مقروء» في الملخّص.
 *
 * آمن للتكرار: لا يلمس إلا ما بقي فارغاً، والقيمة مشتقّة من الرسائل نفسها.
 */
async function main() {
  const n = await prisma.$executeRaw`
    UPDATE "Conversation" c
    SET "lastInboundAt" = m.last
    FROM (
      SELECT "conversationId", MAX("createdAt") AS last
      FROM "Message"
      WHERE role = 'USER'
      GROUP BY "conversationId"
    ) m
    WHERE m."conversationId" = c.id AND c."lastInboundAt" IS NULL`;
  console.log(`✅ عُبّئت ${n} محادثة`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
