import type { Channel } from "@prisma/client";
import { displayId, displayName } from "../display";

/**
 * سياسة الإشعارات — صافية بلا قاعدة ولا شبكة لتُختبر وحدها.
 *
 * | الحدث            | all | handoff | off |
 * | رسالة عميل جديدة |  ✅  |   —     |  —  |
 * | تحويل لموظف       |  ✅  |   ✅    |  —  |
 */

export const NOTIFY_LEVELS = ["all", "handoff", "off"] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export type PushType = "message" | "handoff";

/** المستويات التي تستقبل هذا الحدث — تُستعمل مباشرة في `where` الاستعلام. */
export function levelsFor(type: PushType): NotifyLevel[] {
  return type === "handoff" ? ["all", "handoff"] : ["all"];
}

export function wantsPush(level: string, type: PushType): boolean {
  return (levelsFor(type) as string[]).includes(level);
}

export const PUSH_BODY_MAX = 120;

/** قصّ بالمحارف لا بالبايتات — قصّ UTF-16 وسط حرف مركّب يُظهر مربعاً مكسوراً. */
export function clip(text: string, max = PUSH_BODY_MAX): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : chars.slice(0, max - 1).join("") + "…";
}

const CHANNEL_AR: Record<string, string> = {
  WHATSAPP: "واتساب",
  MESSENGER: "ماسنجر",
  INSTAGRAM: "انستقرام",
};

export function pushContent(args: {
  type: PushType;
  channel: Channel;
  customerName: string | null;
  externalUserId: string;
  text: string;
}): { title: string; body: string } {
  const who = displayName(args.customerName) ?? displayId(args.channel, args.externalUserId);
  const title =
    args.type === "handoff"
      ? `يحتاجك الآن · ${who}`
      : `${who} · ${CHANNEL_AR[args.channel] ?? args.channel}`;
  return { title: clip(title), body: clip(args.text || "—") };
}
