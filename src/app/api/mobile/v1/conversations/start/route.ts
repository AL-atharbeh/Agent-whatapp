import { z } from "zod";
import { startWhatsappConversation } from "@/lib/outbound";
import { clientIdSchema, json, readBody, route } from "@/lib/mobile/http";
import { requireDevice } from "@/lib/mobile/auth";
import { toItem1 } from "@/lib/mobile/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  phone: z.string().trim().min(1).max(40),
  name: z.string().trim().max(100).nullable().optional(),
  template: z.object({
    name: z.string().trim().min(1).max(512),
    language: z.string().trim().min(1).max(20),
    variables: z.array(z.string().max(1024)).max(20).default([]),
  }),
  // إلزامي: بلا معرّف لا حجز، وإعادة محاولة بعد انقطاع تصل العميل مرتين
  clientId: clientIdSchema,
});

/** POST /conversations/start — محادثة جديدة بقالب، واتساب فقط. */
export const POST = route(async (req) => {
  const d = await requireDevice(req);
  const body = await readBody(req, Body);

  const sent = await startWhatsappConversation({
    tenantId: d.tenantId,
    phone: body.phone,
    customerName: body.name || null,
    name: body.template.name,
    language: body.template.language,
    variables: body.template.variables,
    clientId: body.clientId,
    claimReason: null,
  });

  return json({ conversation: await toItem1(d, sent.conversation) }, 201);
});
