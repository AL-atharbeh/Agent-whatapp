import {
  Prisma,
  type Channel,
  type Conversation,
  type Message,
  type OutboundRequest,
  type TenantStatus,
} from "@prisma/client";
import { prisma } from "./db";
import { decrypt } from "./crypto";
import {
  listTemplates,
  renderTemplate,
  sendMessage,
  sendTemplate,
  type Template,
} from "./channels/meta";
import { deliveryOutcome, isWindowRejection, type OutboundResult } from "./channels/types";
import { tenantScope } from "./tenancy";
import { isPlausiblePhone, normalizePhone } from "./phone";
import { decideReservation, fingerprint, type SendPayload } from "./reservation";

/**
 * الإرسال البشري — رد الموظف، والقوالب، وبدء محادثة.
 *
 * كان كله داخل إجراءات اللوحة. والجوال يحتاج نفس الخطوات بنفس الترتيب،
 * ونسخة ثانية منها هي بالضبط المكان الذي ينسى فيه أحد الطرفين قاعدة
 * «لا نخزّن ما لم يُرسَل» فيُظهر السجل رداً لم يصل العميل.
 *
 * الترتيب ثابت في كل مسار:
 *   تحقّق ← (حجز clientId) ← إرسال لـ Meta ← تخزين وإغلاق الحجز في معاملة.
 * التخزين أخيراً لأن Meta هي من تقرر إن وصلت الرسالة، لا نحن. والحجز قبل
 * Meta لأن فحص «هل أُرسلت؟» بعده يترك طلبين متزامنين يمرّان معاً.
 */

export type OutboundCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "TENANT_INACTIVE"
  | "CHANNEL_NOT_CONNECTED"
  | "WINDOW_CLOSED"
  | "TEMPLATE_INVALID"
  | "IN_PROGRESS"
  | "DELIVERY_UNKNOWN"
  | "SEND_FAILED";

/**
 * خطأ بمعنى معروف، لا عطل.
 *
 * `message` عربي آمن للعرض على أي واجهة. `detail` نص Meta الخام — تعرضه
 * اللوحة لصاحب المتجر لأنه ما يحتاجه ليصلح القناة، ولا يخرج إلى الجوال
 * لأنه قد يحمل معرّفات حساب Meta.
 */
export class OutboundError extends Error {
  constructor(
    readonly code: OutboundCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "OutboundError";
  }
}

/** نص الخطأ كما تعرضه اللوحة: الرسالة ومعها تفصيل Meta حين يوجد. */
export function webErrorMessage(err: OutboundError): string {
  return err.detail ? `${err.message}: ${err.detail}` : err.message;
}

export type Sent = { message: Message; conversation: Conversation; replayed: boolean };

const UNCONFIRMED = "لم تؤكّد Meta الإرسال — تحقّق من المحادثة قبل الإعادة";

/**
 * الإرسال معطّل لمتجر موقوف، والقراءة لا.
 *
 * الوكيل نفسه يصمت حين يتوقّف الاشتراك (pipeline). لو بقي الموظف يرسل من
 * الجوال أو اللوحة لصار التوقّف نصف توقّف: المتجر يعمل بلا اشتراك ما دام
 * أحد يردّ يدوياً. أما قراءة السجل فحقّه، ومنعها يُخفي عنه زبائن ينتظرون.
 */
function assertActive(status: TenantStatus) {
  if (status !== "ACTIVE") {
    throw new OutboundError(
      "TENANT_INACTIVE",
      "المتجر موقوف أو اشتراكه منتهٍ — الإرسال معطّل حتى يُفعَّل، والقراءة تعمل",
    );
  }
}

// ═══════════════════════════════════════════════════════════
//  حجز clientId
// ═══════════════════════════════════════════════════════════

type Reservation = { tenantId: string; clientId: string; fp: string };

function reservationFor(
  tenantId: string,
  clientId: string | null | undefined,
  payload: SendPayload,
): Reservation | null {
  return clientId ? { tenantId, clientId, fp: fingerprint(payload) } : null;
}

const findReservation = (r: Reservation) =>
  prisma.outboundRequest.findUnique({
    where: { tenantId_clientId: { tenantId: r.tenantId, clientId: r.clientId } },
  });

