import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteFaq, saveFaq } from "../../actions";

export const dynamic = "force-dynamic";

type Faq = Awaited<ReturnType<typeof prisma.faq.findMany>>[number];

function FaqForm({ slug, faq }: { slug: string; faq?: Faq }) {
  return (
    <form action={saveFaq}>
      <input type="hidden" name="slug" value={slug} />
      {faq && <input type="hidden" name="id" value={faq.id} />}

      <label>
        <span>السؤال (كما يكتبه العميل عادة) *</span>
        <input type="text" name="question" required defaultValue={faq?.question ?? ""} />
      </label>
      <label>
        <span>الجواب المعتمد *</span>
        <textarea name="answer" required defaultValue={faq?.answer ?? ""} />
      </label>
      <label>
        <span>الأولوية (الأعلى يظهر أولاً)</span>
        <input type="number" name="priority" defaultValue={faq?.priority ?? 0} />
      </label>
      <div className="checkline">
        <input
          type="checkbox"
          name="active"
          id={`f-${faq?.id ?? "new"}`}
          defaultChecked={faq?.active ?? true}
        />
        <label htmlFor={`f-${faq?.id ?? "new"}`} style={{ margin: 0, color: "var(--text)" }}>
          مفعّل
        </label>
      </div>
      <button type="submit">{faq ? "حفظ التعديلات" : "إضافة السؤال"}</button>
    </form>
  );
}

export default async function FaqsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) notFound();

  const faqs = await prisma.faq.findMany({
    where: { tenantId: tenant.id },
    orderBy: { priority: "desc" },
  });

  return (
    <>
      <div className="card">
        <h3>كيف تُستخدم؟</h3>
        <p className="hint" style={{ margin: 0 }}>
          هذه الأسئلة وأجوبتها تُحقن كاملة داخل تعليمات الوكيل — يجيب عنها فوراً بدون
          استدعاء أي أداة. مناسبة للمعلومات الثابتة المتكررة. لو زادت عن ٥٠ سؤالاً، الأفضل
          نقلها لنظام بحث (RAG).
        </p>
      </div>

      <details className="card">
        <summary>إضافة سؤال شائع</summary>
        <div style={{ marginTop: 16 }}>
          <FaqForm slug={slug} />
        </div>
      </details>

      <h2>الأسئلة ({faqs.length})</h2>

      {faqs.length === 0 && <div className="card">لا يوجد أسئلة شائعة بعد.</div>}

      {faqs.map((f) => (
        <details className="card" key={f.id}>
          <summary>
            {f.question} {!f.active && <span className="pill warn">معطّل</span>}
          </summary>
          <div style={{ marginTop: 16 }}>
            <FaqForm slug={slug} faq={f} />
            <form action={deleteFaq} style={{ marginTop: 8 }}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={f.id} />
              <button type="submit" className="danger">
                حذف
              </button>
            </form>
          </div>
        </details>
      ))}
    </>
  );
}
