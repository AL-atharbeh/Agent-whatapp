"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Channel, DataSourceKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tenantScope } from "@/lib/tenancy";
import { normalizeArabic } from "@/lib/arabic";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * إجراءات لوحة التحكم.
 *
 * ⚠️ هذه المسارات تعمل عبر العملاء كلهم بطبيعتها (لوحة مالك المنصة).
 * قبل أي استخدام حقيقي يجب إضافة مصادقة وصلاحيات فوقها — انظر README § الحدود.
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

  await prisma.tenant.update({
    where: { slug },
    data: {
      name: s(formData.get("name")) ?? undefined,
      businessType: s(formData.get("businessType")) ?? undefined,
      agentName: s(formData.get("agentName")) ?? undefined,
      tone: s(formData.get("tone")) ?? undefined,
      currency: s(formData.get("currency")) ?? undefined,
      locale: s(formData.get("locale")) ?? undefined,
      timezone: s(formData.get("timezone")) ?? undefined,
      modelId: s(formData.get("modelId")) ?? undefined,
      effort: s(formData.get("effort")) ?? undefined,
      customPolicy: s(formData.get("customPolicy")),
      maxRepliesPerDay: n(formData.get("maxRepliesPerDay")) ?? undefined,
      handoffKeywords: (s(formData.get("handoffKeywords")) ?? "")
        .split(/[,،\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
      status: (s(formData.get("status")) ?? "ACTIVE") as "ACTIVE" | "PAUSED" | "SUSPENDED",
    },
  });

  revalidatePath(`/admin/${slug}`);
}

export async function updateProfile(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });

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
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, ...data },
    update: data,
  });

  revalidatePath(`/admin/${slug}`);
}

export async function deleteTenant(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  await prisma.tenant.delete({ where: { slug } });
  revalidatePath("/admin");
  redirect("/admin");
}

// ═══════════════════════════════════════════════════════════
//  المنتجات
// ═══════════════════════════════════════════════════════════

export async function saveProduct(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"));
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });

  const name = s(formData.get("name"));
  if (!name) throw new Error("اسم المنتج مطلوب");

  const description = s(formData.get("description"));
  const category = s(formData.get("category"));
  const sku = s(formData.get("sku"));

  const data = {
    tenantId: tenant.id,
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
    await prisma.product.update({ where: { id, tenantId: tenant.id }, data });
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

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });

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

  await prisma.product.createMany({
    data: rows.map((r) => ({
      tenantId: tenant.id,
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
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });
  await prisma.product.delete({ where: { id, tenantId: tenant.id } });
  revalidatePath(`/admin/${slug}/products`);
}

// ═══════════════════════════════════════════════════════════
//  الأسئلة الشائعة
// ═══════════════════════════════════════════════════════════

export async function saveFaq(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"));
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });

  const question = s(formData.get("question"));
  const answer = s(formData.get("answer"));
  if (!question || !answer) throw new Error("السؤال والجواب مطلوبان");

  const data = {
    tenantId: tenant.id,
    question,
    answer,
    priority: n(formData.get("priority")) ?? 0,
    active: formData.get("active") === "on",
  };

  if (id) await prisma.faq.update({ where: { id, tenantId: tenant.id }, data });
  else await prisma.faq.create({ data });

  revalidatePath(`/admin/${slug}/faqs`);
}

export async function deleteFaq(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });
  await prisma.faq.delete({ where: { id, tenantId: tenant.id } });
  revalidatePath(`/admin/${slug}/faqs`);
}

// ═══════════════════════════════════════════════════════════
//  مصادر البيانات الحيّة
// ═══════════════════════════════════════════════════════════

export async function saveDataSource(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"));
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });

  const key = s(formData.get("key"));
  const label = s(formData.get("label"));
  if (!key || !label) throw new Error("المفتاح والوصف مطلوبان");

  const value = parseJson(formData.get("value"));

  const data = {
    tenantId: tenant.id,
    key,
    label,
    kind: (s(formData.get("kind")) ?? "MANUAL") as DataSourceKind,
    config: parseJson(formData.get("config")),
    staleAfterMinutes: n(formData.get("staleAfterMinutes")) ?? 720,
    active: formData.get("active") === "on",
    // كل حفظ للقيمة يجدّد الطابع الزمني — وهو ما يحدّد إن كانت "طازجة" أم لا
    ...(value !== undefined ? { value, valueAt: new Date() } : {}),
  };

  if (id) await prisma.dataSource.update({ where: { id, tenantId: tenant.id }, data });
  else await prisma.dataSource.create({ data });

  revalidatePath(`/admin/${slug}/data`);
}

