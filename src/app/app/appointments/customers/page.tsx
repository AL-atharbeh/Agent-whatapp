import CustomersView from "@/app/admin/[slug]/appointments/_views/customers";
import { ownerCtx } from "@/app/admin/[slug]/appointments/_views/context";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: Search }) {
  return <CustomersView {...await ownerCtx(searchParams)} />;
}
