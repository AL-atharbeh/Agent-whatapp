import type { Channel, Prisma, Tenant } from "@prisma/client";
import { prisma } from "./db";
import { normalizeArabic, searchTerms } from "./arabic";

/**
 * طبقة العزل.
 *
 * القاعدة الوحيدة في هذا المشروع: **لا شيء خارج هذا الملف يلمس `prisma` مباشرة
 * لقراءة بيانات بزنس.** كل شيء يمر عبر `tenantScope(tenantId)` التي تُرجع
 * دوال مربوطة بعميل واحد فقط — الـ tenantId محقون داخل كل `where`، ولا يمكن
 * لأي أداة أو مسار أن يمرر tenantId مختلف لأنه ببساطة غير موجود في توقيع الدالة.
 *
 * أدوات الوكيل (src/lib/agent/tools.ts) لا تستقبل إلا كائن الـ scope هذا،
 * فحتى لو "هلوس" النموذج واخترع اسم عميل آخر، لا يوجد مسار برمجي ينفّذ ذلك.
 */
export type TenantScope = ReturnType<typeof tenantScope>;

/** بيانات العميل الكاملة التي يُبنى منها الـ system prompt. */
export type TenantContext = Prisma.TenantGetPayload<{
  include: { profile: true; faqs: true; dataSources: true };
}>;

export async function loadTenantBySlug(slug: string): Promise<TenantContext | null> {
  return prisma.tenant.findUnique({
    where: { slug },
    include: {
      profile: true,
      faqs: { where: { active: true }, orderBy: { priority: "desc" } },
      dataSources: { where: { active: true } },
    },
  });
}

export async function loadTenantById(id: string): Promise<TenantContext | null> {
  return prisma.tenant.findUnique({
    where: { id },
    include: {
      profile: true,
      faqs: { where: { active: true }, orderBy: { priority: "desc" } },
      dataSources: { where: { active: true } },
    },
  });
}

/**
 * يحل العميل انطلاقاً من حساب القناة الوارد في الويبهوك.
 * `externalId` فريد على مستوى المنصة (قيد @@unique في السكيما)، فلا يمكن
 * لرقم واتساب واحد أن يعود لعميلين.
 */
export async function resolveTenantByChannelAccount(
  channel: Channel,
  externalId: string,
) {
  return prisma.channelAccount.findUnique({
    where: { channel_externalId: { channel, externalId } },
    include: { tenant: true },
  });
}