export async function deleteDataSource(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });
  await prisma.dataSource.delete({ where: { id, tenantId: tenant.id } });
  revalidatePath(`/admin/${slug}/data`);
}

// ═══════════════════════════════════════════════════════════
//  القنوات
// ═══════════════════════════════════════════════════════════

export async function saveChannel(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"));
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });

  const externalId = s(formData.get("externalId"));
  if (!externalId) throw new Error("معرّف الحساب مطلوب");

  const token = s(formData.get("accessToken"));
  const secret = s(formData.get("appSecret"));

  const data = {
    tenantId: tenant.id,
    channel: (s(formData.get("channel")) ?? "WHATSAPP") as Channel,
    externalId,
    displayName: s(formData.get("displayName")),
    verifyToken: s(formData.get("verifyToken")),
    active: formData.get("active") === "on",
    // المفاتيح تُشفّر قبل التخزين؛ حقل فارغ = أبقِ القيمة القديمة
    ...(token ? { accessTokenEnc: encrypt(token) } : {}),
    ...(secret ? { appSecretEnc: encrypt(secret) } : {}),
  };

  if (id) await prisma.channelAccount.update({ where: { id, tenantId: tenant.id }, data });
  else await prisma.channelAccount.create({ data });

  revalidatePath(`/admin/${slug}/channels`);
}

/**
 * يشترك تطبيقك في حساب واتساب التجاري للعميل.
 *
 * ⚠️ خطوة لا تفعلها واجهة Meta تلقائياً ولا تنبّه إلى غيابها: بدونها يعمل
 * الإرسال بينما لا تصل أي رسالة واردة إطلاقاً. كلّفنا يوماً كاملاً عند أول
 * عميل — فصارت زراً هنا.
 */
export async function subscribeWaba(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const wabaId = s(formData.get("wabaId"));
  if (!wabaId) throw new Error("أدخل WhatsApp Business Account ID أولاً");

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });
  const acc = await prisma.channelAccount.findFirstOrThrow({
    where: { id, tenantId: tenant.id },
  });
  if (!acc.accessTokenEnc) throw new Error("احفظ Access Token أولاً");

  const token = decrypt(acc.accessTokenEnc);
  const version = process.env.META_GRAPH_VERSION ?? "v21.0";

  const res = await fetch(
    `https://graph.facebook.com/${version}/${wabaId}/subscribed_apps`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await res.json();

  if (!body.success) {
    throw new Error(
      `فشل الاشتراك: ${body.error?.message ?? JSON.stringify(body)}`,
    );
  }

  await prisma.channelAccount.update({ where: { id }, data: { wabaId } });
  revalidatePath(`/admin/${slug}/channels`);
}

export async function deleteChannel(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });
  await prisma.channelAccount.delete({ where: { id, tenantId: tenant.id } });
  revalidatePath(`/admin/${slug}/channels`);
}

// ═══════════════════════════════════════════════════════════
//  المحادثات
// ═══════════════════════════════════════════════════════════

/** إعادة محادثة محوّلة لموظف إلى الوكيل. */
export async function resumeBot(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });
  await prisma.conversation.update({
    where: { id, tenantId: tenant.id },
    data: { status: "BOT", handoffReason: null, handoffAt: null },
  });
  revalidatePath(`/admin/${slug}/conversations`);
}

/** تحويل محادثة لموظف بشري يدوياً. */
export async function forceHandoff(formData: FormData) {
  const slug = s(formData.get("slug"))!;
  const id = s(formData.get("id"))!;
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });
  await tenantScope(tenant.id).handoff(id, "تحويل يدوي من اللوحة");
  revalidatePath(`/admin/${slug}/conversations`);
}
