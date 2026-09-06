import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteChannel, saveChannel } from "../../actions";
import { CHANNELS } from "../../types";

export const dynamic = "force-dynamic";

type Account = Awaited<ReturnType<typeof prisma.channelAccount.findMany>>[number];

const ID_HINT: Record<string, string> = {
  WHATSAPP: "Phone Number ID من لوحة WhatsApp Cloud API",
  MESSENGER: "Page ID لصفحة فيسبوك",
  INSTAGRAM: "Instagram Account ID",
};

function ChannelForm({ slug, acc }: { slug: string; acc?: Account }) {
  return (
    <form action={saveChannel}>
      <input type="hidden" name="slug" value={slug} />
      {acc && <input type="hidden" name="id" value={acc.id} />}

      <div className="grid2">
        <label>
          <span>القناة</span>
          <select name="channel" defaultValue={acc?.channel ?? "WHATSAPP"}>
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>معرّف الحساب *</span>
          <input type="text" name="externalId" required defaultValue={acc?.externalId ?? ""} />
        </label>
      </div>
      <p className="hint">{ID_HINT[acc?.channel ?? "WHATSAPP"]}</p>

      <div className="grid2">
        <label>
          <span>اسم للعرض</span>
          <input type="text" name="displayName" defaultValue={acc?.displayName ?? ""} />
        </label>
        <label>
          <span>Verify Token (نص تختاره وتضعه أيضاً في لوحة Meta)</span>
          <input type="text" name="verifyToken" defaultValue={acc?.verifyToken ?? ""} />
        </label>
      </div>

      <div className="grid2">
        <label>
          <span>Access Token {acc?.accessTokenEnc && "(محفوظ — اتركه فارغاً للإبقاء عليه)"}</span>
          <input type="password" name="accessToken" autoComplete="off" />
        </label>
        <label>
          <span>App Secret {acc?.appSecretEnc && "(محفوظ — اتركه فارغاً للإبقاء عليه)"}</span>
          <input type="password" name="appSecret" autoComplete="off" />
        </label>
      </div>
      <p className="hint">المفاتيح تُشفّر بـ AES-256-GCM قبل تخزينها ولا تُعرض مرة أخرى.</p>

      <div className="checkline">
        <input
          type="checkbox"
          name="active"
          id={`c-${acc?.id ?? "new"}`}
          defaultChecked={acc?.active ?? true}
        />
        <label htmlFor={`c-${acc?.id ?? "new"}`} style={{ margin: 0, color: "var(--text)" }}>
          مفعّل
        </label>
      </div>

      <button type="submit">{acc ? "حفظ التعديلات" : "ربط القناة"}</button>
    </form>
  );
}

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) notFound();

  const accounts = await prisma.channelAccount.findMany({ where: { tenantId: tenant.id } });
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";

  return (
    <>
      <div className="card">
        <h3>رابط الويبهوك الخاص بهذا المتجر</h3>
        <p className="hint">ضعه في لوحة Meta تحت Webhooks، واشترك في حقل messages.</p>
        <textarea className="code" readOnly rows={2} value={`${base}/api/webhooks/meta/${slug}`} />
        <p className="hint" style={{ marginTop: 8 }}>
          للتجربة محلياً تحتاج نفقاً عاماً (مثل ngrok) لأن Meta لا تصل إلى localhost.
        </p>
      </div>

      <details className="card">
        <summary>ربط قناة جديدة</summary>
        <div style={{ marginTop: 16 }}>
          <ChannelForm slug={slug} />
        </div>
      </details>

      <h2>القنوات المربوطة ({accounts.length})</h2>

      {accounts.length === 0 && (
        <div className="card">
          لا يوجد قنوات مربوطة. الوكيل يعمل حالياً عبر صفحة التجربة فقط.
        </div>
      )}

      {accounts.map((a) => (
        <details className="card" key={a.id}>
          <summary>
            {CHANNELS.find((c) => c.value === a.channel)?.label ?? a.channel} —{" "}
            <code>{a.externalId}</code>{" "}
            <span className={`pill ${a.active && a.accessTokenEnc ? "ok" : "warn"}`}>
              {!a.accessTokenEnc ? "ناقص Access Token" : a.active ? "مفعّل" : "معطّل"}
            </span>
          </summary>
          <div style={{ marginTop: 16 }}>
            <ChannelForm slug={slug} acc={a} />
            <form action={deleteChannel} style={{ marginTop: 8 }}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" className="danger">
                فصل القناة
              </button>
            </form>
          </div>
        </details>
      ))}
    </>
  );
}
