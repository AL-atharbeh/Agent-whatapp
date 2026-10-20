import CustomerView from "@/app/admin/[slug]/appointments/_views/customer";
import { ownerCtx } from "@/app/admin/[slug]/appointments/_views/context";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerView {...await ownerCtx()} id={id} />;
}