/**
 * ينفّذ قرار الحجز الموجود: يرجّع الرسالة إن أُرسلت سابقاً، أو يرمي إن لا
 * تجوز المتابعة، أو null إن جازت (رفض صريح سابق ⇒ محاولة جديدة).
 */
async function applyDecision(r: Reservation, row: OutboundRequest): Promise<Message | null> {
  const d = decideReservation(row, r.fp, new Date());
  switch (d.action) {
    case "mismatch":
      throw new OutboundError("INVALID_INPUT", "معرّف الإرسال مستخدم لعملية أخرى");
    case "replay": {
      const m = await prisma.message.findFirst({
        where: { id: d.messageId, tenantId: r.tenantId },
      });
      if (!m) throw new OutboundError("DELIVERY_UNKNOWN", UNCONFIRMED);
      return m;
    }
    case "in_progress":
      throw new OutboundError("IN_PROGRESS", "الإرسال بنفس المعرّف ما زال جارياً — انتظر ولا تُعِد");
    case "stale":
      // دالة انقطعت وسط الإرسال. نثبّت الحالة كي لا يحكم عليها طلب لاحق
      // بساعة مختلفة؛ والشرط على updatedAt يمنع الكتابة فوق من سبقنا.
      await prisma.outboundRequest.updateMany({
        where: { id: row.id, state: "PENDING", updatedAt: row.updatedAt },
        data: { state: "UNKNOWN" },
      });
      console.error(`[outbound] حجز معلّق مات وسط الإرسال: ${row.id} — لن يُعاد`);
      throw new OutboundError("DELIVERY_UNKNOWN", UNCONFIRMED);
    case "unknown":
      throw new OutboundError("DELIVERY_UNKNOWN", UNCONFIRMED);
    case "retry":
      return null;
  }
}

/**
 * قبل الفحوص: هل لهذا المعرّف تاريخ؟
 *
 * يسبق النافذة وحالة المتجر عمداً: إعادة محاولة لرسالة وصلت فعلاً يجب أن
 * ترجع بها حتى لو أُغلقت النافذة بعدها بدقيقة — وإلا ظن الجهاز أنها فشلت.
 */
async function peek(r: Reservation | null): Promise<Message | null> {
  if (!r) return null;
  const row = await findReservation(r);
  return row ? applyDecision(r, row) : null;
}

/**
 * الحجز الفعلي — بعد الفحوص وقبل Meta مباشرة.
 *
 * الإنشاء نفسه هو القفل: قيد (tenantId, clientId) يضمن أن طلباً واحداً فقط
 * يحصل على PENDING، والبقية تقرأ حالته وتتصرّف عليها. وإعادة FAILED إلى
 * PENDING بشرط الحالة ذرّية للسبب نفسه.
 */
async function acquire(r: Reservation): Promise<{ id: string } | { replay: Message }> {
  try {
    const row = await prisma.outboundRequest.create({
      data: { tenantId: r.tenantId, clientId: r.clientId, fingerprint: r.fp },
      select: { id: true },
    });
    return { id: row.id };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }

  const row = await findReservation(r);
  if (!row) throw new OutboundError("IN_PROGRESS", "الإرسال بنفس المعرّف ما زال جارياً — انتظر ولا تُعِد");
  const replay = await applyDecision(r, row);
  if (replay) return { replay };

  const { count } = await prisma.outboundRequest.updateMany({
    where: { id: row.id, state: "FAILED", fingerprint: r.fp },
    data: { state: "PENDING" },
  });
  // سبقنا طلب آخر إلى إعادة المحاولة نفسها
  if (count === 0) {
    throw new OutboundError("IN_PROGRESS", "الإرسال بنفس المعرّف ما زال جارياً — انتظر ولا تُعِد");
  }
  return { id: row.id };
}

/** إغلاق الحجز بنتيجة سلبية — بأفضل جهد: فشله يترك PENDING يصير «غير مؤكّد» بعد دقيقتين. */
async function settle(id: string | null, state: "FAILED" | "UNKNOWN") {
  if (!id) return;
  await prisma.outboundRequest
    .updateMany({ where: { id, state: "PENDING" }, data: { state } })
    .catch((err) => console.error(`[outbound] تعذّر تثبيت الحجز ${id} على ${state}:`, err));
}

