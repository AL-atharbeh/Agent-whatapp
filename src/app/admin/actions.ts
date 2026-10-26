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
import { checkTemplateBody, createTemplate } from "@/lib/channels/meta";
import { sendHumanReply, startWhatsappConversation } from "@/lib/outbound";
import { report } from "./report";
import { VOICE_MODELS, normalizeE164 } from "@/lib/voice/settings";

/**
 * إجراءات إدارة المتاجر — يستخدمها مالك المنصة وأصحاب المتاجر معاً.
 *
 * ⚠️ الأمان هنا لا يعتمد على middleware: server actions تُستدعى مباشرة عبر
 * HTTP ولا تمر بكل فحوصه. لذلك كل إجراء يمر بـ authorizeTenant الذي يتحقّق
 * من الجلسة الموقّعة — صاحب المتجر لا يعدّل إلا متجره مهما زوّر الحقول.
 *
 * الإجراءات الحسّاسة (إنشاء/حذف متجر، القنوات، التفعيل) محصورة بـ requireAdmin.
 */

// report() في ملف مشترك — إجراءات المواعيد تستعمله أيضاً (انظر report.ts)

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

/**
 * صوت المكالمات للمتجر: رقمه عند منصة المكالمات، والصوت، والجملة الأولى.
 *
 * الرقم فريد بين المتاجر — به تُعرف المكالمة لمن. رقم مكتوب بصيغة لا تُفهم
 * يُرفض برسالة بدل أن يُحفظ فارغاً بصمت فتصل مكالماته لا أحد.
 */
export async function saveVoiceSettings(formData: FormData) {
  await requireAdmin(); // الربط بمنصة المكالمات بيد مالك المنصة
  const slug = s(formData.get("slug"))!;
  const path = `/admin/${slug}/channels`;
  try {
    const tenantId = await authorizeTenant(slug);
    const rawPhone = s(formData.get("voicePhone"));
    const voicePhone = rawPhone ? normalizeE164(rawPhone) : null;
    if (rawPhone && !voicePhone) throw new Error("رقم المكالمات بصيغة دولية: +9627xxxxxxxx");

    const picked = s(formData.get("voiceId"));
    const custom = s(formData.get("customVoiceId"));
    const voiceId = picked === "custom" ? custom : picked;
    if (voiceId && !/^[A-Za-z0-9_-]{6,64}$/.test(voiceId)) throw new Error("معرّف الصوت غير صالح — انسخه من ElevenLabs كما هو");
    const model = s(formData.get("voiceModel"));

    const clash = voicePhone
      ? await prisma.tenant.findFirst({ where: { voicePhone, NOT: { id: tenantId } }, select: { name: true } })
      : null;
    if (clash) throw new Error(`الرقم مربوط بمتجر آخر: ${clash.name}`);

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        voicePhone,
        voiceSettings: {
          voiceId: voiceId || null,
          voiceName: s(formData.get("voiceName")),
          voiceModel: VOICE_MODELS.find((m) => m === model) ?? VOICE_MODELS[0],
          firstMessage: s(formData.get("firstMessage")),
          vapiPhoneNumberId: s(formData.get("vapiPhoneNumberId")),
        },
      },
    });
  } catch (err) {
    report(err, path);
  }
  revalidatePath(path);
}

/** يوقف المكالمات بإزالة السرّ — لا سرّ، لا نداء مقبول. */
export async function revokeVoiceToken(formData: FormData) {
  await requireAdmin();
  const slug = s(formData.get("slug"))!;
  const tenantId = await authorizeTenant(slug);
  await prisma.tenant.update({ where: { id: tenantId }, data: { voiceToken: null } });
  revalidatePath(`/admin/${slug}/channels`);
}

/**
 * يفعّل وحدة المواعيد لمتجر أو يطفئها (docs/appointments.md).
 *
 * بيد مالك المنصة وحده: التفعيل يضيف ثماني أدوات وتعليمات للوكيل في كل
 * رسالة — كلفة تُحسب في الباقة — ويشغّل رسائل تذكير لعملاء المتجر باسمه.
 * الإطفاء لا يحذف شيئاً: الخدمات والفريق والمواعيد تبقى، والوحدة تختفي فقط.
 */
export async function setAppointmentsEnabled(formData: FormData) {
  await requireAdmin();
  const slug = s(formData.get("slug"))!;
  const enabled = s(formData.get("enabled")) === "on" || s(formData.get("enabled")) === "true";
  const tenantId = await authorizeTenant(slug);
  await prisma.tenant.update({ where: { id: tenantId }, data: { appointmentsEnabled: enabled } });
  revalidatePath(`/admin/${slug}`);
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
async function replyAsHumanRaw(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const text = s(formData.get("text"));
  if (!text) throw new Error("اكتب رسالة أولاً");
  if (text.length > 4000) throw new Error("الرسالة أطول من ٤٠٠٠ حرف");

  const tenantId = await authorizeTenant(slug);

  // المسار نفسه الذي يستخدمه الجوال (lib/outbound) — بلا فحص نافذة ولا
  // استلام تلقائي، فسلوك اللوحة كما كان: Meta هي من ترفض خارج النافذة،
  // والاستلام بزرّه.
  await sendHumanReply({
    tenantId,
    conversationId: id,
    text,
    claim: null,
  });

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

/**
 * يبدأ محادثة مع رقم لم يراسلنا — بقالب معتمد، ثم تُفتح بحالة HUMAN.
 * المنطق كله في lib/outbound مشتركاً مع الجوال؛ هنا قراءة النموذج فقط.
 */
async function startConversationRaw(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const rawPhone = s(formData.get("phone"));
  const templateName = s(formData.get("template"));
  const customerName = s(formData.get("name"));
  if (!rawPhone) throw new Error("اكتب رقم الواتساب");
  if (!templateName) throw new Error("اختر قالباً");

  const tenantId = await authorizeTenant(slug);

  const [name, language] = templateName.split("|");
  const variables = formData
    .getAll("var")
    .map((v) => v.toString().trim())
    .filter(Boolean);

  await startWhatsappConversation({
    tenantId,
    phone: rawPhone,
    customerName,
    name,
    language: language ?? "",
    variables,
    claimReason: null,
  });

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
async function newTemplateRaw(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const name = s(formData.get("name"));
  const body = s(formData.get("body"));
  const category = s(formData.get("category")) === "MARKETING" ? "MARKETING" : "UTILITY";
  const language = s(formData.get("language")) ?? "ar";
  const footer = s(formData.get("footer")) ?? undefined;

  if (!name) throw new Error("اكتب اسماً للقالب");
  if (!body) throw new Error("اكتب متن الرسالة");

  // قواعد Meta تُفحَص هنا لا هناك: الرفض عندهم يأتي بعد انتظار، بالإنجليزية،
  // عن قاعدة لم يقرأها أحد — وهي قواعد نعرفها مسبقاً.
  const bad = checkTemplateBody(body);
  if (bad) throw new Error(bad);

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




export async function newTemplate(formData: FormData) {
  try {
    await newTemplateRaw(formData);
  } catch (err) {
    report(err, `/admin/${formData.get("slug")}/conversations`);
  }
}

export async function startConversation(formData: FormData) {
  try {
    await startConversationRaw(formData);
  } catch (err) {
    report(err, `/admin/${formData.get("slug")}/conversations`);
  }
}

export async function replyAsHuman(formData: FormData) {
  try {
    await replyAsHumanRaw(formData);
  } catch (err) {
    report(err, `/admin/${formData.get("slug")}/conversations`);
  }
}
