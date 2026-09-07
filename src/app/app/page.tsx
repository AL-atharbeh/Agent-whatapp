import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireOwnTenant } from "@/lib/session";
import Readiness from "@/app/admin/[slug]/readiness";

export const dynamic = "force-dynamic";

export default async function PortalHome({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const sp = await searchParams;
  const { tenant } = await requireOwnTenant();

  const [products, faqs, convos, leads, todayReplies] = await Promise.all([
    prisma.product.count({ where: { tenantId: tenant.id, active: true } }),
    prisma.faq.count({ where: { tenantId: tenant.id, active: true } }),
    prisma.conversation.count({ where: { tenantId: tenant.id } }),
    prisma.lead.count({ where: { tenantId: tenant.id } }),
    prisma.message.count({
      where: {
        tenantId: tenant.id,
        role: "AGENT",
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  return (
    <>
      {sp.welcome && (
        <div className="alert ok">
          <strong>أهلاً بك 👋</strong> متجرك جاهز. ابدأ بتعبئة بياناتك ومنتجاتك — كل ما
          أعطيت وكيلك معرفة أكثر، قلّت تحويلاته للموظف.
        </div>
      )}

      <h1>{tenant.name}</h1>
      <p className="sub">وكيلك «{tenant.agentName}» — لوحة إدارته</p>

      <div className="stats">
        <div className="stat">
          <div className="stat-value">{products}</div>
          <div className="stat-label">منتج في الكتالوج</div>
        </div>
        <div className="stat">
          <div className="stat-value">{faqs}</div>
          <div className="stat-label">سؤال شائع</div>
        </div>
        <div className="stat">
          <div className="stat-value">{convos}</div>
          <div className="stat-label">محادثة</div>
        </div>
        <div className="stat">
          <div className="stat-value">{leads}</div>
          <div className="stat-label">عميل محتمل</div>
        </div>
        <div className="stat">
          <div className="stat-value">{todayReplies}</div>
          <div className="stat-label">رد اليوم</div>
        </div>
      </div>

      <Readiness slug={tenant.slug} hideChannels />

      <div className="card">
        <h3>ابدأ من هنا</h3>
        <p className="hint">أنجز هذي بالترتيب ليصير وكيلك مفيداً فعلاً.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <Link className="btn" href="/app/business">
            عبّي بيانات المتجر
          </Link>
          <Link className="btn ghost" href="/app/products">
            أضف منتجاتك
          </Link>
          <Link className="btn ghost" href="/app/faqs">
            أضف أسئلة شائعة
          </Link>
          <Link className="btn ghost" href="/app/try">
            جرّب الوكيل
          </Link>
        </div>
      </div>
    </>
  );
}
