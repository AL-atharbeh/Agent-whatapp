import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import Chat from "./chat";

export const dynamic = "force-dynamic";

export default async function Playground({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { name: true, agentName: true, slug: true },
  });
  if (!tenant) notFound();

  return (
    <main>
      <Link href="/" className="sub" style={{ color: "var(--muted)" }}>
        ← كل العملاء
      </Link>
      <h1 style={{ marginTop: 12 }}>{tenant.name}</h1>
      <p className="sub">تتحدث مع «{tenant.agentName}» — نفس الوكيل الذي يرد على الواتساب.</p>
      <Chat slug={tenant.slug} agentName={tenant.agentName} />
    </main>
  );
}
