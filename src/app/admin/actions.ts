"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Channel, DataSourceKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tenantScope } from "@/lib/tenancy";
import { authorizeTenant, getSession, requireAdmin } from "@/lib/session";
import { normalizeArabic } from "@/lib/arabic";
import { ALL_CHANNELS, getPlan, planAllowsChannel } from "@/lib/plans";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  createTemplate,
  listTemplates,
  renderTemplate,
  sendMessage,
  sendTemplate,
} from "@/lib/channels/meta";

/**
 * إجراءات إدارة المتاجر — يستخدمها مالك المنصة وأصحاب المتاجر معاً.
 *
 * ⚠️ الأمان هنا لا يعتمد على middleware: server actions تُستدعى مباشرة عبر
 * HTTP ولا تمر بكل فحوصه. لذلك كل إجراء يمر بـ authorizeTenant الذي يتحقّق
 * من الجلسة الموقّعة — صاحب المتجر لا يعدّل إلا متجره مهما زوّر الحقول.
 *
 * الإجراءات الحسّاسة (إنشاء/حذف متجر، القنوات، التفعيل) محصورة بـ requireAdmin.
 */

const s = (v: FormDataEntryValue | null) => {
  const t = v?.toString().trim();
  return t ? t : null;
};
const n = (v: FormDataEntryValue | null) => {
  const t = s(v);
  if (t === null) return null;
  const num = Number(t);
  return Number.isFinite(num) ? num : null;
};

function parseJson(v: FormDataEntryValue | null): Prisma.InputJsonValue | undefined {
  const t = s(v);
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    throw new Error("حقل الخصائص ليس JSON صالحاً");
  }
}

// ═══════════════════════════════════════════════════════════
//  العملاء (البزنسات)
// ═══════════════════════════════════════════════════════════

export async function createTenant(formData: FormData) {
  await requireAdmin();

  const slug = s(formData.get("slug"));
  const name = s(formData.get("name"));
  if (!slug || !name) throw new Error("الاسم والمعرّف مطلوبان");

  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    throw new Error("المعرّف يجب أن يكون حروفاً إنجليزية صغيرة وأرقاماً وشرطات فقط");
  }

  const exists = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (exists) throw new Error("هذا المعرّف مستخدم من قبل");

  await prisma.tenant.create({
    data: {
      slug,
      name,
      businessType: s(formData.get("businessType")) ?? "other",
      agentName: s(formData.get("agentName")) ?? "المساعد",
      currency: s(formData.get("currency")) ?? "JOD",
      profile: {
        create: {
          about: s(formData.get("about")),
          address: s(formData.get("address")),
          phone: s(formData.get("phone")),
          workingHours: s(formData.get("workingHours")),
        },
      },
    },
  });

  revalidatePath("/admin");
  redirect(`/admin/${slug}`);
}

export async function updateTenant(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const tenantId = await authorizeTenant(slug);
  const session = await getSession();
  const isAdmin = session?.role === "PLATFORM_ADMIN";

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: s(formData.get("name")) ?? undefined,
      businessType: s(formData.get("businessType")) ?? undefined,
      agentName: s(formData.get("agentName")) ?? undefined,
      tone: s(formData.get("tone")) ?? undefined,
      currency: s(formData.get("currency")) ?? undefined,
      locale: s(formData.get("locale")) ?? undefined,
      timezone: s(formData.get("timezone")) ?? undefined,
      customPolicy: s(formData.get("customPolicy")),
      handoffKeywords: (s(formData.get("handoffKeywords")) ?? "")
        .split(/[,،\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
      voiceReplies: formData.get("voiceReplies") !== null,

      // إعدادات التكلفة والتفعيل بيد مالك المنصة وحده: صاحب المتجر لا يرفع
      // سقف الإنفاق ولا يفعّل اشتراكه بنفسه.
      ...(isAdmin
        ? {
            modelId: s(formData.get("modelId")) ?? undefined,
            effort: s(formData.get("effort")) ?? undefined,
            maxRepliesPerDay: n(formData.get("maxRepliesPerDay")) ?? undefined,
            status: (s(formData.get("status")) ?? "ACTIVE") as
              | "ACTIVE"
              | "PAUSED"
              | "SUSPENDED",
          }
        : {}),
    },
  });

  revalidatePath(`/admin/${slug}`);
  revalidatePath("/app");
}

