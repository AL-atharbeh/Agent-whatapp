import { requireOwnTenant } from "@/lib/session";
import Page from "@/app/admin/[slug]/conversations/page";

export const dynamic = "force-dynamic";

export default async function Portalconversations() {
  const { tenant } = await requireOwnTenant();
  return <Page params={Promise.resolve({ slug: tenant.slug })} />;
}
