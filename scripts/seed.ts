import { prisma } from "../src/lib/db";
import { tenantScope } from "../src/lib/tenancy";

/**
 * ثلاثة عملاء تجريبيين من أنواع بزنس مختلفة تماماً — نفس المحرك، معرفة منفصلة.
 * شغّله بـ: npm run seed
 */

async function main() {
  await prisma.tenant.deleteMany({ where: { slug: { in: ["dhahab", "azyaa", "shawaya"] } } });

  // ═══════════ 1. محل ذهب ═══════════
  const gold = await prisma.tenant.create({
    data: {
      slug: "dhahab",
      name: "مجوهرات الأثري",
      businessType: "gold",
      agentName: "سند",
      currency: "JOD",
      tone: "مهذب ورسمي قليلاً، يوحي بالثقة، بدون مبالغة تسويقية",
      handoffKeywords: ["شكوى", "مدير", "استرجاع"],
      customPolicy:
        "سعر أي قطعة = (وزنها × سعر الجرام حسب عيارها) + المصنعية. " +
        "اذكر دائماً أن السعر تقديري ويُثبّت في المحل. لا توافق على أي خصم.",
      profile: {
        create: {
          about: "محل ذهب ومجوهرات، بيع وشراء، عيار 18 و21 و24.",
          address: "عمّان — شارع الوكالات، مجمع الأثري التجاري",
          workingHours: "السبت–الخميس ١٠:٠٠ص – ٩:٠٠م، الجمعة مغلق",
          phone: "+962 7 9000 0000",
          paymentMethods: "كاش، فيزا/ماستر، تقسيط عبر البنك",
          returnPolicy: "الاستبدال خلال ٣ أيام مع الفاتورة. لا يوجد استرجاع نقدي.",
          deliveryPolicy: "الاستلام من المحل فقط لدواعي التأمين.",
        },
      },
      faqs: {
        create: [
          {
            question: "بتشتروا ذهب مستعمل؟",
            answer: "نعم نشتري الذهب المستعمل، والسعر يُحدّد بعد الفحص والوزن في المحل.",
            priority: 10,
          },
          {
            question: "في ضمان على القطع؟",
            answer: "كل قطعة تأتي بفاتورة رسمية وختم العيار، والضمان على المصنعية سنة كاملة.",
          },
        ],
      },
      dataSources: {
        create: [
          {
            key: "gold_price",
            label: "سعر جرام الذهب اليوم حسب العيار (بالدينار)",
            kind: "MANUAL",
            staleAfterMinutes: 720, // بعد ١٢ ساعة يعتبر السعر قديماً ولا يُصرّح به
            value: { karat_24: 62.5, karat_21: 54.7, karat_18: 46.9 },
            valueAt: new Date(),
          },
        ],
      },
    },
  });

  const goldScope = tenantScope(gold.id);
  await goldScope.upsertProduct({
    sku: "RG-21-001",
    name: "خاتم ذهب عيار 21 نقش هندسي",
    description: "خاتم نسائي عيار ٢١، وزن ٤.٢ جرام، تصميم هندسي حديث",
    category: "خواتم",
    priceUnit: "gram",
    attributes: { karat: 21, weight_g: 4.2, workmanship_per_g: 4 },
  });
  await goldScope.upsertProduct({
    sku: "NK-18-014",
    name: "طقم ذهب عيار 18 (سلسال وحلق)",
    description: "طقم مكوّن من سلسال وحلق، عيار ١٨، وزن إجمالي ١٢.٥ جرام",
    category: "أطقم",
    priceUnit: "gram",
    attributes: { karat: 18, weight_g: 12.5, workmanship_per_g: 5 },
  });
  await goldScope.upsertProduct({
    sku: "BR-21-007",
    name: "أسورة ذهب عيار 21 مفرغة",
    description: "أسورة نسائية عيار ٢١، وزن ٨ جرام",
    category: "أساور",
    priceUnit: "gram",
    attributes: { karat: 21, weight_g: 8, workmanship_per_g: 3.5 },
  });

  // ═══════════ 2. محل ملابس ═══════════
  const clothes = await prisma.tenant.create({
    data: {
      slug: "azyaa",
      name: "أزياء لمار",
      businessType: "clothing",
      agentName: "لمار",
      currency: "JOD",
      tone: "ودّي وخفيف، قريب من العميلة، بدون تكلّف",
      handoffKeywords: ["شكوى", "مدير"],
      customPolicy:
        "إذا سألت العميلة عن مقاس غير متوفر، اقترحي البدائل المتوفرة من نفس القطعة أو قطعة مشابهة.",
      profile: {
        create: {
          about: "محل ملابس نسائية — فساتين، عبايات، وملابس كاجوال.",
          address: "إربد — شارع الجامعة، مجمع لمار",
          workingHours: "يومياً ١١:٠٠ص – ١٠:٠٠م",
          deliveryPolicy: "توصيل داخل إربد ٢ دينار خلال ٢٤ ساعة، وباقي المحافظات ٣.٥ دينار.",
          returnPolicy: "الاستبدال خلال ٥ أيام بشرط بقاء التذكرة وعدم الاستخدام.",
          paymentMethods: "كاش عند الاستلام، أو تحويل كليك",
        },
      },
      faqs: {
        create: [
          {
            question: "عندكم مقاسات كبيرة؟",
            answer: "نعم، أغلب قطعنا متوفرة حتى مقاس XXL وبعضها حتى 3XL.",
            priority: 5,
          },
        ],
      },
    },
  });

  const clothesScope = tenantScope(clothes.id);
  await clothesScope.upsertProduct({
    sku: "DR-1042",
    name: "فستان سهرة أزرق",
    description: "فستان سهرة طويل بقماش ساتان، لون أزرق ملكي",
    category: "فساتين",
    price: 45,
    attributes: { sizes: ["S", "M", "L", "XL"], colors: ["أزرق ملكي", "أسود"] },
  });
  await clothesScope.upsertProduct({
    sku: "AB-2301",
    name: "عباية كلوش سوداء",
    description: "عباية كلوش بقماش كريب، تطريز خفيف على الأكمام",
    category: "عبايات",
    price: 32,
    attributes: { sizes: ["M", "L", "XL", "XXL"], colors: ["أسود"] },
  });
  await clothesScope.upsertProduct({
    sku: "DR-1055",
    name: "فستان كاجوال مورّد",
    description: "فستان صيفي قطن بطبعة ورود",
    category: "فساتين",
    price: 22,
    inStock: false,
    attributes: { sizes: ["S", "M"], colors: ["وردي"] },
  });

  // ═══════════ 3. مطعم ═══════════
  const rest = await prisma.tenant.create({
    data: {
      slug: "shawaya",
      name: "مشاوي أبو سامر",
      businessType: "restaurant",
      agentName: "سامر",
      currency: "JOD",
      tone: "بسيط وسريع، لهجة أردنية دارجة",
      handoffKeywords: ["شكوى", "طلبية غلط"],
      profile: {
        create: {
          about: "مطعم مشاوي ومقبلات، عائلي.",
          address: "الزرقاء — دوار الفلل",
          workingHours: "يومياً ١٢:٠٠ظ – ١٢:٠٠ منتصف الليل",
          deliveryPolicy: "توصيل داخل الزرقاء ١ دينار، الحد الأدنى للطلب ٥ دنانير.",
          paymentMethods: "كاش فقط عند الاستلام",
        },
      },
      faqs: {
        create: [
          {
            question: "بتستقبلوا حجوزات؟",
            answer: "نعم نستقبل حجوزات للمجموعات فوق ٦ أشخاص، والحجز يتأكد بمكالمة من الموظف.",
          },
        ],
      },
    },
  });

  const restScope = tenantScope(rest.id);
  await restScope.upsertProduct({
    sku: "MSH-01",
    name: "نص كيلو مشاوي مشكل",
    description: "شيش طاووق، كباب، وشيش كباب مع الخبز والسلطات",
    category: "مشاوي",
    price: 9.5,
  });
  await restScope.upsertProduct({
    sku: "SHW-01",
    name: "ساندويش شاورما دجاج",
    description: "شاورما دجاج مع ثومية ومخلل",
    category: "ساندويشات",
    price: 1.75,
  });
  await restScope.upsertProduct({
    sku: "APP-03",
    name: "حمص بالصنوبر",
    description: "صحن حمص مع صنوبر وزيت زيتون",
    category: "مقبلات",
    price: 2.5,
  });

  console.log("✅ تم إنشاء ٣ عملاء تجريبيين:");
  console.log("   dhahab   — مجوهرات الأثري (ذهب، مع سعر حيّ)");
  console.log("   azyaa    — أزياء لمار (ملابس)");
  console.log("   shawaya  — مشاوي أبو سامر (مطعم)");
  console.log("\nجرّب: npm run chat dhahab");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