export async function updateProfile(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const tenantId = await authorizeTenant(slug);

  const data = {
    about: s(formData.get("about")),
    address: s(formData.get("address")),
    mapsUrl: s(formData.get("mapsUrl")),
    phone: s(formData.get("phone")),
    workingHours: s(formData.get("workingHours")),
    deliveryPolicy: s(formData.get("deliveryPolicy")),
    returnPolicy: s(formData.get("returnPolicy")),
    paymentMethods: s(formData.get("paymentMethods")),
    websiteUrl: s(formData.get("websiteUrl")),
  };

  await prisma.businessProfile.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });

  revalidatePath(`/admin/${slug}`);
}

export async function deleteTenant(formData: FormData) {
  await requireAdmin();
  const slug = s(formData.get("slug"))!;
  await prisma.tenant.delete({ where: { slug } });
  revalidatePath("/admin");
  redirect("/admin");
}

// ═══════════════════════════════════════════════════════════
//  المنتجات
// ═══════════════════════════════════════════════════════════

/**
 * يتحقّق أن إضافة `adding` منتجاً لا تتجاوز حد الباقة.
 *
 * كان `maxProducts` معروضاً في اللوحة ومكتوباً في الباقة ولا يُفحص في أي
 * مكان — أي أنك تسعّر على فرقٍ غير موجود. التعديل لا يُحسب (لا يزيد العدد)،
 * والمتجر بلا باقة لا يُقيَّد (مالك المنصة يدخله يدوياً).
 */
async function assertProductQuota(tenantId: string, adding: number) {
  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { plan: true },
  });
  if (!t.plan) return;

  const plan = await getPlan(t.plan);
  if (!plan) return;

  const current = await prisma.product.count({ where: { tenantId } });
  if (current + adding > plan.maxProducts) {
    throw new Error(
      `باقة «${plan.name}» تسمح بـ ${plan.maxProducts} منتج، وعندك ${current}. ` +
        `ارفع الباقة أو احذف منتجات أولاً.`,
    );
  }
}

export async function saveProduct(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"));
  const tenantId = await authorizeTenant(slug);

  if (!id) await assertProductQuota(tenantId, 1);

  const name = s(formData.get("name"));
  if (!name) throw new Error("اسم المنتج مطلوب");

  const description = s(formData.get("description"));
  const category = s(formData.get("category"));
  const sku = s(formData.get("sku"));

  const data = {
    tenantId,
    sku,
    name,
    description,
    category,
    price: n(formData.get("price")),
    priceUnit: s(formData.get("priceUnit")) ?? "piece",
    inStock: formData.get("inStock") === "on",
    quantity: n(formData.get("quantity")),
    attributes: parseJson(formData.get("attributes")),
    imageUrl: s(formData.get("imageUrl")),
    active: formData.get("active") === "on",
    // نص البحث المُطبّع يُبنى هنا — بدونه لن يجد الوكيل المنتج
    searchText: normalizeArabic([name, description, category, sku].filter(Boolean).join(" ")),
  };

  if (id) {
    // نتحقّق أن المنتج يخصّ هذا العميل قبل التعديل
    await prisma.product.update({ where: { id, tenantId }, data });
  } else {
    await prisma.product.create({ data });
  }

  revalidatePath(`/admin/${slug}/products`);
}

/**
 * استيراد سريع: سطر لكل عنصر بصيغة
 *   الاسم | الصنف | السعر | الوصف
 * الحقول بعد الاسم اختيارية. مفيد لإدخال كتالوج كامل دفعة واحدة.
 */