/**
 * Meta ثم التخزين، بالتصنيف الذي يحدد ما يجوز للمنادي بعده.
 *
 *   رفض صريح        ⇒ FAILED و SEND_FAILED — لم تصل، والإعادة آمنة.
 *   بلا جواب أكيد   ⇒ UNKNOWN و DELIVERY_UNKNOWN — ربما وصلت، فلا إعادة.
 *   قبول ثم فشل حفظ ⇒ UNKNOWN و DELIVERY_UNKNOWN — وصلت يقيناً، والإعادة
 *                     هنا تحديداً تعني ردّين عند العميل.
 */
async function sendAndStore(opts: {
  reservationId: string | null;
  send: () => Promise<OutboundResult>;
  store: (reservationId: string | null) => Promise<Sent>;
  /** ما يُقال للموظف إن رفضت Meta لانقضاء النافذة — يختلف بين القنوات */
  windowClosed?: string;
}): Promise<Sent> {
  let res: OutboundResult;
  try {
    res = await opts.send();
  } catch (err) {
    res = { ok: false, kind: "unknown", error: err instanceof Error ? err.message : String(err) };
  }

  const outcome = deliveryOutcome(res);
  if (outcome === "rejected") {
    await settle(opts.reservationId, "FAILED");
    if (opts.windowClosed && isWindowRejection(res.error)) {
      throw new OutboundError("WINDOW_CLOSED", opts.windowClosed, res.error);
    }
    // لا نحفظ ما لم يُرسَل: سجل يُظهر رسالة لم تصل العميل أسوأ من لا سجل
    throw new OutboundError("SEND_FAILED", "فشل الإرسال", res.error);
  }
  if (outcome === "unknown") {
    await settle(opts.reservationId, "UNKNOWN");
    console.error(`[outbound] نتيجة غير مؤكّدة من Meta (حجز ${opts.reservationId ?? "—"}):`, res.error);
    throw new OutboundError("DELIVERY_UNKNOWN", UNCONFIRMED, res.error);
  }

  try {
    return await opts.store(opts.reservationId);
  } catch (err) {
    // أخطر حالة هنا: العميل قرأ الرسالة والسجل لا يعرفها
    console.error(`[outbound] قبلتها Meta ولم تُخزَّن (حجز ${opts.reservationId ?? "—"}):`, err);
    await settle(opts.reservationId, "UNKNOWN");
    throw new OutboundError(
      "DELIVERY_UNKNOWN",
      "وصلت الرسالة للعميل لكن تعذّر حفظها في السجل — لا تُعِد إرسالها",
    );
  }
}

/**
 * يخزّن رسالة الموظف ويحرّك المحادثة ويغلق الحجز — في معاملة واحدة.
 *
 * `claim`: الرد يعني الاستلام. لو خُزّنت الرسالة ثم فشل التحويل في جولة
 * منفصلة، لردّ الوكيل على العميل فوق كلام الموظف.
 *
 * والرسالة تُنشأ من داخل الحجز (علاقة متداخلة) لا بجانبه: حجزٌ SENT بلا
 * رسالة، أو رسالة بحجز ما زال PENDING، كلاهما يُفسد ما يُرجع للإعادة.
 */
async function storeHuman(args: {
  tenantId: string;
  conversationId: string;
  text: string;
  clientId: string | null;
  claim: { reason: string | null } | null;
  reservationId: string | null;
}): Promise<Sent> {
  const { tenantId, conversationId, text, clientId, claim, reservationId } = args;
  const now = new Date();
  const messageData = {
    tenantId,
    conversationId,
    role: "HUMAN" as const,
    text,
    clientId,
    createdAt: now,
  };

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (claim) {
    // المحوّلة أصلاً تبقى على سببها الأول — هو ما يشرح لماذا احتاجت موظفاً
    ops.push(
      prisma.conversation.updateMany({
        where: { id: conversationId, tenantId, status: { not: "HUMAN" } },
        data: { status: "HUMAN", handoffAt: now, handoffReason: claim.reason },
      }),
    );
  }
  ops.push(
    prisma.conversation.update({
      where: { id: conversationId, tenantId },
      data: { lastMessageAt: now },
    }),
  );
  ops.push(
    reservationId
      ? prisma.outboundRequest.update({
          where: { id: reservationId, tenantId },
          data: { state: "SENT", message: { create: messageData } },
          select: { message: true },
        })
      : prisma.message.create({ data: messageData }),
  );

  const results = await prisma.$transaction(ops);
  const last = results[results.length - 1];
  const message = reservationId ? (last as { message: Message | null }).message : (last as Message);
  if (!message) throw new Error("الحجز أُغلق بلا رسالة");
  return {
    message,
    conversation: results[results.length - 2] as Conversation,
    replayed: false,
  };
}

