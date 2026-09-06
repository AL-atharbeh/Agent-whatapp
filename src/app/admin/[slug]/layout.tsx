import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import Tabs from "./tabs";

export const dynamic = "force-dynamic";

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

  return (
    <main className="wide">
      <div className="row" style={{ marginBottom: 4 }}>
        <Link href="/admin" style={{ color: "var(--muted)", fontSize: 14 }}>
          ← كل المتاجر
        </Link>
        <Link className="btn" href={`/playground/${tenant.slug}`}>
          جرّب الوكيل
        </Link>
      </div>

      <h1 style={{ marginTop: 12 }}>{tenant.name}</h1>
      <p className="sub">
        الوكيل: {tenant.agentName} ·{" "}
        <span className={`pill ${tenant.status === "ACTIVE" ? "ok" : "warn"}`}>
          {tenant.status === "ACTIVE" ? "نشط" : "متوقف"}
        </span>
      </p>

      <Tabs slug={tenant.slug} />
      {children}
    </main>
  );
}
