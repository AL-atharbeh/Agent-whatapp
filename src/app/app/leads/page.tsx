import { requireOwnTenant } from "@/lib/session";
import Page from "@/app/admin/[slug]/leads/page";

export const dynamic = "force-dynamic";

export default async function Portalleads() {
  const { tenant } = await requireOwnTenant();
  return <Page params={Promise.resolve({ slug: tenant.slug })} />;
}
