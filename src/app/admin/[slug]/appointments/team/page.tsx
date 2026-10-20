import TeamView from "../_views/team";
import { adminCtx } from "../_views/context";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Search }) {
  return <TeamView {...await adminCtx(params, searchParams)} />;
}
