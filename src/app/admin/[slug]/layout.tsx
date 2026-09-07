import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import Tabs from "./tabs";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "نشط", cls: "ok" },
  PAUSED: { label: "بانتظار التفعيل", cls: "warn" },
  SUSPENDED: { label: "معلّق", cls: "danger" },
};

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { name: true, slug: true, agentName: true, status: true },
  });
  if (!tenant) notFound();

  const st = STATUS[tenant.status] ?? STATUS.PAUSED;

  return (
    <main className="wide">
      <div className="row" style={{ marginBottom: 10 }}>
        <Link href="/admin" style={{ color: "var(--text-3)", fontSize: 13.5 }}>
          ← كل المتاجر
        </Link>
        <Link className="btn ghost" href={`/playground/${tenant.slug}`}>
          جرّب الوكيل
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{tenant.name}</h1>
        <span className={`pill ${st.cls}`}>{st.label}</span>
      </div>
      <p className="sub">الوكيل: {tenant.agentName}</p>

      <Tabs slug={tenant.slug} />
      {children}
    </main>
  );
}
