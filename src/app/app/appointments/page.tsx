import DayView from "@/app/admin/[slug]/appointments/_views/day";
import { ownerCtx } from "@/app/admin/[slug]/appointments/_views/context";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: Search }) {
  return <DayView {...await ownerCtx(searchParams)} />;
}
