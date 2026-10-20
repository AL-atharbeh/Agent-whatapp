import type { Channel } from "@prisma/client";
import { prisma } from "../db";
import { decrypt } from "../crypto";
import { listTemplates, renderTemplate, sendMessage, sendTemplate, type Template } from "../channels/meta";
import { deliveryOutcome } from "../channels/types";
import { replyWindow } from "../mobile/window";
import { tenantScope } from "../tenancy";

/**
 * رسائل المواعيد للعميل — تذكير، تأخير، عودة.
 *
 * القاعدة من Meta: نص حرّ فقط داخل ٢٤ ساعة من آخر رسالة للعميل، وإلا قالب
 * معتمد. فنختار القناة المفتوحة إن وُجدت، وإلا قالب واتساب على رقمه.
 * وما يُرسَل يُخزَّن في محادثته كرسالة من الوكيل: حين يرد العميل «تأكيد»
 * يرى الوكيل التذكير الذي يرد عليه، لا كلمة بلا سياق.
 */

export type SendOutcome = "sent" | "rejected" | "unknown" | "skipped";

type Account = { channel: Channel; externalId: string; accessToken: string; wabaId: string | null };

/** حسابات قنوات المتجر وقوالبه — تُحمَّل مرة لكل متجر في كل دورة مهام. */
export class TenantMessenger {
  private accounts: Promise<Account[]> | null = null;
  private templates: Promise<Template[] | null> | null = null;

  constructor(readonly tenantId: string) {}

  private loadAccounts() {
    this.accounts ??= prisma.channelAccount
      .findMany({
        where: { tenantId: this.tenantId, active: true, accessTokenEnc: { not: null } },
        select: { channel: true, externalId: true, accessTokenEnc: true, wabaId: true },
      })
      .then((rows) =>
        rows.flatMap((r) => {
          try {
            return [{ channel: r.channel, externalId: r.externalId, wabaId: r.wabaId, accessToken: decrypt(r.accessTokenEnc!) }];
          } catch {
            console.error(`[appointments] تعذّر فكّ رمز قناة ${r.channel} — ${this.tenantId}`);
            return [];
          }
        }),
      );
    return this.accounts;
  }

  private async template(name: string): Promise<Template | null> {
    this.templates ??= (async () => {
      const wa = (await this.loadAccounts()).find((a) => a.channel === "WHATSAPP" && a.wabaId);
      if (!wa) return null;
      const r = await listTemplates({ wabaId: wa.wabaId!, accessToken: wa.accessToken });
      if (!r.ok) {
        console.error(`[appointments] تعذّر قراءة القوالب — ${this.tenantId}:`, r.error);
        return null;
      }
      return r.templates;
    })();
    const all = await this.templates;
    return all?.find((t) => t.name === name && t.language === "ar") ?? null;
  }

  /**
   * يرسل للعميل: نص حرّ إن كانت نافذة إحدى قنواته مفتوحة (و`text` معطى)،
   * وإلا القالب على رقم واتساب. لا هذا ولا ذاك ⇒ skipped مع سطر في السجل.
   */
  async send(args: {
    customerId: string;
    text?: string | null;
    template?: { name: string | null; vars: (count: number) => string[] } | null;
    now?: Date;
  }): Promise<SendOutcome> {
    const now = args.now ?? new Date();
    const [customer, accounts] = await Promise.all([
      prisma.customer.findFirst({
        where: { id: args.customerId, tenantId: this.tenantId },
        select: { phone: true, name: true, contacts: { select: { channel: true, externalUserId: true } } },
      }),
      this.loadAccounts(),
    ]);
    if (!customer) return "skipped";
    const scope = tenantScope(this.tenantId);

    if (args.text) {
      const convos = customer.contacts.length
        ? await prisma.conversation.findMany({
            where: {
              tenantId: this.tenantId,
              OR: customer.contacts.map((c) => ({ channel: c.channel, externalUserId: c.externalUserId })),
            },
            select: { id: true, channel: true, externalUserId: true, lastInboundAt: true },
            orderBy: { lastInboundAt: { sort: "desc", nulls: "last" } },
          })
        : [];
      for (const c of convos) {
        if (!replyWindow(c.lastInboundAt, now).open) continue;
        const acc = accounts.find((a) => a.channel === c.channel);
        if (!acc) continue;
        const res = await sendMessage({
          channel: c.channel,
          accountExternalId: acc.externalId,
          to: c.externalUserId,
          text: args.text,
          accessToken: acc.accessToken,
        });
        const outcome = deliveryOutcome(res);
        if (outcome === "sent") {
          await scope.addMessage({ conversationId: c.id, role: "AGENT", text: args.text });
        } else {
          console.error(`[appointments] فشل إرسال نص (${outcome}) — ${this.tenantId}:`, res.error);
        }
        return outcome;
      }
    }

    const tplName = args.template?.name;
    if (!tplName) {
      console.warn(`[appointments] لا قالب مضبوط ولا نافذة مفتوحة — لم يُرسَل شيء (${this.tenantId})`);
      return "skipped";
    }
    const wa = accounts.find((a) => a.channel === "WHATSAPP");
    if (!customer.phone || !wa) {
      console.warn(`[appointments] عميل بلا رقم واتساب أو متجر بلا قناة واتساب — تخطّي (${this.tenantId})`);
      return "skipped";
    }
    const tpl = await this.template(tplName);
    if (!tpl) {
      console.warn(`[appointments] القالب ${tplName} (ar) غير معتمد أو غير موجود — تخطّي (${this.tenantId})`);
      return "skipped";
    }
    const vars = args.template!.vars(tpl.variables);
    const res = await sendTemplate({
      accountExternalId: wa.externalId,
      to: customer.phone,
      name: tpl.name,
      language: tpl.language,
      variables: vars,
      accessToken: wa.accessToken,
    });
    const outcome = deliveryOutcome(res);
    if (outcome === "sent") {
      const convo = await scope.getOrCreateConversation("WHATSAPP", customer.phone, customer.name ?? undefined);
      await scope.addMessage({ conversationId: convo.id, role: "AGENT", text: renderTemplate(tpl.body, vars) });
    } else {
      console.error(`[appointments] فشل إرسال القالب ${tplName} (${outcome}) — ${this.tenantId}:`, res.error);
    }
    return outcome;
  }
}
