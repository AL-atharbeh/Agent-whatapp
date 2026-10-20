import CustomerView from "../../_views/customer";
import { adminCtx } from "../../_views/context";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = await params;
  return <CustomerView {...await adminCtx(params)} id={id} />;
}