export async function bulkImportProducts(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const raw = s(formData.get("bulk"));
  if (!raw) throw new Error("الصق قائمة أولاً");

  const tenantId = await authorizeTenant(slug);

  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, category, price, description] = line.split("|").map((x) => x?.trim() || "");
      return { name, category, price, description };
    })
    .filter((r) => r.name);

  if (rows.length === 0) throw new Error("لم أجد أي سطر صالح");

  // الاستيراد الجماعي هو المسار الأخطر للتجاوز: سطر واحد أو ألف بنفس الضغطة
  await assertProductQuota(tenantId, rows.length);

  await prisma.product.createMany({
    data: rows.map((r) => ({
      tenantId,
      name: r.name,
      category: r.category || null,
      price: r.price && Number.isFinite(Number(r.price)) ? Number(r.price) : null,
      description: r.description || null,
      searchText: normalizeArabic([r.name, r.description, r.category].filter(Boolean).join(" ")),
    })),
  });

  revalidatePath(`/admin/${slug}/products`);
}

export async function deleteProduct(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenantId = await authorizeTenant(slug);
  await prisma.product.delete({ where: { id, tenantId } });
  revalidatePath(`/admin/${slug}/products`);
}

// ═══════════════════════════════════════════════════════════
//  الأسئلة الشائعة
// ═══════════════════════════════════════════════════════════

export async function saveFaq(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"));
  const tenantId = await authorizeTenant(slug);

  const question = s(formData.get("question"));
  const answer = s(formData.get("answer"));
  if (!question || !answer) throw new Error("السؤال والجواب مطلوبان");

  const data = {
    tenantId,
    question,
    answer,
    priority: n(formData.get("priority")) ?? 0,
    active: formData.get("active") === "on",
  };

  if (id) await prisma.faq.update({ where: { id, tenantId }, data });
  else await prisma.faq.create({ data });

  revalidatePath(`/admin/${slug}/faqs`);
}

export async function deleteFaq(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenantId = await authorizeTenant(slug);
  await prisma.faq.delete({ where: { id, tenantId } });
  revalidatePath(`/admin/${slug}/faqs`);
}

// ═══════════════════════════════════════════════════════════
//  مصادر البيانات الحيّة
// ═══════════════════════════════════════════════════════════

export async function saveDataSource(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"));
  const tenantId = await authorizeTenant(slug);

  const key = s(formData.get("key"));
  const label = s(formData.get("label"));
  if (!key || !label) throw new Error("المفتاح والوصف مطلوبان");

  const value = parseJson(formData.get("value"));

  const data = {
    tenantId,
    key,
    label,
    kind: (s(formData.get("kind")) ?? "MANUAL") as DataSourceKind,
    config: parseJson(formData.get("config")),
    staleAfterMinutes: n(formData.get("staleAfterMinutes")) ?? 720,
    active: formData.get("active") === "on",
    // كل حفظ للقيمة يجدّد الطابع الزمني — وهو ما يحدّد إن كانت "طازجة" أم لا
    ...(value !== undefined ? { value, valueAt: new Date() } : {}),
  };

  if (id) await prisma.dataSource.update({ where: { id, tenantId }, data });
  else await prisma.dataSource.create({ data });

  revalidatePath(`/admin/${slug}/data`);
}

export async function deleteDataSource(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenantId = await authorizeTenant(slug);
  await prisma.dataSource.delete({ where: { id, tenantId } });
  revalidatePath(`/admin/${slug}/data`);
}

// ═══════════════════════════════════════════════════════════
//  القنوات
// ═══════════════════════════════════════════════════════════