// ═══════════════════════════════════════════════════════════
//  رد الموظف
// ═══════════════════════════════════════════════════════════

/**
 * رد موظف بشري داخل محادثة.
 *
 * يُرسل عبر نفس القناة التي جاء منها العميل، ويُحفظ بدور HUMAN فيتميّز في
 * السجل عن رد الوكيل.
 *
 * لا يُمنع مسبقاً بعد انقضاء نافذة الأربع وعشرين ساعة: الموظف يكتب في كل
 * محادثة، في اللوحة والتطبيق معاً، والحكم لـ Meta. إن رفضت لهذا السبب جاء
 * الرفض WINDOW_CLOSED بما يفعله الموظف بعده، لا «فشل الإرسال» المبهمة.
 * `claim`: الجوال يستلم المحادثة بالرد؛ اللوحة لا تزال تترك ذلك لزرّه.
 * `clientId`: بدونه (اللوحة) لا حجز — نموذج يُرسَل مرة بضغطة لا يُعاد آلياً.
 */
export async function sendHumanReply(args: {
  tenantId: string;
  conversationId: string;
  text: string;
  clientId?: string | null;
  channels?: readonly Channel[];
  claim: { reason: string | null } | null;
}): Promise<Sent> {
  const { tenantId, text } = args;
  const clientId = args.clientId ?? null;

  // استعلام واحد يجلب المحادثة وحالة المتجر وقنواته: كل جولة إلى قاعدة
  // بعيدة تُضاف مباشرةً إلى الزمن الذي ينتظره الموظف.
  const found = await prisma.conversation.findFirst({
    where: {
      id: args.conversationId,
      tenantId,
      ...(args.channels ? { channel: { in: [...args.channels] } } : {}),
    },
    include: {
      tenant: {
        select: {
          status: true,
          channels: {
            where: { active: true },
            select: { channel: true, externalId: true, accessTokenEnc: true },
          },
        },
      },
    },
  });
  if (!found) throw new OutboundError("NOT_FOUND", "المحادثة غير موجودة");
  const { tenant, ...convo } = found;

  const r = reservationFor(tenantId, clientId, {
    kind: "reply",
    conversationId: convo.id,
    text,
  });
  const prev = await peek(r);
  if (prev) return { message: prev, conversation: convo, replayed: true };

  assertActive(tenant.status);

  if (convo.channel === "WEB") {
    throw new OutboundError(
      "INVALID_INPUT",
      "محادثات التجربة لا تُرسل — هي ساحة اختبار لا قناة حقيقية",
    );
  }

  const account = tenant.channels.find((c) => c.channel === convo.channel);
  if (!account?.accessTokenEnc) {
    throw new OutboundError(
      "CHANNEL_NOT_CONNECTED",
      "لا يوجد رمز وصول لهذه القناة — راجع إعدادات القنوات",
    );
  }
  // فكّ التشفير قبل الحجز: لو فشل بعده لبقي حجز معلّق لرسالة لم تخرج
  const accessToken = decrypt(account.accessTokenEnc);

  const held = r ? await acquire(r) : null;
  if (held && "replay" in held) return { message: held.replay, conversation: convo, replayed: true };

  return sendAndStore({
    reservationId: held?.id ?? null,
    windowClosed:
      convo.channel === "WHATSAPP"
        ? "رفض واتساب الرسالة: مرّ أكثر من ٢٤ ساعة على آخر رسالة من العميل. أرسل قالباً، وحين يردّ تعود الكتابة العادية."
        : "رُفضت الرسالة: مرّ أكثر من ٢٤ ساعة على آخر رسالة من العميل. تستطيع الرد حين يكتب لك من جديد.",
    send: () =>
      sendMessage({
        channel: convo.channel,
        accountExternalId: account.externalId,
        to: convo.externalUserId,
        text,
        accessToken,
      }),
    store: (reservationId) =>
      storeHuman({
        tenantId,
        conversationId: convo.id,
        text,
        clientId,
        claim: args.claim,
        reservationId,
      }),
  });
}