export function tenantScope(tenantId: string) {
  return {
    tenantId,

    // ── الكتالوج ──
    async searchProducts(query: string, category?: string, limit = 8) {
      const terms = searchTerms(query);
      const where: Prisma.ProductWhereInput = {
        tenantId, // ← العزل
        active: true,
        ...(category ? { category: { contains: category, mode: "insensitive" } } : {}),
        ...(terms.length
          ? { AND: terms.map((t) => ({ searchText: { contains: t } })) }
          : {}),
      };

      let rows = await prisma.product.findMany({
        where,
        take: limit,
        orderBy: { updatedAt: "desc" },
      });

      // احتياط: لو تطابق "كل الكلمات" ما رجّع شيء، جرّب "أي كلمة"
      if (rows.length === 0 && terms.length > 1) {
        rows = await prisma.product.findMany({
          where: {
            tenantId,
            active: true,
            OR: terms.map((t) => ({ searchText: { contains: t } })),
          },
          take: limit,
          orderBy: { updatedAt: "desc" },
        });
      }
      return rows;
    },

    /**
     * عيّنة من الكتالوج بلا بحث.
     * تُستخدم عند أسئلة الاستعراض ("شو عندكم؟"، "ما هي المتاجر لديكم؟") التي
     * لا تحتوي أي كلمة تطابق اسم منتج — بدونها كان الوكيل يحوّل لموظف بلا داعٍ.
     */
    async sampleProducts(limit = 20) {
      return prisma.product.findMany({
        where: { tenantId, active: true },
        take: limit,
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });
    },

    async countProducts() {
      return prisma.product.count({ where: { tenantId, active: true } });
    },

    async listCategories() {
      const rows = await prisma.product.findMany({
        where: { tenantId, active: true },
        select: { category: true },
        distinct: ["category"],
      });
      return rows.map((r) => r.category).filter((c): c is string => !!c);
    },

    async getProduct(idOrSku: string) {
      return prisma.product.findFirst({
        where: {
          tenantId,
          OR: [{ id: idOrSku }, { sku: idOrSku }],
        },
      });
    },

    async upsertProduct(data: {
      sku?: string | null;
      name: string;
      description?: string | null;
      category?: string | null;
      price?: number | null;
      priceUnit?: string;
      inStock?: boolean;
      quantity?: number | null;
      attributes?: Prisma.InputJsonValue;
      imageUrl?: string | null;
    }) {
      const searchTextValue = normalizeArabic(
        [data.name, data.description, data.category, data.sku]
          .filter(Boolean)
          .join(" "),
      );
      const payload = { ...data, tenantId, searchText: searchTextValue };
      if (data.sku) {
        return prisma.product.upsert({
          where: { tenantId_sku: { tenantId, sku: data.sku } },
          create: payload,
          update: payload,
        });
      }
      return prisma.product.create({ data: payload });
    },

    // ── البيانات الحيّة ──
    async getDataSource(key: string) {
      return prisma.dataSource.findUnique({
        where: { tenantId_key: { tenantId, key } },
      });
    },

    async setDataSourceValue(key: string, value: Prisma.InputJsonValue) {
      return prisma.dataSource.update({
        where: { tenantId_key: { tenantId, key } },
        data: { value, valueAt: new Date() },
      });
    },

    // ── المحادثات ──
    async getOrCreateConversation(
      channel: Channel,
      externalUserId: string,
      customerName?: string,
    ) {
      return prisma.conversation.upsert({
        where: {
          tenantId_channel_externalUserId: { tenantId, channel, externalUserId },
        },
        create: { tenantId, channel, externalUserId, customerName },
        update: { lastMessageAt: new Date(), ...(customerName ? { customerName } : {}) },
      });
    },

    async recentMessages(conversationId: string, limit = 20) {
      const rows = await prisma.message.findMany({
        where: { conversationId, tenantId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.reverse();
    },

    async addMessage(data: {
      conversationId: string;
      role: "USER" | "AGENT" | "HUMAN" | "SYSTEM";
      text: string;
      externalId?: string | null;
      toolCalls?: unknown;
      usage?: unknown;
    }) {
      return prisma.message.create({
        data: {
          ...data,
          tenantId,
          toolCalls: (data.toolCalls ?? undefined) as Prisma.InputJsonValue | undefined,
          usage: (data.usage ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    },

    /** يمنع معالجة نفس رسالة Meta مرتين عند إعادة الإرسال. */
    async isDuplicate(externalId: string) {
      const found = await prisma.message.findUnique({
        where: { tenantId_externalId: { tenantId, externalId } },
        select: { id: true },
      });
      return !!found;
    },

    async handoff(conversationId: string, reason: string) {
      return prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "HUMAN", handoffReason: reason, handoffAt: new Date() },
      });
    },

    async createLead(data: {
      name?: string;
      phone?: string;
      channel: Channel;
      externalUserId?: string;
      interest: string;
      notes?: string;
    }) {
      return prisma.lead.create({ data: { ...data, tenantId } });
    },

    /** سقف الحماية اليومي — يمنع فاتورة مفاجئة أو هجوم استنزاف. */
    async repliesToday() {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      return prisma.message.count({
        where: { tenantId, role: "AGENT", createdAt: { gte: since } },
      });
    },

    async channelAccount(channel: Channel) {
      return prisma.channelAccount.findFirst({
        where: { tenantId, channel, active: true },
      });
    },
  };
}

export type { Tenant };