export async function saveChannel(formData: FormData) {
  await requireAdmin(); // مفاتيح Meta بيد مالك المنصة وحده
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"));
  const tenantId = await authorizeTenant(slug);

  const externalId = s(formData.get("externalId"));
  if (!externalId) throw new Error("معرّف الحساب مطلوب");

  const channel = (s(formData.get("channel")) ?? "WHATSAPP") as Channel;

  // القناة خارج الباقة كانت تُقبل هنا ثم تُرفض عند أول رسالة — بصمت.
  // النتيجة: ساعة عمل على رموز Meta، ثم رسائل تتبخّر بلا تحذير. نرفض الآن.
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { plan: true },
  });
  if (!(await planAllowsChannel(tenant.plan, channel))) {
    const label = ALL_CHANNELS.find((c) => c.value === channel)?.label ?? channel;
    throw new Error(
      `قناة «${label}» خارج باقة هذا المتجر. غيّر الباقة أو أضف القناة إليها أولاً.`,
    );
  }

  const token = s(formData.get("accessToken"));
  const secret = s(formData.get("appSecret"));

  const data = {
    tenantId,
    channel,
    externalId,
    displayName: s(formData.get("displayName")),
    verifyToken: s(formData.get("verifyToken")),
    active: formData.get("active") === "on",
    // المفاتيح تُشفّر قبل التخزين؛ حقل فارغ = أبقِ القيمة القديمة
    ...(token ? { accessTokenEnc: encrypt(token) } : {}),
    ...(secret ? { appSecretEnc: encrypt(secret) } : {}),
  };

  if (id) await prisma.channelAccount.update({ where: { id, tenantId }, data });
  else await prisma.channelAccount.create({ data });

  revalidatePath(`/admin/${slug}/channels`);
}

/**
 * يشترك تطبيقك في أصل القناة عند Meta.
 *
 * ⚠️ خطوة لا تفعلها واجهة Meta تلقائياً ولا تنبّه إلى غيابها: بدونها يعمل
 * الإرسال بينما لا تصل أي رسالة واردة إطلاقاً. كلّفتنا يوماً كاملاً عند أول
 * عميل — فصارت زراً هنا.
 *
 * الأصل يختلف بالقناة:
 *   واتساب            ← WhatsApp Business Account ID (منفصل عن رقم الهاتف)
 *   ماسنجر/انستقرام   ← معرّف الصفحة نفسه (هو externalId المخزّن)
 */