// ═══════════════════════════════════════════════════════════
//  القوالب
// ═══════════════════════════════════════════════════════════

async function loadTenantForWhatsapp(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      status: true,
      locale: true,
      channels: {
        where: { channel: "WHATSAPP", active: true },
        select: { externalId: true, wabaId: true, accessTokenEnc: true },
      },
    },
  });
  if (!tenant) throw new OutboundError("NOT_FOUND", "المتجر غير موجود");
  return tenant;
}

type WhatsappTenant = Awaited<ReturnType<typeof loadTenantForWhatsapp>>;

function whatsappAccount(tenant: WhatsappTenant) {
  const account = tenant.channels[0];
  // wabaId شرط هنا لا تفصيل: القوالب تُقرأ من حساب واتساب التجاري لا من الرقم
  if (!account?.accessTokenEnc || !account.wabaId) {
    throw new OutboundError(
      "CHANNEL_NOT_CONNECTED",
      "لا توجد قناة واتساب مفعّلة — راجع إعدادات القنوات",
    );
  }
  return {
    externalId: account.externalId,
    wabaId: account.wabaId,
    accessToken: decrypt(account.accessTokenEnc),
  };
}

/** القوالب المعتمدة لهذا المتجر، من Meta مباشرة — لا نخزّنها فلا تتقادم. */
export async function approvedTemplates(tenantId: string): Promise<Template[]> {
  return fetchTemplates(whatsappAccount(await loadTenantForWhatsapp(tenantId)));
}

async function fetchTemplates(wa: { wabaId: string; accessToken: string }) {
  const found = await listTemplates({ wabaId: wa.wabaId, accessToken: wa.accessToken });
  if (!found.ok) {
    throw new OutboundError("SEND_FAILED", "تعذّر قراءة القوالب", found.error);
  }
  return found.templates;
}

/**
 * يطابق القالب المطلوب مع المعتمد الآن عند Meta.
 *
 * القالب قد يُرفض أو يُحذف بين فتح الشاشة والإرسال، ومتغيّر ناقص يجعل Meta
 * ترسل `{{2}}` حرفياً أو ترفض — فنفحص هنا ونعطي السبب بالعربية.
 */
function pickTemplate(
  templates: Template[],
  name: string,
  language: string,
  variables: string[],
): { tpl: Template; vars: string[] } {
  const tpl = templates.find((t) => t.name === name && t.language === language);
  if (!tpl) throw new OutboundError("TEMPLATE_INVALID", "القالب لم يعد معتمداً — حدّث الصفحة");

  const vars = variables.slice(0, tpl.variables).map((v) => v.trim());
  const given = vars.filter(Boolean).length;
  if (vars.length < tpl.variables || given < tpl.variables) {
    throw new OutboundError(
      "TEMPLATE_INVALID",
      `القالب يحتاج ${tpl.variables} متغيّراً، وصلني ${given}`,
    );
  }
  return { tpl, vars };
}

const templatePayload = (name: string, language: string, variables: string[]) => ({
  name,
  language,
  variables: variables.map((v) => v.trim()),
});

const sendTpl = (
  wa: { externalId: string; accessToken: string },
  to: string,
  tpl: Template,
  vars: string[],
) =>
  sendTemplate({
    accountExternalId: wa.externalId,
    to,
    name: tpl.name,
    language: tpl.language,
    variables: vars,
    accessToken: wa.accessToken,
  });

/**
 * قالب داخل محادثة قائمة — الطريق الوحيد بعد إغلاق نافذة الأربع وعشرين ساعة.
 *
 * النص المخزَّن **بعد تعبئة المتغيّرات**: ما يجب أن يقرأه الموظف في السجل
 * هو ما رآه العميل، لا `{{1}}`.
 */
