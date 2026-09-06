import { z } from "zod";
import type { Channel } from "@prisma/client";
import type { TenantContext, TenantScope } from "../tenancy";

/**
 * أدوات الوكيل — بصيغة محايدة عن المزوّد.
 *
 * كل أداة مبنية داخل closure على `scope` الخاص بعميل واحد. الأداة لا تستقبل
 * tenantId كمُدخَل من النموذج إطلاقاً — وهذا هو الضمان التقني بأن وكيل محل
 * الذهب لا يستطيع الوصول لبيانات المطعم حتى لو حاول.
 *
 * الصيغة المحايدة تسمح بتشغيل نفس الأدوات على Claude (الإنتاج) أو
 * Groq/غيره (التجربة) بدون أي تكرار — انظر providers/.
 */

export type AgentTool = {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (input: never) => Promise<string>;
};

function defineTool<S extends z.ZodType>(t: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string>;
}): AgentTool {
  return t as unknown as AgentTool;
}

export type RunState = {
  handoff: { requested: boolean; reason: string } | null;
  toolCalls: { name: string; input: unknown; summary: string }[];
};

export function buildTools(args: {
  scope: TenantScope;
  tenant: TenantContext;
  channel: Channel;
  externalUserId: string;
  state: RunState;
}): AgentTool[] {
  const { scope, tenant, channel, externalUserId, state } = args;

  const log = (name: string, input: unknown, summary: string) => {
    state.toolCalls.push({ name, input, summary });
  };

  // ── ١. البحث في الكتالوج ──────────────────────────────────
  const searchCatalog = defineTool({
    name: "search_catalog",
    description:
      `يبحث في كتالوج ${tenant.name}. استخدمه في كل سؤال عن سعر أو توفر أو "شو عندكم". ` +
      `اترك query فارغاً لعرض كل ما هو متاح — افعل ذلك عند أسئلة الاستعراض العامة.`,
    schema: z.object({
      query: z
        .string()
        .describe(
          "كلمات بحث بلغة العميل، مثل: فستان ازرق / خاتم عيار 21. " +
            "اتركه فارغاً (\"\") لعرض كل المتاح.",
        ),
      category: z.string().optional().describe("تضييق البحث على صنف معيّن إن عرفته"),
    }),
    run: async (input) => {
      const browsing = !input.query.trim() && !input.category;
      const rows = browsing
        ? await scope.sampleProducts()
        : await scope.searchProducts(input.query, input.category);

      if (rows.length === 0) {
        const cats = await scope.listCategories();
        // لا تطابق للبحث ⇒ نعطي النموذج عيّنة حقيقية بدل أن يحوّل لموظف بلا داعٍ
        const sample = await scope.sampleProducts(15);
        log("search_catalog", input, sample.length ? "لا تطابق — عرض المتاح" : "الكتالوج فارغ");

        if (sample.length === 0) {
          return JSON.stringify({
            found: 0,
            note: "الكتالوج فارغ تماماً — لا يمكنك الإجابة عن أي سؤال عن المتاح. حوّل لموظف.",
          });
        }

        return JSON.stringify({
          found: 0,
          note:
            "لا يوجد تطابق دقيق. لا تخترع شيئاً — أخبر العميل أن ما طلبه غير متوفر، " +
            "ثم اعرض عليه ما هو متاح فعلاً من القائمة أدناه.",
          available_categories: cats,
          available_items: sample.map((r) => ({
            name: r.name,
            category: r.category,
            price: r.price ? Number(r.price) : null,
            in_stock: r.inStock,
          })),
        });
      }
      const items = rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        description: r.description,
        category: r.category,
        price: r.price ? Number(r.price) : null,
        price_unit: r.priceUnit,
        currency: r.currency ?? tenant.currency,
        in_stock: r.inStock,
        quantity: r.quantity,
        attributes: r.attributes,
        image_url: r.imageUrl,
      }));
      log("search_catalog", input, `${rows.length} نتيجة`);
      return JSON.stringify({ found: items.length, items });
    },
  });

  // ── ٢. البيانات الحيّة (سعر الذهب، إلخ) ───────────────────
  const getLiveData = defineTool({
    name: "get_live_data",
    description:
      "يجلب قيمة حيّة محدّثة (مثل سعر الذهب اليوم). " +
      "استخدمه لأي رقم متغيّر بدل الاعتماد على معرفتك.",
    schema: z.object({
      key: z.string().describe("مفتاح المصدر كما هو مذكور في تعليماتك، مثل: gold_price"),
    }),
    run: async (input) => {
      const src = await scope.getDataSource(input.key);
      if (!src || !src.active) {
        log("get_live_data", input, "مصدر غير موجود");
        return JSON.stringify({
          ok: false,
          reason: "هذا المصدر غير متاح. لا تذكر أي رقم من عندك.",
        });
      }

      let value = src.value;
      let valueAt = src.valueAt;

      if (src.kind === "HTTP_JSON") {
        const cfg = (src.config ?? {}) as { url?: string; headers?: Record<string, string> };
        if (cfg.url) {
          try {
            const res = await fetch(cfg.url, {
              headers: cfg.headers ?? {},
              signal: AbortSignal.timeout(6000),
            });
            if (res.ok) {
              value = await res.json();
              valueAt = new Date();
              await scope.setDataSourceValue(src.key, value as never);
            }
          } catch {
            // نسقط للقيمة المخزّنة الأخيرة ونترك فحص القِدم يتكفّل بالباقي
          }
        }
      }

      if (value == null || !valueAt) {
        log("get_live_data", input, "لا توجد قيمة");
        return JSON.stringify({
          ok: false,
          reason: "لا توجد قيمة محدّثة. أخبر العميل أنك ستتأكد وحوّل لموظف.",
        });
      }

      const ageMin = (Date.now() - valueAt.getTime()) / 60000;
      const stale = ageMin > src.staleAfterMinutes;
      log("get_live_data", input, stale ? "قيمة قديمة" : "قيمة حديثة");

      return JSON.stringify({
        ok: !stale,
        stale,
        label: src.label,
        value,
        updated_at: valueAt.toISOString(),
        age_minutes: Math.round(ageMin),
        ...(stale
          ? {
              instruction:
                "القيمة قديمة — ممنوع ذكر الرقم. قل إن السعر يتغيّر يومياً واعرض التحويل لموظف.",
            }
          : {}),
      });
    },
  });

  // ── ٣. التقاط عميل محتمل ──────────────────────────────────
  const captureLead = defineTool({
    name: "capture_lead",
    description:
      "يسجّل عميلاً مهتماً بالشراء لمتابعته لاحقاً من قبل الموظفين. " +
      "استخدمه عند وجود نية شراء واضحة أو حين يترك العميل رقمه. لا تخبر العميل أنك سجّلته.",
    schema: z.object({
      interest: z.string().describe("ما الذي يريده العميل تحديداً"),
      name: z.string().optional(),
      phone: z.string().optional(),
      notes: z.string().optional(),
    }),
    run: async (input) => {
      await scope.createLead({ ...input, channel, externalUserId });
      log("capture_lead", input, "تم التسجيل");
      return JSON.stringify({ ok: true, note: "سُجّل داخلياً. أكمل ردك بشكل طبيعي." });
    },
  });

  // ── ٤. التحويل لموظف بشري ─────────────────────────────────
  const handoff = defineTool({
    name: "handoff_to_human",
    description:
      "يحوّل المحادثة لموظف بشري ويوقف ردود الوكيل عليها. " +
      "استخدمه عند: شكوى، تفاوض على السعر، طلب معقّد أو خارج قدرتك، معلومة غير متوفرة لديك، " +
      "أو طلب العميل الصريح للتحدث مع شخص.",
    schema: z.object({
      reason: z.string().describe("سبب التحويل — يظهر للموظف"),
      summary: z.string().describe("ملخّص سطرين لما يريده العميل حتى لا يعيد الشرح"),
    }),
    run: async (input) => {
      state.handoff = { requested: true, reason: `${input.reason} — ${input.summary}` };
      log("handoff_to_human", input, "تحويل لموظف");
      return JSON.stringify({
        ok: true,
        instruction:
          "تم التحويل. اكتب الآن جملة قصيرة واحدة تطمئن العميل أن موظفاً سيرد عليه قريباً، ثم توقف.",
      });
    },
  });

  return [searchCatalog, getLiveData, captureLead, handoff];
}
