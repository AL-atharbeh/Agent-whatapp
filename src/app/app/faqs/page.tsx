import { requireOwnTenant } from "@/lib/session";
import Page from "@/app/admin/[slug]/faqs/page";

export const dynamic = "force-dynamic";

export default async function Portalfaqs() {
  const { tenant } = await requireOwnTenant();
  return <Page params={Promise.resolve({ slug: tenant.slug })} />;
}