export async function sendTemplateToConversation(args: {
  tenantId: string;
  conversationId: string;
  name: string;
  language: string;
  variables: string[];
  clientId?: string | null;
  channels?: readonly Channel[];
  claimReason: string | null;
}): Promise<Sent> {
  const { tenantId } = args;
  const clientId = args.clientId ?? null;

  const convo = await prisma.conversation.findFirst({
    where: {
      id: args.conversationId,
      tenantId,
      ...(args.channels ? { channel: { in: [...args.channels] } } : {}),
    },
  });
  if (!convo) throw new OutboundError("NOT_FOUND", "المحادثة غير موجودة");

  const r = reservationFor(tenantId, clientId, {
    kind: "template",
    conversationId: convo.id,
    template: templatePayload(args.name, args.language, args.variables),
  });
  const prev = await peek(r);
  if (prev) return { message: prev, conversation: convo, replayed: true };

  if (convo.channel !== "WHATSAPP") {
    throw new OutboundError("INVALID_INPUT", "القوالب لواتساب فقط");
  }

  const tenant = await loadTenantForWhatsapp(tenantId);
  assertActive(tenant.status);
  const wa = whatsappAccount(tenant);
  const { tpl, vars } = pickTemplate(await fetchTemplates(wa), args.name, args.language, args.variables);

  const held = r ? await acquire(r) : null;
  if (held && "replay" in held) return { message: held.replay, conversation: convo, replayed: true };

  return sendAndStore({
    reservationId: held?.id ?? null,
    send: () => sendTpl(wa, convo.externalUserId, tpl, vars),
    store: (reservationId) =>
      storeHuman({
        tenantId,
        conversationId: convo.id,
        text: renderTemplate(tpl.body, vars),
        clientId,
        claim: { reason: args.claimReason },
        reservationId,
      }),
  });
}

/**
 * يبدأ محادثة مع رقم لم يراسلنا.
 *
 * لا يمكن أن تكون رسالة حرّة: واتساب يقبل خارج نافذة الأربع وعشرين ساعة
 * قوالب معتمدة فقط.
 *
 * والمحادثة تُفتح بحالة HUMAN عمداً: نحن من بدأها، فردّ العميل الأول جواب
 * على كلامنا لا سؤال جديد — ولو تركناها للوكيل لردّ على سياق لا يعرفه.
 */
export async function startWhatsappConversation(args: {
  tenantId: string;
  phone: string;
  customerName?: string | null;
  name: string;
  language: string;
  variables: string[];
  clientId?: string | null;
  claimReason: string | null;
}): Promise<Sent> {
  const { tenantId } = args;
  const clientId = args.clientId ?? null;
  const tenant = await loadTenantForWhatsapp(tenantId);

  let to: string;
  try {
    to = normalizePhone(args.phone, tenant.locale);
  } catch (err) {
    throw new OutboundError("INVALID_INPUT", err instanceof Error ? err.message : "رقم غير صالح");
  }
  if (!isPlausiblePhone(to)) {
    throw new OutboundError(
      "INVALID_INPUT",
      `رقم غير صالح: ${args.phone} — اكتبه بمفتاح الدولة، مثل 9627XXXXXXXX`,
    );
  }

  // البصمة على الرقم بعد التوحيد: «0770…» ثم «+962770…» بنفس المعرّف
  // مستلم واحد لا عمليتان
  const r = reservationFor(tenantId, clientId, {
    kind: "start",
    phone: to,
    template: templatePayload(args.name, args.language, args.variables),
  });
  const replayOf = async (m: Message): Promise<Sent> => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: m.conversationId, tenantId },
    });
    if (!conversation) throw new OutboundError("DELIVERY_UNKNOWN", UNCONFIRMED);
    return { message: m, conversation, replayed: true };
  };
  const prev = await peek(r);
  if (prev) return replayOf(prev);

  assertActive(tenant.status);
  const wa = whatsappAccount(tenant);
  const { tpl, vars } = pickTemplate(await fetchTemplates(wa), args.name, args.language, args.variables);

  const held = r ? await acquire(r) : null;
  if (held && "replay" in held) return replayOf(held.replay);

  return sendAndStore({
    reservationId: held?.id ?? null,
    // لا نفتح محادثة لرسالة لم تصل — الإنشاء في مرحلة التخزين لا قبلها
    send: () => sendTpl(wa, to, tpl, vars),
    store: async (reservationId) => {
      const convo = await tenantScope(tenantId).getOrCreateConversation(
        "WHATSAPP",
        to,
        args.customerName ?? undefined,
      );
      return storeHuman({
        tenantId,
        conversationId: convo.id,
        text: renderTemplate(tpl.body, vars),
        clientId,
        claim: { reason: args.claimReason },
        reservationId,
      });
    },
  });
}
