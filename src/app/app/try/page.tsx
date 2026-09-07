import { requireOwnTenant } from "@/lib/session";
import Chat from "@/app/playground/[slug]/chat";

export const dynamic = "force-dynamic";

export default async function Try() {
  const { tenant } = await requireOwnTenant();
  return (
    <>
      <h1>جرّب وكيلك</h1>
      <p className="sub">
        تحدّث مع «{tenant.agentName}» كما لو كنت عميلاً — نفس الوكيل الذي يرد على قنواتك.
      </p>
      <Chat slug={tenant.slug} agentName={tenant.agentName} />
    </>
  );
}
