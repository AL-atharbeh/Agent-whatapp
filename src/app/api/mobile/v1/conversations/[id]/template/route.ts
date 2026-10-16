import { z } from "zod";
import { sendTemplateToConversation } from "@/lib/outbound";
import {
  MOBILE_CHANNELS,
  clientIdSchema,
  json,
  parseId,
  readBody,
  route,
} from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { toItem1, toMessageItem } from "@/lib/mobile/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(1).max(20),
  variables: z.array(z.string().max(1024)).max(20).default([]),
  // إلزامي: بلا معرّف لا حجز، وإعادة محاولة بعد انقطاع تصل العميل مرتين
  clientId: clientIdSchema,
});

/** POST /conversations/:id/template — قالب في محادثة قائمة، واتساب فقط. */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const d = await requireDevice(req);
  const id = parseId((await ctx.params).id);
  const body = await readBody(req, Body);

  const sent = await sendTemplateToConversation({
    tenantId: d.tenantId,
    conversationId: id,
    name: body.name,
    language: body.language,
    variables: body.variables,
    clientId: body.clientId,
    channels: MOBILE_CHANNELS,
    claimReason: "قالب من موظف عبر التطبيق",
  });

  return json(
    {
      message: toMessageItem(sent.message),
      conversation: await toItem1(d, sent.conversation),
    },
    201,
  );
});
