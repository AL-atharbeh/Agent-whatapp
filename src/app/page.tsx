import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const s = await getSession();
  redirect(s ? (s.role === "PLATFORM_ADMIN" ? "/admin" : "/app") : "/login");
}