export async function subscribeChannel(formData: FormData) {
  await requireAdmin(); // مفاتيح Meta بيد مالك المنصة وحده
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;

  const tenantId = await authorizeTenant(slug);
  const acc = await prisma.channelAccount.findFirstOrThrow({
    where: { id, tenantId },
  });
  if (!acc.accessTokenEnc) throw new Error("احفظ Access Token أولاً");

  let target: string;
  if (acc.channel === "WHATSAPP") {
    const wabaId = s(formData.get("wabaId"));
    if (!wabaId) throw new Error("أدخل WhatsApp Business Account ID أولاً");
    target = wabaId;
    await prisma.channelAccount.update({ where: { id }, data: { wabaId } });
  } else {
    // ماسنجر وانستقرام: الاشتراك على الصفحة نفسها
    target = acc.externalId;
  }

  const token = decrypt(acc.accessTokenEnc);
  const version = process.env.META_GRAPH_VERSION ?? "v21.0";

  // حقول الصفحة تُحدَّد صراحةً؛ واتساب يشترك في كل الحقول المفعّلة بالتطبيق
  const params =
    acc.channel === "WHATSAPP"
      ? ""
      : "?subscribed_fields=messages,messaging_postbacks,message_reactions";

  const res = await fetch(
    `https://graph.facebook.com/${version}/${target}/subscribed_apps${params}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await res.json();

  if (!body.success) {
    throw new Error(`فشل الاشتراك: ${body.error?.message ?? JSON.stringify(body)}`);
  }

  await prisma.channelAccount.update({ where: { id }, data: { subscribedAt: new Date() } });
  revalidatePath(`/admin/${slug}/channels`);
}

export async function deleteChannel(formData: FormData) {
  await requireAdmin(); // مفاتيح Meta بيد مالك المنصة وحده
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenantId = await authorizeTenant(slug);
  await prisma.channelAccount.delete({ where: { id, tenantId } });
  revalidatePath(`/admin/${slug}/channels`);
}

/**
 * يولّد سرّ المكالمات — أو يبدّله.
 *
 * التبديل يُبطل السرّ القديم فوراً، فأي منصة مكالمات ما زالت تستعمله تتوقف
 * حتى تُحدَّث. هذا هو المقصود: هذا هو زر «تسرّب السرّ».
 */
export async function rotateVoiceToken(formData: FormData) {
  await requireAdmin(); // مفاتيح التشغيل بيد مالك المنصة
  const slug = s(formData.get("slug"))!;
  const tenantId = await authorizeTenant(slug);

  const token = `vk_${crypto.randomUUID().replace(/-/g, "")}`;
  await prisma.tenant.update({ where: { id: tenantId }, data: { voiceToken: token } });
  revalidatePath(`/admin/${slug}/channels`);
}

/** يوقف المكالمات بإزالة السرّ — لا سرّ، لا نداء مقبول. */
export async function revokeVoiceToken(formData: FormData) {
  await requireAdmin();
  const slug = s(formData.get("slug"))!;
  const tenantId = await authorizeTenant(slug);
  await prisma.tenant.update({ where: { id: tenantId }, data: { voiceToken: null } });
  revalidatePath(`/admin/${slug}/channels`);
}

// ═══════════════════════════════════════════════════════════
//  المحادثات
// ═══════════════════════════════════════════════════════════

/** إعادة محادثة محوّلة لموظف إلى الوكيل. */
/**
 * رد موظف بشري داخل محادثة محوّلة.
 *
 * بدون هذا كان التحويل طريقاً مسدوداً: الوكيل يصمت، والموظف يرى الرسالة في
 * اللوحة ولا يملك وسيلة للرد — فيضطر للاتصال بالعميل أو مراسلته من رقم آخر،
 * وينقطع خيط المحادثة ويضيع سجلّها.
 *
 * يُرسل عبر نفس القناة التي جاء منها العميل، ويُحفظ بدور HUMAN فيتميّز في
 * السجل عن رد الوكيل.
 */
export async function replyAsHuman(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const text = s(formData.get("text"));
  if (!text) throw new Error("اكتب رسالة أولاً");
  if (text.length > 4000) throw new Error("الرسالة أطول من ٤٠٠٠ حرف");

  const tenantId = await authorizeTenant(slug);

  // استعلام واحد يجلب المحادثة وقناتها معاً بدل اثنين متتاليين: كل جولة
  // إلى قاعدة بعيدة تُضاف مباشرةً إلى الزمن الذي ينتظره الموظف.
  const convo = await prisma.conversation.findUniqueOrThrow({
    where: { id, tenantId },
    select: {
      channel: true,
      externalUserId: true,
      tenant: {
        select: {
          channels: {
            where: { active: true },
            select: { channel: true, externalId: true, accessTokenEnc: true },
          },
        },
      },
    },
  });

  if (convo.channel === "WEB") {
    throw new Error("محادثات التجربة لا تُرسل — هي ساحة اختبار لا قناة حقيقية");
  }

  const account = convo.tenant.channels.find((c) => c.channel === convo.channel);
  if (!account?.accessTokenEnc) {
    throw new Error("لا يوجد رمز وصول لهذه القناة — راجع إعدادات القنوات");
  }

  const res = await sendMessage({
    channel: convo.channel,
    accountExternalId: account.externalId,
    to: convo.externalUserId,
    text,
    accessToken: decrypt(account.accessTokenEnc),
  });
  // لا نحفظ ما لم يُرسَل: سجل يُظهر رسالة لم تصل العميل أسوأ من لا سجل
  if (!res.ok) throw new Error(`فشل الإرسال: ${res.error}`);

  // الكتابتان معاً في جولة واحدة
  await prisma.$transaction([
    prisma.message.create({
      data: { tenantId, conversationId: id, role: "HUMAN", text },
    }),
    prisma.conversation.update({
      where: { id, tenantId },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  // المسار الذي يراه الموظف الآن فقط — الآخر يلتقط التغيير بنبضته
  revalidatePath(`/admin/${slug}/conversations`);
}

export async function resumeBot(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenantId = await authorizeTenant(slug);
  await prisma.conversation.update({
    where: { id, tenantId },
    data: { status: "BOT", handoffReason: null, handoffAt: null },
  });
  revalidatePath(`/admin/${slug}/conversations`);
}

/** تحويل محادثة لموظف بشري يدوياً. */
export async function forceHandoff(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenantId = await authorizeTenant(slug);
  await tenantScope(tenantId).handoff(id, "تحويل يدوي من اللوحة");
  revalidatePath(`/admin/${slug}/conversations`);
}

/** مفاتيح الاتصال — تُشتق من لهجة المتجر، فالرقم المحلي لا يحمل بلده. */
const DIALING_CODE: Record<string, string> = {
  JO: "962", SA: "966", AE: "971", KW: "965", QA: "974", BH: "973", OM: "968",
  EG: "20", IQ: "964", LB: "961", SY: "963", PS: "970", YE: "967",
  LY: "218", SD: "249", MA: "212", DZ: "213", TN: "216",
};

/**
 * يحوّل ما يكتبه الموظف إلى الصيغة التي يقبلها واتساب: أرقام فقط بمفتاح الدولة.
 *
 * الموظف ينسخ الرقم من حيث وجده — `+962 7 7046 6649`، `0096277…`، `0777…` —
 * وكلها نفس الرقم وكلها تُرفض كما هي. ورفضٌ بسبب شَرطة واحدة يبدو عطلاً في
 * النظام لا خطأً في اللصق، فنقبل الصيغ كلها ونوحّدها هنا.
 *
 * ويبقى حدّ واحد لا نتجاوزه: رقم محلي (`07…`) من متجر لا نعرف مفتاح بلده
 * نرفضه بدل أن نخمّن — إرساله لبلد خاطئ يصل إلى شخص حقيقي آخر.
 */
function normalizePhone(raw: string, locale: string): string {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  if (d.startsWith("00")) return d.slice(2);
  if (!d.startsWith("0")) return d;

  const region = locale.split("-")[1]?.toUpperCase() ?? "";
  const code = DIALING_CODE[region];
  if (!code) {
    throw new Error(
      `اكتب الرقم بمفتاح الدولة (مثل 9627XXXXXXXX) — لا نعرف مفتاح بلد هذا المتجر`,
    );
  }
  return code + d.slice(1);
}

/**
 * يبدأ محادثة مع رقم لم يراسلنا.
 *
 * لا يمكن أن تكون رسالة حرّة: واتساب يقبل خارج نافذة الأربع وعشرين ساعة
 * قوالب معتمدة فقط. فنرسل القالب، ثم نخزّن نصّه **بعد تعبئة متغيّراته** —
 * لأن ما يجب أن يقرأه الموظف في السجل هو ما رآه العميل، لا `{{1}}`.
 *
 * والمحادثة تُفتح بحالة HUMAN عمداً: نحن من بدأها، فردّ العميل الأول جواب
 * على كلامنا لا سؤال جديد — ولو تركناها للوكيل لردّ على سياق لا يعرفه.
 */
export async function startConversation(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const rawPhone = s(formData.get("phone"));
  const templateName = s(formData.get("template"));
  const customerName = s(formData.get("name"));
  if (!rawPhone) throw new Error("اكتب رقم الواتساب");
  if (!templateName) throw new Error("اختر قالباً");

  const tenantId = await authorizeTenant(slug);

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      locale: true,
      channels: {
        where: { channel: "WHATSAPP", active: true },
        select: { externalId: true, wabaId: true, accessTokenEnc: true },
      },
    },
  });

  const account = tenant.channels[0];
  if (!account?.accessTokenEnc) {
    throw new Error("لا توجد قناة واتساب مفعّلة — راجع إعدادات القنوات");
  }

  const to = normalizePhone(rawPhone, tenant.locale);
  if (to.length < 8 || to.length > 15) {
    throw new Error(`رقم غير صالح: ${rawPhone} — اكتبه بمفتاح الدولة، مثل 9627XXXXXXXX`);
  }

  const accessToken = decrypt(account.accessTokenEnc);
  const [name, language] = templateName.split("|");
  const variables = formData
    .getAll("var")
    .map((v) => v.toString().trim())
    .filter(Boolean);

  const found = await listTemplates({ wabaId: account.wabaId!, accessToken });
  if (!found.ok) throw new Error(`تعذّر قراءة القوالب: ${found.error}`);
  const tpl = found.templates.find((t) => t.name === name && t.language === language);
  if (!tpl) throw new Error("القالب لم يعد معتمداً — حدّث الصفحة");
  if (variables.length < tpl.variables) {
    throw new Error(`القالب يحتاج ${tpl.variables} متغيّراً، وصلني ${variables.length}`);
  }

  const res = await sendTemplate({
    accountExternalId: account.externalId,
    to,
    name,
    language,
    variables: variables.slice(0, tpl.variables),
    accessToken,
  });
  // لا نفتح محادثة لرسالة لم تصل: سجل يُظهر ما لم يُرسَل أسوأ من لا سجل
  if (!res.ok) throw new Error(`فشل الإرسال: ${res.error}`);

  const text = renderTemplate(tpl.body, variables);
  const scope = tenantScope(tenantId);
  const convo = await scope.getOrCreateConversation("WHATSAPP", to, customerName ?? undefined);

  await prisma.$transaction([
    prisma.message.create({
      data: { tenantId, conversationId: convo.id, role: "HUMAN", text },
    }),
    prisma.conversation.update({
      where: { id: convo.id, tenantId },
      data: { status: "HUMAN", lastMessageAt: new Date() },
    }),
  ]);

  revalidatePath(`/admin/${slug}/conversations`);
}

/**
 * ينشئ قالب رسالة ويرسله لمراجعة Meta.
 *
 * القوالب شرط لمخاطبة رقم خارج نافذة الأربع وعشرين ساعة، وكان إنشاؤها
 * يتطلب فتح مدير Meta. ذلك مقبول حين ندير متجراً واحداً، ومستحيل حين يصير
 * لكل متجر قوالبه — لا يُعقَل أن يفتح صاحب محل لوحة Meta ليكتب جملة ترحيب،
 * ولا أن نكتبها نحن عن كل عميل.
 */
export async function newTemplate(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const name = s(formData.get("name"));
  const body = s(formData.get("body"));
  const category = s(formData.get("category")) === "MARKETING" ? "MARKETING" : "UTILITY";
  const language = s(formData.get("language")) ?? "ar";
  const footer = s(formData.get("footer")) ?? undefined;

  if (!name) throw new Error("اكتب اسماً للقالب");
  if (!body) throw new Error("اكتب متن الرسالة");

  // Meta تقبل الحروف الصغيرة والأرقام والشرطة السفلية فقط
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    throw new Error(
      `اسم غير صالح: "${name}" — حروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط، مثل: tawasol_awwali`,
    );
  }

  const tenantId = await authorizeTenant(slug);
  const account = await prisma.channelAccount.findFirst({
    where: { tenantId, channel: "WHATSAPP", active: true },
    select: { wabaId: true, accessTokenEnc: true },
  });
  if (!account?.wabaId || !account.accessTokenEnc) {
    throw new Error("لا توجد قناة واتساب مكتملة — راجع إعدادات القنوات");
  }

  // عدد المتغيّرات من المتن نفسه، لا من عدد الحقول المعبّأة: حقل متروك
  // فارغاً وسط القائمة يجعل القيم تنزلق فيحمل {{2}} مثال {{3}}.
  let needed = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    needed = Math.max(needed, Number(m[1]));
  }
  const examples: string[] = [];
  const given = formData.getAll("example").map((v) => v.toString().trim());
  for (let i = 0; i < needed; i++) {
    const v = given[i];
    if (!v) throw new Error(`اكتب قيمة مثال للمتغيّر {{${i + 1}}} — Meta ترفض القالب بدونها`);
    examples.push(v);
  }

  const res = await createTemplate({
    wabaId: account.wabaId,
    name,
    language,
    category,
    body,
    footer,
    examples,
    accessToken: decrypt(account.accessTokenEnc),
  });
  if (!res.ok) throw new Error(`رفضت Meta القالب: ${res.error}`);

  revalidatePath(`/admin/${slug}/conversations`);
}
